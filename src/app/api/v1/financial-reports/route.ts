import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildAuthoritativeFinancialReportResult } from "@/lib/authoritative-financial-report";
import { classifyCustomerBalance } from "@/lib/customer-receivable-accounting";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const report = sp.get("report"); // pnl, balance_sheet, cash, receivables, payables
    const year = sp.get("year") ? parseInt(sp.get("year")!) : new Date().getFullYear();
    const requestedCityId = sp.get("city_id") ? parseInt(sp.get("city_id")!) : undefined;
    const cityId = requestedCityId;

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
  const report = await buildAuthoritativeFinancialReportResult({ year, cityId: cityId || null });
  return successResponse({
    year,
    cityId: cityId || "all",
    pnl: report.byCurrency,
    authoritativePkr: report.profitAndLoss,
    fxWarnings: report.fxWarnings,
    source: report.source,
  });
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

  // Fix P1: when filtering by city, also add cityId to the journal entry query so that
  // global accounts (inventory, revenue, COGS — no cityId on the account record itself)
  // only return entries belonging to this city, not all cities combined.
  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: accountIds }, ...(cityId ? { cityId } : {}) },
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
      if (acc.code.startsWith("1200-C") && balance < 0) {
        balances.push({
          code: `2500-CADV-${acc.code.slice("1200-C".length)}`,
          name: `Customer Advance - ${acc.name.replace(/^AR - /, "")}`,
          type: "liability",
          currency: g.currencyCode,
          balance: r2(Math.abs(balance)),
        });
      } else if (acc.code.startsWith("1060-H") && balance < 0) {
        balances.push({
          code: `2350-IPAY-${acc.code.slice("1060-H".length)}`,
          name: `Intermediary Payable - ${acc.name.replace(/^Intermediary - /, "")}`,
          type: "liability",
          currency: g.currencyCode,
          balance: r2(Math.abs(balance)),
        });
      } else {
        balances.push({ code: acc.code, name: acc.name, type: acc.accountType, currency: g.currencyCode, balance: r2(balance) });
      }
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
  const codeFilter = { OR: [
    { code: { startsWith: "1001-CITY" } },
    { code: { startsWith: "1002-CHEQUE" } },
    { code: { startsWith: "1050-BANK" } },
    { code: { startsWith: "1050-SABANK" } },
    { code: { startsWith: "1051-SACASH" } },
    { code: "1050" },
    { code: { startsWith: "1060-H" } },
  ]};

  const allAccounts = await prisma.account.findMany({
    where: { isActive: true, AND: [codeFilter, cityId ? { OR: [{ cityId }, { cityId: null }] } : {}] },
  });

  const accountIds = allAccounts.map((a) => a.id);
  const accountMap = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

  if (accountIds.length === 0) return successResponse({ cashPositions: [], bankPositions: [], intermediaryPositions: [] });

  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: accountIds }, ...(cityId ? { cityId } : {}) },
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
    if (acc.code.startsWith("1001-") || acc.code.startsWith("1002-") || acc.code.startsWith("1051-SACASH")) cashPositions.push(entry);
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
  const customerAdvances: any[] = [];
  const netPositionByCurrency: Record<string, number> = {};
  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const balance = Number(g._sum.debit || 0) - Number(g._sum.credit || 0);
    const classified = classifyCustomerBalance(balance);
    netPositionByCurrency[g.currencyCode] = (netPositionByCurrency[g.currencyCode] || 0) + classified.net;
    if (classified.receivable > 0.5) customers.push({ account: acc.name, currency: g.currencyCode, balance: r2(classified.receivable) });
    if (classified.advance > 0.5) customerAdvances.push({ account: acc.name, currency: g.currencyCode, balance: r2(classified.advance) });
  }

  customers.sort((a, b) => b.balance - a.balance);
  customerAdvances.sort((a, b) => b.balance - a.balance);
  const byCurrency: Record<string, number> = {};
  const customerAdvancesByCurrency: Record<string, number> = {};
  for (const c of customers) { byCurrency[c.currency] = (byCurrency[c.currency] || 0) + c.balance; }
  for (const c of customerAdvances) { customerAdvancesByCurrency[c.currency] = (customerAdvancesByCurrency[c.currency] || 0) + c.balance; }

  return successResponse({
    totalByCurrency: byCurrency,
    customers,
    customerAdvances,
    customerAdvancesByCurrency,
    netPositionByCurrency: Object.fromEntries(Object.entries(netPositionByCurrency).map(([cc, amount]) => [cc, r2(amount)])),
  });
}

async function payables() {
  // Get all supplier, agent, and shipping-line payable accounts in one query.
  // Intermediary balances are assets and belong in cash/intermediary positions.
  const allPayableAccounts = await prisma.account.findMany({
    where: {
      OR: [
        { code: { startsWith: "2100-S" } },   // supplier payables
        { code: { startsWith: "2200-A" } },    // agent payables
        { code: { startsWith: "2300-SL" } },   // shipping line payables
      ],
    },
  });

  if (allPayableAccounts.length === 0) return successResponse({ suppliers: [], agents: [], shippingLines: [] });

  const suppIds = new Set(allPayableAccounts.filter(a => a.code.startsWith("2100-S")).map(a => a.id));
  const agentIds = new Set(allPayableAccounts.filter(a => a.code.startsWith("2200-A")).map(a => a.id));
  const accountMap = Object.fromEntries(allPayableAccounts.map((a) => [a.id, a]));
  const allIds = allPayableAccounts.map((a) => a.id);

  const groups = await prisma.journalEntry.groupBy({
    by: ["accountId", "currencyCode"],
    where: { accountId: { in: allIds } },
    _sum: { debit: true, credit: true },
  });

  const suppliers: any[] = [];
  const agents: any[] = [];
  const shippingLines: any[] = [];
  for (const g of groups) {
    const acc = accountMap[g.accountId];
    if (!acc) continue;
    const balance = Number(g._sum.credit || 0) - Number(g._sum.debit || 0);
    if (Math.abs(balance) > 0.5) {
      const entry = { account: acc.name.replace("Payable - ", ""), currency: g.currencyCode, balance: r2(balance) };
      if (suppIds.has(g.accountId)) suppliers.push(entry);
      else if (agentIds.has(g.accountId)) agents.push(entry);
      else shippingLines.push(entry);
    }
  }

  return successResponse({ suppliers, agents, shippingLines });
}

function r2(n: number) { return Math.round(n * 100) / 100; }
