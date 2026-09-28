import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { errorResponse, serverError, paginatedResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange } from "@/lib/date-range";

const PAGE_SIZE = 50;
const ZERO = new Prisma.Decimal(0);

function normalizeCurrency(code: string): string {
  const upper = (code || "PKR").toUpperCase();
  return upper === "RMB" ? "CNY" : upper;
}

function currencyWhere(currencyParam: string | null): Record<string, unknown> | undefined {
  if (!currencyParam) return undefined;
  const normalized = normalizeCurrency(currencyParam);
  if (normalized === "CNY") {
    return { currencyCode: { in: ["CNY", "RMB"] } };
  }
  return { currencyCode: normalized };
}

function sourcePath(entityType: string | null, entityId: number | null): string | null {
  if (!entityType || entityId == null) return null;
  const routes: Record<string, string> = {
    sale: "/sales",
    payment: "/payments",
    expense: "/expenses",
    haji_transfer: "/haji-transfers",
    lot_purchase: "/lots",
    lot_cost: "/lots",
    shipping_line_payment: "/shipping-lines",
    agent_payment: "/agents",
    bank_deposit: "/bank-deposits",
    city_liability_entry: "/liabilities",
    super_admin_liability_entry: "/super-admin-liabilities",
    super_admin_account_transfer: "/super-admin-account-transfers",
    super_admin_personal_expense: "/super-admin-personal-expenses",
    opening_customer_balance: "/openings",
    opening_cash: "/openings",
    opening_bank_balance: "/openings",
    opening_cheque: "/openings",
    opening_liability: "/openings",
    opening_city_liability: "/openings",
    opening_haji_balance: "/openings",
    opening_inventory_valuation: "/openings",
    opening_super_admin_account_balance: "/openings",
    opening_equity_allocation: "/openings",
    opening_participant_balance: "/openings",
    intermediary_deposit: "/intermediaries",
    intermediary_exchange: "/intermediaries",
    haji_cash_receipt: "/haji-transfers",
    historical_sale_opening_adjustment: "/openings",
    sale_discount: "/sales",
    lot_purchase_correction: "/lots",
    supplier_payment: "/suppliers",
    withdrawal: "/dashboard",
  };
  return routes[entityType] || null;
}

function dec(v: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  if (v == null) return ZERO;
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(v);
}

function roundDecStr(v: Prisma.Decimal): number {
  return Number(v.toDecimalPlaces(2).toString());
}

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const accountIdParam = sp.get("account_id");
    const dateFrom = sp.get("date_from");
    const dateTo = sp.get("date_to");
    const cityIdParam = sp.get("city_id");
    const currencyParam = sp.get("currency");
    const pageParam = parseInt(sp.get("page") || "1");
    const page = Math.max(1, isNaN(pageParam) ? 1 : pageParam);

    if (!accountIdParam) {
      return errorResponse("VALIDATION_ERROR", "account_id is required");
    }
    const accountId = parseInt(accountIdParam);
    if (isNaN(accountId) || accountId <= 0) {
      return errorResponse("VALIDATION_ERROR", "Invalid account_id");
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, accountType: true, cityId: true },
    });
    if (!account) {
      return errorResponse("NOT_FOUND", "Account not found");
    }

    const cityId = cityIdParam ? parseInt(cityIdParam) : undefined;
    const cityFilter = cityId ? { cityId } : {};
    const curWhere = currencyWhere(currencyParam);
    const baseWhere: any = { accountId, ...cityFilter, ...(curWhere || {}) };

    // Date boundary logic:
    // - Neither date: opening = 0, period = all entries.
    // - Both dates:   opening = entries before from, period = entries in [from, to).
    // - from only:    opening = entries before from, period = entries >= from.
    // - to only:      opening = 0, period = entries before to.
    let openingWhere: any = null;
    let periodWhere: any = { ...baseWhere };

    if (dateFrom && dateTo) {
      const range = buildDateRange(dateFrom, dateTo);
      if (range.gte) openingWhere = { ...baseWhere, entryDate: { lt: range.gte } };
      if (range.gte && range.lt) periodWhere.entryDate = { gte: range.gte, lt: range.lt };
    } else if (dateFrom) {
      const range = buildDateRange(dateFrom, null);
      if (range.gte) {
        openingWhere = { ...baseWhere, entryDate: { lt: range.gte } };
        periodWhere.entryDate = { gte: range.gte };
      }
    } else if (dateTo) {
      const range = buildDateRange(null, dateTo);
      if (range.lt) {
        openingWhere = null; // no prior period — opening is zero
        periodWhere.entryDate = { lt: range.lt };
      }
    }
    // else: no dates at all — opening = 0, period = all entries

    // Opening balance as Prisma.Decimal — never converted to number until serialization
    let openingDebitDec = ZERO;
    let openingCreditDec = ZERO;
    let openingBalanceDec = ZERO;
    if (openingWhere) {
      const openingAggregate = await prisma.journalEntry.aggregate({
        where: openingWhere,
        _sum: { debit: true, credit: true },
      });
      openingDebitDec = dec(openingAggregate._sum.debit);
      openingCreditDec = dec(openingAggregate._sum.credit);
      openingBalanceDec = openingDebitDec.minus(openingCreditDec);
    }

    const totalEntries = await prisma.journalEntry.count({ where: periodWhere });
    const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));

    // Prior pages cumulative sum — stays as Prisma.Decimal
    let priorDebit = ZERO;
    let priorCredit = ZERO;
    if (page > 1) {
      const priorEntries = await prisma.journalEntry.findMany({
        where: periodWhere,
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: (page - 1) * PAGE_SIZE,
        select: { debit: true, credit: true },
      });
      for (const e of priorEntries) {
        priorDebit = priorDebit.plus(e.debit);
        priorCredit = priorCredit.plus(e.credit);
      }
    }

    let runningBalance = openingBalanceDec.plus(priorDebit).minus(priorCredit);

    const entries = await prisma.journalEntry.findMany({
      where: periodWhere,
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        transactionId: true,
        lineNumber: true,
        debit: true,
        credit: true,
        currencyCode: true,
        exchangeRate: true,
        description: true,
        entityType: true,
        entityId: true,
        lotId: true,
        cityId: true,
        entryDate: true,
        createdAt: true,
      },
    });

    const entriesWithBalance: any[] = [];
    for (const entry of entries) {
      runningBalance = runningBalance.plus(entry.debit).minus(entry.credit);
      entriesWithBalance.push({
        ...entry,
        debit: roundDecStr(dec(entry.debit)),
        credit: roundDecStr(dec(entry.credit)),
        currencyCode: normalizeCurrency(entry.currencyCode),
        balance: roundDecStr(runningBalance),
        entryDate: entry.entryDate.toISOString().slice(0, 10),
        sourcePath: sourcePath(entry.entityType, entry.entityId),
      });
    }

    // Closing balance from aggregate — Decimal throughout, convert only for response
    const periodAggregate = await prisma.journalEntry.aggregate({
      where: periodWhere,
      _sum: { debit: true, credit: true },
    });
    const totalPeriodDebitDec = dec(periodAggregate._sum.debit);
    const totalPeriodCreditDec = dec(periodAggregate._sum.credit);
    const closingBalanceDec = openingBalanceDec.plus(totalPeriodDebitDec).minus(totalPeriodCreditDec);

    return paginatedResponse(
      entriesWithBalance,
      totalEntries,
      page,
      PAGE_SIZE,
      "Success",
      {
        account: { id: account.id, code: account.code, name: account.name, type: account.accountType },
        openingDebit: roundDecStr(openingDebitDec),
        openingCredit: roundDecStr(openingCreditDec),
        openingBalance: roundDecStr(openingBalanceDec),
        closingBalance: roundDecStr(closingBalanceDec),
        filters: {
          dateFrom: dateFrom || "all",
          dateTo: dateTo || "all",
          cityId: cityId || "all",
          currency: currencyParam || "all",
        },
      },
    );
  } catch (error) {
    console.error("Account ledger error:", error);
    return serverError();
  }
});
