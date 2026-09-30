import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { errorResponse, serverError, paginatedResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange } from "@/lib/date-range";
import { parseBusinessDateParam, parseCityIdParam } from "@/lib/report-params";

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

    if (dateFrom) {
      const fromCheck = parseBusinessDateParam(dateFrom, "date_from");
      if (fromCheck.errorMessage) return errorResponse("VALIDATION_ERROR", fromCheck.errorMessage);
    }
    if (dateTo) {
      const toCheck = parseBusinessDateParam(dateTo, "date_to");
      if (toCheck.errorMessage) return errorResponse("VALIDATION_ERROR", toCheck.errorMessage);
    }

    const cityCheck = await parseCityIdParam(cityIdParam);
    if (cityCheck.errorMessage) return errorResponse("VALIDATION_ERROR", cityCheck.errorMessage);
    const cityId = cityCheck.cityId;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, accountType: true, cityId: true },
    });
    if (!account) {
      return errorResponse("NOT_FOUND", "Account not found");
    }

    // Direct-entry ledgers never include descendant activity; report the subtree size
    // so the UI can label a parent account's ledger as direct-entries-only.
    const visited = new Set<number>([accountId]);
    let frontier = [accountId];
    while (frontier.length > 0) {
      const children = await prisma.account.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          frontier.push(child.id);
        }
      }
    }
    const descendantCount = visited.size - 1;

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

    // Per-currency buckets — a running balance is never combined across currencies.
    type Sums = { debit: Prisma.Decimal; credit: Prisma.Decimal };
    const zeroSums = (): Sums => ({ debit: ZERO, credit: ZERO });
    const accumulate = (map: Map<string, Sums>, code: string, debit: Prisma.Decimal | number | null, credit: Prisma.Decimal | number | null) => {
      const key = normalizeCurrency(code as string);
      const cur = map.get(key) || zeroSums();
      map.set(key, { debit: cur.debit.plus(dec(debit)), credit: cur.credit.plus(dec(credit)) });
    };

    // Opening balance per currency — Decimal throughout, converted only at response time
    const openingByCur = new Map<string, Sums>();
    if (openingWhere) {
      const openingGroups = await prisma.journalEntry.groupBy({
        by: ["currencyCode"],
        where: openingWhere,
        _sum: { debit: true, credit: true },
      });
      for (const g of openingGroups) accumulate(openingByCur, g.currencyCode, g._sum.debit, g._sum.credit);
    }

    const totalEntries = await prisma.journalEntry.count({ where: periodWhere });
    const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));

    // Prior pages cumulative sum per currency — stays as Prisma.Decimal
    const priorByCur = new Map<string, Sums>();
    if (page > 1) {
      const priorEntries = await prisma.journalEntry.findMany({
        where: periodWhere,
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: (page - 1) * PAGE_SIZE,
        select: { currencyCode: true, debit: true, credit: true },
      });
      for (const e of priorEntries) accumulate(priorByCur, e.currencyCode, e.debit, e.credit);
    }

    const runningByCur = new Map<string, Prisma.Decimal>();
    const runningOf = (code: string): Prisma.Decimal => {
      const key = normalizeCurrency(code);
      let value = runningByCur.get(key);
      if (value === undefined) {
        const open = openingByCur.get(key) || zeroSums();
        const prior = priorByCur.get(key) || zeroSums();
        value = open.debit.minus(open.credit).plus(prior.debit).minus(prior.credit);
        runningByCur.set(key, value);
      }
      return value;
    };

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
      const next = runningOf(entry.currencyCode).plus(entry.debit).minus(entry.credit);
      runningByCur.set(normalizeCurrency(entry.currencyCode), next);
      entriesWithBalance.push({
        ...entry,
        debit: roundDecStr(dec(entry.debit)),
        credit: roundDecStr(dec(entry.credit)),
        currencyCode: normalizeCurrency(entry.currencyCode),
        balance: roundDecStr(next),
        entryDate: entry.entryDate.toISOString().slice(0, 10),
        sourcePath: sourcePath(entry.entityType, entry.entityId),
      });
    }

    // Closing balance per currency from grouped aggregate
    const periodByCur = new Map<string, Sums>();
    const periodGroups = await prisma.journalEntry.groupBy({
      by: ["currencyCode"],
      where: periodWhere,
      _sum: { debit: true, credit: true },
    });
    for (const g of periodGroups) accumulate(periodByCur, g.currencyCode, g._sum.debit, g._sum.credit);

    const balances: Record<string, { openingDebit: number; openingCredit: number; openingBalance: number; closingBalance: number }> = {};
    const allKeys = new Set<string>([...openingByCur.keys(), ...periodByCur.keys()]);
    for (const key of allKeys) {
      const open = openingByCur.get(key) || zeroSums();
      const openBal = open.debit.minus(open.credit);
      const period = periodByCur.get(key) || zeroSums();
      balances[key] = {
        openingDebit: roundDecStr(open.debit),
        openingCredit: roundDecStr(open.credit),
        openingBalance: roundDecStr(openBal),
        closingBalance: roundDecStr(openBal.plus(period.debit).minus(period.credit)),
      };
    }
    const keys = Object.keys(balances).sort();
    const single = keys.length === 1 ? balances[keys[0]] : null;

    return paginatedResponse(
      entriesWithBalance,
      totalEntries,
      page,
      PAGE_SIZE,
      "Success",
      {
        account: { id: account.id, code: account.code, name: account.name, type: account.accountType },
        openingDebit: single ? single.openingDebit : null,
        openingCredit: single ? single.openingCredit : null,
        openingBalance: single ? single.openingBalance : null,
        closingBalance: single ? single.closingBalance : null,
        balances,
        descendantCount,
        directEntriesOnly: descendantCount > 0,
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
