import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { formatBankDepositCashLedgerLine } from "@/lib/bank-deposit-ledger";
import { finalizeLedgerForDisplay } from "@/lib/ledger-display";
import { getLedgerPaginationParams, paginateList } from "@/lib/pagination";

// Chronological "Cash in Office" ledger. Every row here moves the SAME pot that
// /api/v1/treasury computes as `cashInOffice`, using identical filters, so the
// final running balance per currency reconciles exactly with that endpoint:
//
//   cashInOffice = openingCash + cashPayments
//                - hajiTransfers(cash_office)
//                - expenses(cash_office)
//                - bankDeposits(cashAmount)
//                - withdrawals(cash_office)

type LedgerRow = {
  key: string;
  date: Date;
  createdAt: Date;
  type: string;
  detail: string;
  reference: string | null;
  currencyId: number;
  credit: number;
  debit: number;
  runningBalance?: number;
  currencyCode?: string;
};

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestedCityId = searchParams.get("cityId")
      ? parseInt(searchParams.get("cityId")!)
      : undefined;
    const cityId = getCityScope(user, requestedCityId);

    if (!cityId) {
      return errorResponse(
        "VALIDATION_ERROR",
        "cityId is required for super_admin when not filtering by city"
      );
    }

    const [openingCash, cashPayments, hajiOut, expenseOut, deposits, withdrawalsOut] =
      await Promise.all([
        prisma.openingCash.findMany({
          where: { cityId },
          select: { id: true, openingDate: true, createdAt: true, amount: true, currencyId: true, notes: true },
        }),
        prisma.payment.findMany({
          where: {
            cityId,
            paymentMethod: "cash",
            destination: "our_account",
            status: "active",
          },
          select: {
            id: true,
            paymentDate: true,
            createdAt: true,
            amount: true,
            currencyId: true,
            detail: true,
            manualVoucherNo: true,
            customer: { select: { name: true } },
          },
        }),
        prisma.hajiTransfer.findMany({
          where: { cityId, sourceType: "cash_office" },
          select: { id: true, transferDate: true, createdAt: true, amount: true, currencyId: true, detail: true },
        }),
        prisma.expense.findMany({
          where: { cityId, paidFrom: "cash_office", deletedAt: null },
          select: { id: true, expenseDate: true, createdAt: true, amount: true, currencyId: true, detail: true },
        }),
        prisma.bankDeposit.findMany({
          where: { cityId },
          select: {
            id: true,
            depositDate: true,
            createdAt: true,
            cashAmount: true,
            currencyId: true,
            slipNumber: true,
            cheques: {
              select: { chequeNumber: true, chequeBank: true },
            },
          },
        }),
        prisma.personalWithdrawal.findMany({
          where: { cityId, sourceType: "cash_office", approvedAt: { not: null } } as any,
          select: { id: true, withdrawalDate: true, createdAt: true, amount: true, currencyId: true, detail: true },
        }),
      ]);

    const rows: LedgerRow[] = [];

    for (const o of openingCash) {
      rows.push({
        key: `open-${o.id}`,
        date: new Date(o.openingDate),
        createdAt: new Date(o.createdAt),
        type: "Opening Cash",
        detail: o.notes || "Opening cash balance",
        reference: null,
        currencyId: o.currencyId,
        credit: Number(o.amount),
        debit: 0,
      });
    }
    for (const p of cashPayments) {
      rows.push({
        key: `pay-${p.id}`,
        date: new Date(p.paymentDate),
        createdAt: new Date(p.createdAt),
        type: p.customer?.name || "Customer",
        detail: "cash received",
        reference: p.manualVoucherNo || null,
        currencyId: p.currencyId,
        credit: Number(p.amount),
        debit: 0,
      });
    }
    for (const h of hajiOut) {
      rows.push({
        key: `haji-${h.id}`,
        date: new Date(h.transferDate),
        createdAt: new Date(h.createdAt),
        type: "Haji Transfer",
        detail: h.detail || "Transfer to Haji",
        reference: null,
        currencyId: h.currencyId,
        credit: 0,
        debit: Number(h.amount),
      });
    }
    for (const e of expenseOut) {
      rows.push({
        key: `exp-${e.id}`,
        date: new Date(e.expenseDate),
        createdAt: new Date(e.createdAt),
        type: "Expense",
        detail: e.detail || "Expense",
        reference: null,
        currencyId: e.currencyId,
        credit: 0,
        debit: Number(e.amount),
      });
    }
    for (const d of deposits) {
      // Positive cashAmount = cash leaving office into bank (debit).
      // Negative cashAmount = cash withdrawn from bank back to office (credit).
      const cash = Number(d.cashAmount || 0);
      const { type, detail, reference } = formatBankDepositCashLedgerLine({
        slipNumber: d.slipNumber,
        cashAmount: cash,
        cheques: d.cheques,
      });
      rows.push({
        key: `dep-${d.id}`,
        date: new Date(d.depositDate),
        createdAt: new Date(d.createdAt),
        type,
        detail,
        reference,
        currencyId: d.currencyId,
        credit: cash < 0 ? Math.abs(cash) : 0,
        debit: cash > 0 ? cash : 0,
      });
    }
    for (const w of withdrawalsOut) {
      rows.push({
        key: `wd-${w.id}`,
        date: new Date(w.withdrawalDate),
        createdAt: new Date(w.createdAt),
        type: "Withdrawal",
        detail: w.detail || "Personal withdrawal",
        reference: null,
        currencyId: w.currencyId,
        credit: 0,
        debit: Number(w.amount),
      });
    }

    // Resolve currency codes
    const currencyIds = Array.from(new Set(rows.map((r) => r.currencyId)));
    const currencies =
      currencyIds.length > 0
        ? await prisma.currency.findMany({
            where: { id: { in: currencyIds } },
            select: { id: true, code: true },
          })
        : [];
    const codeById: Record<number, string> = {};
    for (const c of currencies) codeById[c.id] = c.code;
    for (const r of rows) r.currencyCode = codeById[r.currencyId] ?? String(r.currencyId);

    const { ledger, balanceByCurrency } = finalizeLedgerForDisplay(
      rows.map(({ currencyId: _omit, ...rest }) => ({
        ...rest,
        currencyCode: rest.currencyCode ?? String(_omit),
      }))
    );

    const { page, limit } = getLedgerPaginationParams(searchParams);
    const { items: pagedLedger, pagination } = paginateList(ledger, page, limit);

    return NextResponse.json({
      success: true,
      data: {
        ledger: pagedLedger,
        balanceByCurrency,
      },
      pagination,
    });
  } catch (error) {
    return serverError();
  }
});
