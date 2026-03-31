import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/accounting?report=cash|pnl|balance_sheet|receivables|payables
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const report = request.nextUrl.searchParams.get("report") || "cash";
    const year = request.nextUrl.searchParams.get("year") ? parseInt(request.nextUrl.searchParams.get("year")!) : undefined;
    const cityId = request.nextUrl.searchParams.get("city_id") ? parseInt(request.nextUrl.searchParams.get("city_id")!) : (user.role === "city_admin" ? user.cityId : undefined);

    switch (report) {
      case "cash": return await cashPositionReport(cityId);
      case "pnl": return await pnlReport(year, cityId);
      case "balance_sheet": return await balanceSheetReport(cityId);
      case "receivables": return await receivablesReport(cityId);
      case "payables": return await payablesReport();
      default: return await cashPositionReport(cityId);
    }
  } catch (error) { console.error("Accounting report error:", error); return serverError(); }
});

async function cashPositionReport(cityId?: number | null) {
  // Fix P1: cash accounts are keyed as "1001-CITY{id}" (accounting.ts getCashAccountId),
  // not "CASH-". The old prefix matched nothing so this always fell to the broken fallback.
  const cashAccounts = await prisma.account.findMany({
    where: { code: { startsWith: "1001-CITY" }, isActive: true },
    include: { city: { select: { id: true, name: true } } },
  });

  const cashPositions = [];
  for (const acc of cashAccounts) {
    if (cityId && acc.cityId !== cityId) continue;

    // Group by currency
    const entries = await prisma.journalEntry.findMany({ where: { accountId: acc.id } });
    const byCurrency: Record<string, number> = {};
    for (const e of entries) {
      if (!byCurrency[e.currencyCode]) byCurrency[e.currencyCode] = 0;
      byCurrency[e.currencyCode] += Number(e.debit) - Number(e.credit);
    }
    for (const [currency, balance] of Object.entries(byCurrency)) {
      cashPositions.push({ cityId: acc.cityId, cityName: acc.city?.name || "Unknown", currency, balance: Math.round(balance * 100) / 100 });
    }
  }

  // Also get from payments/expenses directly if no journal entries yet
  if (cashPositions.length === 0) {
    const cities = await prisma.city.findMany({ where: cityId ? { id: cityId } : { isActive: true }, include: { country: true, cityCurrencies: { include: { currency: true } } } });
    for (const city of cities) {
      for (const cc of city.cityCurrencies) {
        // Fix P1: only count cash payments as inflow — previously all payment methods
        // (bank_transfer, online, cheque) were included, overstating cash in office.
        const paymentsIn = await prisma.payment.aggregate({ where: { cityId: city.id, status: "active", currencyId: cc.currencyId, destination: "our_account", paymentMethod: "cash" }, _sum: { amount: true } });
        // Fix P2: exclude soft-deleted expenses from outflow calculation
        const expensesOut = await prisma.expense.aggregate({ where: { cityId: city.id, currencyId: cc.currencyId, deletedAt: null }, _sum: { amount: true } });
        const withdrawals = await prisma.personalWithdrawal.aggregate({ where: { cityId: city.id, currencyId: cc.currencyId }, _sum: { amount: true } });
        const hajiOut = await prisma.hajiTransfer.aggregate({ where: { cityId: city.id, currencyId: cc.currencyId }, _sum: { amount: true } });

        const inflow = Number(paymentsIn._sum.amount || 0);
        const outflow = Number(expensesOut._sum.amount || 0) + Number(withdrawals._sum.amount || 0) + Number(hajiOut._sum.amount || 0);
        cashPositions.push({ cityId: city.id, cityName: city.name, currency: cc.currency.code, balance: Math.round((inflow - outflow) * 100) / 100 });
      }
    }
  }

  return successResponse({ report: "cash_position", positions: cashPositions, totalByCurrency: groupByCurrency(cashPositions) });
}

async function pnlReport(year?: number, cityId?: number | null) {
  const dateFilter: any = {};
  if (year) { dateFilter.gte = new Date(`${year}-01-01`); dateFilter.lte = new Date(`${year}-12-31`); }

  const saleWhere: any = { status: "active" };
  // Fix P2: exclude soft-deleted expenses
  const expWhere: any = { deletedAt: null };
  if (cityId) { saleWhere.cityId = cityId; expWhere.cityId = cityId; }
  if (year) { saleWhere.saleDate = dateFilter; expWhere.expenseDate = dateFilter; }

  // Revenue by currency
  const sales = await prisma.sale.findMany({ where: saleWhere, include: { currency: true } });
  const revenueByCurrency: Record<string, number> = {};
  for (const s of sales) {
    const cc = s.currency.code;
    revenueByCurrency[cc] = (revenueByCurrency[cc] || 0) + Number(s.totalAmount);
  }

  // Expenses by currency (soft-deleted excluded)
  const expenses = await prisma.expense.findMany({ where: expWhere, include: { currency: true } });
  const expenseByCurrency: Record<string, number> = {};
  for (const e of expenses) {
    const cc = e.currency.code;
    expenseByCurrency[cc] = (expenseByCurrency[cc] || 0) + Number(e.amount);
  }

  // Withdrawals
  const wdWhere: any = {};
  if (cityId) wdWhere.cityId = cityId;
  if (year) wdWhere.withdrawalDate = dateFilter;
  const withdrawals = await prisma.personalWithdrawal.findMany({ where: wdWhere, include: { currency: true } });
  const withdrawalByCurrency: Record<string, number> = {};
  for (const w of withdrawals) { const cc = w.currency.code; withdrawalByCurrency[cc] = (withdrawalByCurrency[cc] || 0) + Number(w.amount); }

  // Fix P1: COGS from lot purchases — filter by year via lot date so we don't include
  // all-time purchases when a year-specific or city-specific report is requested.
  // LotPurchase/LotCost aren't city-stamped, so we filter via the lot's date range.
  const lotWhere: any = {};
  if (year) lotWhere.lotDate = { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) };
  const lotsInScope = year
    ? await prisma.lot.findMany({ where: lotWhere, select: { id: true } })
    : null;
  const lotIdFilter = lotsInScope ? { lotId: { in: lotsInScope.map((l) => l.id) } } : {};
  const lotPurchases = await prisma.lotPurchase.aggregate({ where: lotIdFilter, _sum: { totalPriceUsd: true } });
  const lotCosts = await prisma.lotCost.aggregate({ where: lotIdFilter, _sum: { amount: true } });

  return successResponse({
    report: "profit_and_loss", period: year ? `Year ${year}` : "All Time",
    revenueByCurrency: roundObject(revenueByCurrency),
    expenseByCurrency: roundObject(expenseByCurrency),
    withdrawalByCurrency: roundObject(withdrawalByCurrency),
    cogsUsd: Number(lotPurchases._sum.totalPriceUsd || 0) + Number(lotCosts._sum.amount || 0),
    profitByCurrency: Object.keys(revenueByCurrency).reduce((acc, cc) => {
      acc[cc] = Math.round(((revenueByCurrency[cc] || 0) - (expenseByCurrency[cc] || 0)) * 100) / 100;
      return acc;
    }, {} as Record<string, number>),
  });
}

async function balanceSheetReport(cityId?: number | null) {
  // Assets: cash + receivables + inventory
  // Liabilities: supplier payable + agent payable
  // Equity: capital + retained - withdrawals

  const saleWhere: any = { status: "active" };
  const payWhere: any = { status: "active" };
  if (cityId) { saleWhere.cityId = cityId; payWhere.cityId = cityId; }

  // Receivables by currency
  const sales = await prisma.sale.findMany({ where: saleWhere, include: { currency: true } });
  const payments = await prisma.payment.findMany({ where: payWhere, include: { currency: true } });

  const salesByCurrency: Record<string, number> = {};
  for (const s of sales) { salesByCurrency[s.currency.code] = (salesByCurrency[s.currency.code] || 0) + Number(s.totalAmount); }
  const paymentsByCurrency: Record<string, number> = {};
  for (const p of payments) { paymentsByCurrency[p.currency.code] = (paymentsByCurrency[p.currency.code] || 0) + Number(p.amount); }

  const receivablesByCurrency: Record<string, number> = {};
  for (const cc of Object.keys(salesByCurrency)) {
    receivablesByCurrency[cc] = Math.round(((salesByCurrency[cc] || 0) - (paymentsByCurrency[cc] || 0)) * 100) / 100;
  }

  // Supplier payable
  const totalPurchased = Number((await prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } }))._sum.totalPriceUsd || 0);
  const totalPaid = Number((await prisma.supplierPayment.aggregate({ _sum: { amountUsd: true } }))._sum.amountUsd || 0);

  return successResponse({
    report: "balance_sheet",
    assets: { receivablesByCurrency: roundObject(receivablesByCurrency) },
    liabilities: { supplierPayableUsd: Math.round((totalPurchased - totalPaid) * 100) / 100 },
  });
}

async function receivablesReport(cityId?: number | null) {
  const custWhere: any = { isActive: true };
  if (cityId) custWhere.cityId = cityId;

  const customers = await prisma.customer.findMany({
    where: custWhere,
    include: {
      city: { select: { name: true } },
      sales: { where: { status: "active" }, include: { currency: true } },
      payments: { where: { status: "active" }, include: { currency: true } },
    },
  });

  const receivables = customers.map(c => {
    const salesByCurrency: Record<string, number> = {};
    const paymentsByCurrency: Record<string, number> = {};
    for (const s of c.sales) { salesByCurrency[s.currency.code] = (salesByCurrency[s.currency.code] || 0) + Number(s.totalAmount); }
    for (const p of c.payments) { paymentsByCurrency[p.currency.code] = (paymentsByCurrency[p.currency.code] || 0) + Number(p.amount); }
    const balanceByCurrency: Record<string, number> = {};
    for (const cc of Array.from(new Set([...Object.keys(salesByCurrency), ...Object.keys(paymentsByCurrency)]))) {
      const bal = (salesByCurrency[cc] || 0) - (paymentsByCurrency[cc] || 0);
      if (Math.abs(bal) > 0.01) balanceByCurrency[cc] = Math.round(bal * 100) / 100;
    }
    return { id: c.id, name: c.name, city: c.city.name, balanceByCurrency };
  }).filter(c => Object.keys(c.balanceByCurrency).length > 0);

  // Total by currency
  const totalByCurrency: Record<string, number> = {};
  for (const c of receivables) {
    for (const [cc, bal] of Object.entries(c.balanceByCurrency)) {
      totalByCurrency[cc] = (totalByCurrency[cc] || 0) + bal;
    }
  }

  return successResponse({ report: "receivables", customers: receivables, totalByCurrency: roundObject(totalByCurrency) });
}

async function payablesReport() {
  // Supplier
  const totalPurchased = Number((await prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } }))._sum.totalPriceUsd || 0);
  const totalPaid = Number((await prisma.supplierPayment.aggregate({ _sum: { amountUsd: true } }))._sum.amountUsd || 0);

  // Agents
  const agents = await prisma.agent.findMany({
    where: { isActive: true },
    include: {
      city: { select: { name: true } },
      lotCosts: { where: { paidFromCash: false } },
      agentPayments: true,
    },
  });

  const agentPayables = agents.map(a => {
    const totalBilled: Record<string, number> = {};
    const totalPaidAgent: Record<string, number> = {};
    for (const c of a.lotCosts) { totalBilled[c.currencyCode] = (totalBilled[c.currencyCode] || 0) + Number(c.amount); }
    for (const p of a.agentPayments) { totalPaidAgent[p.currencyCode] = (totalPaidAgent[p.currencyCode] || 0) + Number(p.amount); }
    const balanceByCurrency: Record<string, number> = {};
    for (const cc of Array.from(new Set([...Object.keys(totalBilled), ...Object.keys(totalPaidAgent)]))) {
      const bal = (totalBilled[cc] || 0) - (totalPaidAgent[cc] || 0);
      if (Math.abs(bal) > 0.01) balanceByCurrency[cc] = Math.round(bal * 100) / 100;
    }
    return { id: a.id, name: a.name, agentType: a.agentType, city: a.city?.name, balanceByCurrency };
  }).filter(a => Object.keys(a.balanceByCurrency).length > 0);

  return successResponse({
    report: "payables",
    supplier: { totalPurchasedUsd: totalPurchased, totalPaidUsd: totalPaid, balanceUsd: Math.round((totalPurchased - totalPaid) * 100) / 100 },
    agents: agentPayables,
  });
}

function groupByCurrency(positions: any[]) {
  const totals: Record<string, number> = {};
  for (const p of positions) { totals[p.currency] = (totals[p.currency] || 0) + p.balance; }
  return roundObject(totals);
}

function roundObject(obj: Record<string, number>) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100]));
}
