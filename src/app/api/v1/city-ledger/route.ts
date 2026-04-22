import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/city-ledger?city_id=1
// Returns a chronological ledger of all financial transactions for a city
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cityId = user.role === "city_admin" ? user.cityId! : (searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    if (!cityId) return errorResponse("VALIDATION_ERROR", "city_id is required");

    const dateFromStr = searchParams.get("date_from");
    const dateToStr = searchParams.get("date_to");

    // Validate date strings — ignore invalid inputs rather than passing Invalid Date to Prisma
    const parseDate = (s: string | null): Date | undefined => {
      if (!s) return undefined;
      const d = new Date(s);
      return isNaN(d.getTime()) ? undefined : d;
    };
    const dateFrom = parseDate(dateFromStr);
    const dateTo = parseDate(dateToStr);

    const dateFilter = (field: string) => {
      const f: any = {};
      if (dateFrom) f.gte = dateFrom;
      if (dateTo) f.lte = dateTo;
      return Object.keys(f).length ? { [field]: f } : {};
    };

    // Fetch all financial transactions for this city
    const [sales, payments, expenses, withdrawals, hajiTransfers, bankDeposits] = await Promise.all([
      prisma.sale.findMany({
        where: { cityId, status: { in: ["active", "marked_short"] }, ...dateFilter("saleDate") },
        include: { customer: { select: { name: true } }, currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { saleDate: "asc" },
      }),
      prisma.payment.findMany({
        where: { cityId, status: "active", ...dateFilter("paymentDate") },
        include: { customer: { select: { name: true } }, currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.expense.findMany({
        where: { cityId, deletedAt: null, ...dateFilter("expenseDate") },
        include: { currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { expenseDate: "asc" },
      }),
      prisma.personalWithdrawal.findMany({
        where: { cityId, ...dateFilter("withdrawalDate") },
        include: { currency: true },
        orderBy: { withdrawalDate: "asc" },
      }),
      prisma.hajiTransfer.findMany({
        where: { cityId, ...dateFilter("transferDate") },
        include: { currency: true, lot: { select: { lotNumber: true } } },
        orderBy: { transferDate: "asc" },
      }),
      prisma.bankDeposit.findMany({
        where: { cityId, ...dateFilter("depositDate") },
        include: { currency: true, bankAccount: { select: { bankName: true } }, cheques: { select: { id: true, amount: true } } },
        orderBy: { depositDate: "asc" },
      }),
    ]);

    // Build ledger entries
    const entries: any[] = [];

    for (const s of sales) {
      entries.push({
        date: s.saleDate.toISOString().split("T")[0],
        type: "sale", category: "Revenue",
        description: `Sale to ${s.customer.name} (V# ${s.voucherNo})`,
        debit: Number(s.totalAmount), credit: 0,
        currency: s.currency.code, lot: s.lot.lotNumber,
        account: "Receivables", counterAccount: "Revenue",
      });
    }

    for (const p of payments) {
      const isInHand = p.destination === "our_account";
      entries.push({
        date: p.paymentDate.toISOString().split("T")[0],
        type: "payment", category: isInHand ? "Cash In" : "Direct to Haji",
        description: `${p.detail} from ${p.customer.name} (${p.paymentMethod})`,
        debit: 0, credit: Number(p.amount),
        currency: p.currency.code, lot: p.lot.lotNumber,
        account: isInHand ? "Cash In Hand" : "Haji Account",
        counterAccount: "Receivables",
        method: p.paymentMethod, destination: p.destination,
      });
    }

    for (const e of expenses) {
      entries.push({
        date: e.expenseDate.toISOString().split("T")[0],
        type: "expense", category: "Expense",
        description: e.detail,
        debit: Number(e.amount), credit: 0,
        currency: e.currency.code, lot: e.lot.lotNumber,
        account: "Expenses", counterAccount: "Cash In Hand",
      });
    }

    for (const w of withdrawals) {
      entries.push({
        date: w.withdrawalDate.toISOString().split("T")[0],
        type: "withdrawal", category: "Personal Withdrawal",
        description: w.detail,
        debit: Number(w.amount), credit: 0,
        currency: w.currency.code, lot: null,
        account: "Personal Drawings", counterAccount: "Cash In Hand",
      });
    }

    for (const h of hajiTransfers) {
      entries.push({
        date: h.transferDate.toISOString().split("T")[0],
        type: "haji_transfer", category: "Transfer to Haji",
        description: `${h.detail} (${h.transferType === "direct" ? "Direct" : "From In-Hand"})`,
        debit: Number(h.amount), credit: 0,
        currency: h.currency.code, lot: h.lot.lotNumber,
        account: "Haji Account", counterAccount: h.transferType === "from_in_hand" ? "Cash In Hand" : "Bank",
        transferType: h.transferType,
      });
    }

    for (const b of bankDeposits) {
      const cashAmount = Number(b.cashAmount || 0);
      const isCashMovement = cashAmount !== 0;
      if (!isCashMovement) continue;
      const abs = Math.abs(cashAmount);
      entries.push({
        date: b.depositDate.toISOString().split("T")[0],
        type: "bank_cash_transfer",
        category: cashAmount > 0 ? "Cash to Bank" : "Bank to Cash",
        description: `${cashAmount > 0 ? "Cash deposited to" : "Cash withdrawn from"} ${b.bankAccount?.bankName || "bank account"}`,
        debit: cashAmount > 0 ? abs : 0,
        credit: cashAmount < 0 ? abs : 0,
        currency: b.currency.code,
        lot: null,
        account: cashAmount > 0 ? "Bank" : "Cash In Hand",
        counterAccount: cashAmount > 0 ? "Cash In Hand" : "Bank",
      });
    }

    // Sort by date
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate running balances per currency — avoids mixing AFN and USD amounts
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const cashByCurr: Record<string, number> = {};
    const receivablesByCurr: Record<string, number> = {};
    const hajiOwedByCurr: Record<string, number> = {};

    for (const e of entries) {
      const cc = e.currency;
      cashByCurr[cc] = cashByCurr[cc] || 0;
      receivablesByCurr[cc] = receivablesByCurr[cc] || 0;
      hajiOwedByCurr[cc] = hajiOwedByCurr[cc] || 0;

      if (e.type === "sale") { receivablesByCurr[cc] += e.debit; hajiOwedByCurr[cc] += e.debit; }
      if (e.type === "payment" && e.destination === "our_account") { cashByCurr[cc] += e.credit; receivablesByCurr[cc] -= e.credit; }
      if (e.type === "payment" && e.destination === "haji") { receivablesByCurr[cc] -= e.credit; hajiOwedByCurr[cc] -= e.credit; }
      if (e.type === "expense") { cashByCurr[cc] -= e.debit; hajiOwedByCurr[cc] -= e.debit; }
      if (e.type === "withdrawal") { cashByCurr[cc] -= e.debit; }
      if (e.type === "haji_transfer" && e.transferType === "from_in_hand") { cashByCurr[cc] -= e.debit; hajiOwedByCurr[cc] -= e.debit; }
      if (e.type === "haji_transfer" && e.transferType === "direct") { hajiOwedByCurr[cc] -= e.debit; }
      if (e.type === "bank_cash_transfer" && e.category === "Cash to Bank") { cashByCurr[cc] -= e.debit; }
      if (e.type === "bank_cash_transfer" && e.category === "Bank to Cash") { cashByCurr[cc] += e.credit; }

      e.runningCashInHand = r2(cashByCurr[cc]);
      e.runningReceivables = r2(receivablesByCurr[cc]);
      e.runningHajiOwed = r2(hajiOwedByCurr[cc]);
    }

    // Summary totals broken out by currency
    const summarySales: Record<string, number> = {};
    const summaryPayments: Record<string, number> = {};
    const summaryExpenses: Record<string, number> = {};
    const summaryWithdrawals: Record<string, number> = {};
    const summaryHaji: Record<string, number> = {};
    for (const x of sales) { const cc = x.currency.code; summarySales[cc] = r2((summarySales[cc] || 0) + Number(x.totalAmount)); }
    for (const x of payments) { const cc = x.currency.code; summaryPayments[cc] = r2((summaryPayments[cc] || 0) + Number(x.amount)); }
    for (const x of expenses) { const cc = x.currency.code; summaryExpenses[cc] = r2((summaryExpenses[cc] || 0) + Number(x.amount)); }
    for (const x of withdrawals) { const cc = x.currency.code; summaryWithdrawals[cc] = r2((summaryWithdrawals[cc] || 0) + Number(x.amount)); }
    for (const x of hajiTransfers) { const cc = x.currency.code; summaryHaji[cc] = r2((summaryHaji[cc] || 0) + Number(x.amount)); }
    const summaryBankCashTransfers: Record<string, number> = {};
    for (const x of bankDeposits) {
      const cc = x.currency.code;
      summaryBankCashTransfers[cc] = r2((summaryBankCashTransfers[cc] || 0) + Number(x.cashAmount || 0));
    }

    return successResponse({
      entries,
      summary: {
        cashInHand: Object.fromEntries(Object.entries(cashByCurr).map(([k, v]) => [k, r2(v)])),
        totalReceivables: Object.fromEntries(Object.entries(receivablesByCurr).map(([k, v]) => [k, r2(v)])),
        totalHajiOwed: Object.fromEntries(Object.entries(hajiOwedByCurr).map(([k, v]) => [k, r2(v)])),
        totalSalesByCurrency: summarySales,
        totalPaymentsByCurrency: summaryPayments,
        totalExpensesByCurrency: summaryExpenses,
        totalWithdrawalsByCurrency: summaryWithdrawals,
        totalHajiTransfersByCurrency: summaryHaji,
        totalBankCashTransfersByCurrency: summaryBankCashTransfers,
      },
    });
  } catch (error) {
    console.error("City ledger error:", error);
    return serverError();
  }
});
