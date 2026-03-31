import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const report = sp.get("report"); // pnl, balance_sheet, cash, receivables, payables
    const year = sp.get("year") ? parseInt(sp.get("year")!) : new Date().getFullYear();
    const cityId = sp.get("city_id") ? parseInt(sp.get("city_id")!) : undefined;

    switch (report) {
      case "pnl": return await profitAndLoss(year, cityId);
      case "balance_sheet": return await balanceSheet(cityId);
      case "cash": return await cashPosition(cityId);
      case "receivables": return await receivables(cityId);
      case "payables": return await payables();
      default: return errorResponse("VALIDATION_ERROR", "report param required: pnl, balance_sheet, cash, receivables, payables");
    }
  } catch (error) { console.error("Financial report error:", error); return serverError(); }
});

async function profitAndLoss(year: number, cityId?: number) {
  const dateFrom = new Date(`${year}-01-01`);
  const dateTo = new Date(`${year}-12-31`);
  const where: any = { entryDate: { gte: dateFrom, lte: dateTo } };
  if (cityId) where.cityId = cityId;

  // Single groupBy instead of findMany — returns one row per (account, currency)
  const [groups, accounts] = await Promise.all([
    prisma.journalEntry.groupBy({
      by: ["accountId", "currencyCode"],
      where,
      _sum: { debit: true, credit: true },
    }),
    prisma.account.findMany({ select: { id: true, name: true, accountType: true } }),
  ]);

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const byCurrency: Record<string, { revenue: number; cogs: number; expenses: Record<string, number>; expenseTotal: number }> = {};

  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const curr = g.currencyCode;
    if (!byCurrency[curr]) byCurrency[curr] = { revenue: 0, cogs: 0, expenses: {}, expenseTotal: 0 };
    const debit = Number(g._sum.debit || 0);
    const credit = Number(g._sum.credit || 0);

    if (acc.accountType === "revenue") { byCurrency[curr].revenue += credit - debit; }
    else if (acc.accountType === "cogs") { byCurrency[curr].cogs += debit - credit; }
    else if (acc.accountType === "expense") {
      const name = acc.name;
      byCurrency[curr].expenses[name] = (byCurrency[curr].expenses[name] || 0) + debit - credit;
      byCurrency[curr].expenseTotal += debit - credit;
    }
  }

  // If no COGS journal entries exist yet (legacy data), compute from purchases + costs
  const hasCOGSJournals = Object.values(byCurrency).some(d => d.cogs > 0);
  if (!hasCOGSJournals) {
    const [purchases, costs] = await Promise.all([
      prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } }),
      prisma.lotCost.aggregate({ _sum: { amount: true } }),
    ]);
    const directCOGS = Number(purchases._sum.totalPriceUsd || 0) + Number(costs._sum.amount || 0);
    if (directCOGS > 0) {
      if (!byCurrency["USD"]) byCurrency["USD"] = { revenue: 0, cogs: 0, expenses: {}, expenseTotal: 0 };
      byCurrency["USD"].cogs = directCOGS;
    }
  }

  const result: any[] = [];
  for (const [currency, data] of Object.entries(byCurrency)) {
    const grossProfit = data.revenue - data.cogs;
    const netProfit = grossProfit - data.expenseTotal;
    result.push({
      currency, revenue: r2(data.revenue), cogs: r2(data.cogs),
      grossProfit: r2(grossProfit), grossMargin: data.revenue ? r2(grossProfit / data.revenue * 100) : 0,
      expenses: data.expenses, expenseTotal: r2(data.expenseTotal),
      netProfit: r2(netProfit), netMargin: data.revenue ? r2(netProfit / data.revenue * 100) : 0,
    });
  }

  return successResponse({ year, cityId: cityId || "all", pnl: result });
}

async function balanceSheet(cityId?: number) {
  // Fetch all active accounts and their journal entry totals in two queries
  const accounts = await prisma.account.findMany({ where: { isActive: true } });

  // Filter accounts by cityId upfront
  const relevantAccounts = cityId
    ? accounts.filter((a) => !a.cityId || a.cityId === cityId)
    : accounts;
  const accountIds = relevantAccounts.map((a) => a.id);
  const accountMap = Object.fromEntries(relevantAccounts.map((a) => [a.id, a]));

  if (accountIds.length === 0) return successResponse({ assets: [], liabilities: [], equity: [], revenue: [], expenses: [] });

  // One groupBy for all accounts instead of one per account
  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: accountIds } },
    _sum: { debit: true, credit: true },
  });

  const balances: any[] = [];
  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const debit = Number(g._sum.debit || 0);
    const credit = Number(g._sum.credit || 0);
    let balance = 0;
    // Assets & Expenses: debit increases
    if (["asset", "expense", "cogs"].includes(acc.accountType)) balance = debit - credit;
    // Liabilities, Revenue, Equity: credit increases
    else balance = credit - debit;

    if (Math.abs(balance) > 0.01) {
      balances.push({ code: acc.code, name: acc.name, type: acc.accountType, currency: g.currencyCode, balance: r2(balance) });
    }
  }

  return successResponse({
    assets: balances.filter((b) => b.type === "asset"),
    liabilities: balances.filter((b) => b.type === "liability"),
    equity: balances.filter((b) => b.type === "equity"),
    revenue: balances.filter((b) => b.type === "revenue"),
    expenses: balances.filter((b) => ["expense", "cogs"].includes(b.type)),
  });
}

async function cashPosition(cityId?: number) {
  // Get all cash, cheque, bank, and intermediary accounts
  const codeFilter = { OR: [
    { code: { startsWith: "1001-CITY" } },   // cash in hand per city
    { code: { startsWith: "1002-CHEQUE" } }, // cheques in hand per city
    { code: { startsWith: "1050-BANK" } },   // specific bank accounts
    { code: "1050" },                         // generic bank (legacy)
    { code: { startsWith: "1060-H" } },       // intermediary balances
  ]};

  const allAccounts = await prisma.account.findMany({
    where: { isActive: true, AND: [codeFilter, cityId ? { OR: [{ cityId }, { cityId: null }] } : {}] },
  });

  const accountIds = allAccounts.map((a) => a.id);
  const accountMap = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

  if (accountIds.length === 0) return successResponse({ cashPositions: [], bankPositions: [], intermediaryPositions: [] });

  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: accountIds } },
    _sum: { debit: true, credit: true },
  });

  const cashPositions: any[] = [];
  const bankPositions: any[] = [];
  const intermediaryPositions: any[] = [];

  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const balance = Number(g._sum.debit || 0) - Number(g._sum.credit || 0);
    if (Math.abs(balance) < 0.01) continue;

    const entry = { account: acc.name, cityId: acc.cityId ?? null, currency: g.currencyCode, balance: r2(balance) };
    if (acc.code.startsWith("1001-") || acc.code.startsWith("1002-")) cashPositions.push(entry);
    else if (acc.code.startsWith("1050")) bankPositions.push(entry);
    else if (acc.code.startsWith("1060-")) intermediaryPositions.push(entry);
  }

  return successResponse({ cashPositions, bankPositions, intermediaryPositions });
}

async function receivables(cityId?: number) {
  // All customer AR accounts
  const arAccounts = await prisma.account.findMany({ where: { code: { startsWith: "1200-C" }, isActive: true } });
  const arIds = arAccounts.map((a) => a.id);
  const accountMap = Object.fromEntries(arAccounts.map((a) => [a.id, a]));

  if (arIds.length === 0) return successResponse({ totalByCurrency: {}, customers: [] });

  // One groupBy for all AR accounts
  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: arIds }, ...(cityId ? { cityId } : {}) },
    _sum: { debit: true, credit: true },
  });

  const customers: any[] = [];
  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const balance = Number(g._sum.debit || 0) - Number(g._sum.credit || 0);
    if (Math.abs(balance) > 0.5) {
      customers.push({ account: acc.name, currency: g.currencyCode, balance: r2(balance) });
    }
  }

  customers.sort((a, b) => b.balance - a.balance);
  const byCurrency: Record<string, number> = {};
  for (const c of customers) { byCurrency[c.currency] = (byCurrency[c.currency] || 0) + c.balance; }

  return successResponse({ totalByCurrency: byCurrency, customers });
}

async function payables() {
  // Get all supplier and agent accounts in one query
  const [suppAccounts, agentAccounts] = await Promise.all([
    prisma.account.findMany({ where: { code: { startsWith: "2100-S" } } }),
    prisma.account.findMany({ where: { code: { startsWith: "2200-A" } } }),
  ]);

  const suppIds = new Set(suppAccounts.map((a) => a.id));
  const allIds = [...suppAccounts, ...agentAccounts].map((a) => a.id);
  const accountMap = Object.fromEntries([...suppAccounts, ...agentAccounts].map((a) => [a.id, a]));

  if (allIds.length === 0) return successResponse({ suppliers: [], agents: [] });

  // One groupBy for all payable accounts instead of one per account
  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: allIds } },
    _sum: { debit: true, credit: true },
  });

  const suppliers: any[] = [];
  const agents: any[] = [];
  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const balance = Number(g._sum.credit || 0) - Number(g._sum.debit || 0);
    if (Math.abs(balance) > 0.5) {
      const entry = { account: acc.name, currency: g.currencyCode, balance: r2(balance) };
      if (suppIds.has(g.accountId)) suppliers.push(entry);
      else agents.push(entry);
    }
  }

  return successResponse({ suppliers, agents });
}

function r2(n: number) { return Math.round(n * 100) / 100; }
