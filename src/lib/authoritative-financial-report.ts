import prisma from "@/lib/prisma";
import { buildDateRange, buildYearDateRange } from "@/lib/date-range";

export const AUTHORITATIVE_REPORTING_CURRENCY = "PKR";

export type AuthoritativePnlCurrencyRow = {
  currency: string;
  revenue: number;
  cogs: number;
  expenses: Record<string, number>;
  expenseTotal: number;
  fxGains: number;
  fxLosses: number;
  grossProfit: number;
  grossMargin: number;
  netProfit: number;
  netMargin: number;
};

export type AuthoritativeFinancialReportResult = {
  reportingCurrency: "PKR";
  period: string;
  periodStart: string;
  periodEnd: string;
  cityId: number | null;
  byCurrency: AuthoritativePnlCurrencyRow[];
  profitAndLoss: {
    totalRevenue: number;
    totalCOGS: number;
    grossProfit: number;
    grossMarginPercent: number;
    totalExpenses: number;
    totalFxGains: number;
    totalFxLosses: number;
    netProfit: number;
    netMarginPercent: number;
  };
  fxWarnings: string[];
  unsupportedForeignCurrencyEntries: string[];
  source: "journal_entries";
};

type JournalGroup = {
  accountId: number;
  currencyCode: string;
  _sum: { debit: unknown; credit: unknown };
};

type AccountLike = {
  id: number;
  code?: string;
  name: string;
  accountType: string;
};

type SaleLotCogsSource = {
  saleId: number;
  lotId: number | null;
  voucherNo?: string | null;
  lotNumber?: string | null;
};

type CogsJournalSource = {
  transactionId: string;
  lotId: number | null;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function periodLabel(year?: number, dateFrom?: string | null, dateTo?: string | null) {
  if (year) return `Year ${year}`;
  if (dateFrom || dateTo) return `${dateFrom || "start"} to ${dateTo || "now"}`;
  return "All Time";
}

export function summarizeJournalPnl(input: {
  groups: JournalGroup[];
  accounts: AccountLike[];
  recognizedSalePkrById?: Map<number, number>;
  recognizedForeignSaleAmountsByCurrency?: Map<string, number>;
}) {
  const accountMap = new Map(input.accounts.map((account) => [account.id, account]));
  const byCurrency: Record<string, { revenue: number; cogs: number; expenses: Record<string, number>; expenseTotal: number; fxGains: number; fxLosses: number }> = {};
  const unsupportedForeignCurrencyEntries: string[] = [];

  for (const group of input.groups) {
    const account = accountMap.get(group.accountId);
    if (!account) continue;
    const currency = String(group.currencyCode || AUTHORITATIVE_REPORTING_CURRENCY).toUpperCase();
    if (!byCurrency[currency]) byCurrency[currency] = { revenue: 0, cogs: 0, expenses: {}, expenseTotal: 0, fxGains: 0, fxLosses: 0 };
    const debit = num(group._sum.debit);
    const credit = num(group._sum.credit);

    if (account.code === "FX-GAIN") byCurrency[currency].fxGains += credit - debit;
    else if (account.code === "FX-LOSS") byCurrency[currency].fxLosses += debit - credit;
    else if (account.accountType === "revenue") byCurrency[currency].revenue += credit - debit;
    else if (account.accountType === "cogs") byCurrency[currency].cogs += debit - credit;
    else if (account.accountType === "expense") {
      byCurrency[currency].expenses[account.name] = (byCurrency[currency].expenses[account.name] || 0) + debit - credit;
      byCurrency[currency].expenseTotal += debit - credit;
    }
  }

  const byCurrencyRows = Object.entries(byCurrency).map(([currency, data]) => {
    const grossProfit = data.revenue - data.cogs;
    const netProfit = grossProfit - data.expenseTotal + data.fxGains - data.fxLosses;
    return {
      currency,
      revenue: round2(data.revenue),
      cogs: round2(data.cogs),
      grossProfit: round2(grossProfit),
      grossMargin: data.revenue ? round2((grossProfit / data.revenue) * 100) : 0,
      expenses: Object.fromEntries(Object.entries(data.expenses).map(([name, amount]) => [name, round2(amount)])),
      expenseTotal: round2(data.expenseTotal),
      fxGains: round2(data.fxGains),
      fxLosses: round2(data.fxLosses),
      netProfit: round2(netProfit),
      netMargin: data.revenue ? round2((netProfit / data.revenue) * 100) : 0,
    };
  });

  const pkr = byCurrency[AUTHORITATIVE_REPORTING_CURRENCY] || { revenue: 0, cogs: 0, expenses: {}, expenseTotal: 0, fxGains: 0, fxLosses: 0 };
  for (const [currency, data] of Object.entries(byCurrency)) {
    if (currency === AUTHORITATIVE_REPORTING_CURRENCY) continue;
    const recognizedForeignSaleAmount = num(input.recognizedForeignSaleAmountsByCurrency?.get(currency));
    if (Math.abs(data.revenue) - Math.abs(recognizedForeignSaleAmount) > 0.01) unsupportedForeignCurrencyEntries.push(`${currency} revenue journal entries require stored PKR recognition metadata before attribution.`);
    if (Math.abs(data.cogs) > 0.01) unsupportedForeignCurrencyEntries.push(`${currency} COGS journal entries require stored PKR recognition metadata before attribution.`);
    if (Math.abs(data.expenseTotal) > 0.01) unsupportedForeignCurrencyEntries.push(`${currency} expense journal entries require stored PKR recognition metadata before attribution.`);
    if (Math.abs(data.fxGains) > 0.01 || Math.abs(data.fxLosses) > 0.01) unsupportedForeignCurrencyEntries.push(`${currency} FX journal entries must be recognized in PKR before attribution.`);
  }

  const recognizedSaleRevenuePkr = [...(input.recognizedSalePkrById?.values() || [])].reduce((sum, value) => sum + value, 0);
  const totalRevenue = pkr.revenue + recognizedSaleRevenuePkr;
  const totalCOGS = pkr.cogs;
  const totalExpenses = pkr.expenseTotal;
  const totalFxGains = pkr.fxGains;
  const totalFxLosses = pkr.fxLosses;
  const grossProfit = totalRevenue - totalCOGS;
  const netProfit = grossProfit - totalExpenses + totalFxGains - totalFxLosses;

  return {
    byCurrency: byCurrencyRows,
    profitAndLoss: {
      totalRevenue: round2(totalRevenue),
      totalCOGS: round2(totalCOGS),
      grossProfit: round2(grossProfit),
      grossMarginPercent: totalRevenue ? round2((grossProfit / totalRevenue) * 100) : 0,
      totalExpenses: round2(totalExpenses),
      totalFxGains: round2(totalFxGains),
      totalFxLosses: round2(totalFxLosses),
      netProfit: round2(netProfit),
      netMarginPercent: totalRevenue ? round2((netProfit / totalRevenue) * 100) : 0,
    },
    unsupportedForeignCurrencyEntries: [...new Set(unsupportedForeignCurrencyEntries)],
  };
}

export function buildMissingCogsWarnings(input: {
  saleLotRows: SaleLotCogsSource[];
  cogsJournalRows: CogsJournalSource[];
}): string[] {
  const cogsKeys = new Set(
    input.cogsJournalRows
      .map((row) => {
        const saleId = Number(String(row.transactionId || "").replace(/^COGS-/, ""));
        return saleId > 0 ? `${saleId}:${row.lotId || "none"}` : null;
      })
      .filter(Boolean) as string[],
  );
  const missing = new Map<string, SaleLotCogsSource>();
  for (const row of input.saleLotRows) {
    const key = `${row.saleId}:${row.lotId || "none"}`;
    if (!cogsKeys.has(key)) missing.set(key, row);
  }
  if (missing.size === 0) return [];
  const examples = [...missing.values()].slice(0, 5).map((row) => (
    `sale ${row.voucherNo || row.saleId} lot ${row.lotNumber || row.lotId || "none"}`
  ));
  return [
    `Missing COGS journal for ${missing.size} active sale/lot row${missing.size === 1 ? "" : "s"} (${examples.join(", ")}). Financial Report profit is incomplete until historical lot PKR cost basis is resolved and COGS is posted.`,
  ];
}

export async function buildAuthoritativeFinancialReportResult(input: {
  year?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  cityId?: number | null;
}): Promise<AuthoritativeFinancialReportResult> {
  const today = new Date().toISOString().slice(0, 10);
  const range = input.year
    ? buildYearDateRange(input.year)
    : buildDateRange(input.dateFrom || "1900-01-01", input.dateTo || today);
  const dateFrom = range.gte!;
  const dateToExclusive = range.lt!;
  const periodEnd = input.year ? `${input.year}-12-31` : input.dateTo || today;
  const where: any = { entryDate: { gte: dateFrom, lt: dateToExclusive } };
  if (input.cityId) where.cityId = input.cityId;

  const [groups, accounts, recognizedFxSales, saleItemsForCogs, cogsJournalRows] = await Promise.all([
    prisma.journalEntry.groupBy({
      by: ["accountId", "currencyCode"],
      where,
      _sum: { debit: true, credit: true },
    }),
    prisma.account.findMany({ select: { id: true, code: true, name: true, accountType: true } }),
    prisma.sale.findMany({
      where: {
        saleDate: { gte: dateFrom, lt: dateToExclusive },
        status: "active",
        fxPkrEquivalent: { not: null },
        ...(input.cityId ? { cityId: input.cityId } : {}),
      },
      select: {
        id: true,
        totalAmount: true,
        fxOriginalCurrencyCode: true,
        fxOriginalAmount: true,
        fxPkrEquivalent: true,
        currency: { select: { code: true } },
      },
    }),
    prisma.saleItem.findMany({
      where: {
        sale: {
          saleDate: { gte: dateFrom, lt: dateToExclusive },
          status: "active",
          isOpeningImport: false,
          ...(input.cityId ? { cityId: input.cityId } : {}),
        },
      },
      select: {
        saleId: true,
        lotId: true,
        sale: { select: { voucherNo: true } },
        lot: { select: { lotNumber: true } },
      },
    }),
    prisma.journalEntry.findMany({
      where: {
        transactionId: { startsWith: "COGS-" },
        entryDate: { gte: dateFrom, lt: dateToExclusive },
        ...(input.cityId ? { cityId: input.cityId } : {}),
      },
      select: { transactionId: true, lotId: true },
    }),
  ]);

  const recognizedSalePkrById = new Map(recognizedFxSales.map((sale) => [sale.id, num(sale.fxPkrEquivalent)]));
  const recognizedForeignSaleAmountsByCurrency = new Map<string, number>();
  for (const sale of recognizedFxSales) {
    const currency = String(sale.fxOriginalCurrencyCode || sale.currency.code || "").toUpperCase();
    if (!currency || currency === AUTHORITATIVE_REPORTING_CURRENCY) continue;
    const originalAmount = num(sale.fxOriginalAmount ?? sale.totalAmount);
    recognizedForeignSaleAmountsByCurrency.set(
      currency,
      num(recognizedForeignSaleAmountsByCurrency.get(currency)) + originalAmount,
    );
  }
  const summarized = summarizeJournalPnl({
    groups,
    accounts,
    recognizedSalePkrById,
    recognizedForeignSaleAmountsByCurrency,
  });
  const missingCogsWarnings = buildMissingCogsWarnings({
    saleLotRows: saleItemsForCogs.map((item) => ({
      saleId: item.saleId,
      lotId: item.lotId,
      voucherNo: item.sale?.voucherNo || null,
      lotNumber: item.lot?.lotNumber || null,
    })),
    cogsJournalRows,
  });
  const warnings = [...new Set([...summarized.unsupportedForeignCurrencyEntries, ...missingCogsWarnings])];

  return {
    reportingCurrency: AUTHORITATIVE_REPORTING_CURRENCY,
    period: periodLabel(input.year, input.dateFrom, input.dateTo),
    periodStart: dateOnly(dateFrom),
    periodEnd,
    cityId: input.cityId || null,
    byCurrency: summarized.byCurrency,
    profitAndLoss: summarized.profitAndLoss,
    fxWarnings: warnings,
    unsupportedForeignCurrencyEntries: warnings,
    source: "journal_entries",
  };
}
