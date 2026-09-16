import prisma from "@/lib/prisma";
import { buildAuthoritativeFinancialReportResult } from "@/lib/authoritative-financial-report";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange, buildYearDateRange } from "@/lib/date-range";
import { REVENUE_SALE_STATUSES } from "@/lib/sale-status";
import { buildLotProfitReconciliation } from "@/lib/lot-profit-reconciliation";

const REPORTING_CURRENCY = "PKR";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stockQtyToReportCartons(qty: unknown, product?: { unitOfMeasure?: string | null; piecesPerCarton?: number | null }): number {
  if (product?.unitOfMeasure === "PCS") {
    const piecesPerCarton = num(product.piecesPerCarton);
    return piecesPerCarton > 0 ? num(qty) / piecesPerCarton : 0;
  }
  return num(qty);
}

export async function buildPeriodProfitReportData(
  user: JWTPayload,
  year?: number,
  dateFrom?: string | null,
  dateTo?: string | null
) {
  const authoritativeReport = await buildAuthoritativeFinancialReportResult({
    year,
    dateFrom,
    dateTo,
    cityId: user.role === "city_admin" ? user.cityId || null : null,
  });
  const today = new Date().toISOString().slice(0, 10);
  const periodRange = year
    ? buildYearDateRange(year)
    : buildDateRange(dateFrom || "1900-01-01", dateTo || today);
  const cityScope = user.role === "city_admin" ? { cityId: user.cityId! } : {};

  const pnlAccounts = await prisma.account.findMany({
    where: {
      OR: [
        { accountType: { in: ["revenue", "cogs", "expense"] } },
        { code: { in: ["FX-GAIN", "FX-LOSS"] } },
      ],
    },
    select: { id: true, code: true, accountType: true },
  });
  const accountById = new Map(pnlAccounts.map((account) => [account.id, account]));
  const journalRows = await prisma.journalEntry.findMany({
    where: {
      accountId: { in: pnlAccounts.map((account) => account.id) },
      entryDate: periodRange,
      ...cityScope,
    },
    select: {
      accountId: true,
      debit: true,
      credit: true,
      currencyCode: true,
      entityType: true,
      entityId: true,
      lotId: true,
    },
  });
  const pkrRevenueRows = journalRows.filter((row) => (
    accountById.get(row.accountId)?.accountType === "revenue"
      && String(row.currencyCode).toUpperCase() === REPORTING_CURRENCY
  ));
  const journalSaleIds = [...new Set(
    pkrRevenueRows
      .filter((row) => row.entityType === "sale" && row.entityId)
      .map((row) => Number(row.entityId)),
  )];
  const postedPkrRevenueBySaleId = new Map<number, number>();
  for (const row of pkrRevenueRows) {
    if (row.entityType !== "sale" || !row.entityId) continue;
    const saleId = Number(row.entityId);
    postedPkrRevenueBySaleId.set(
      saleId,
      num(postedPkrRevenueBySaleId.get(saleId)) + num(row.credit) - num(row.debit),
    );
  }
  const sales = await prisma.sale.findMany({
    where: {
      ...cityScope,
      isOpeningImport: false,
      OR: [
        { saleDate: periodRange, status: { in: REVENUE_SALE_STATUSES } },
        ...(journalSaleIds.length ? [{ id: { in: journalSaleIds } }] : []),
      ],
    },
    select: {
      id: true,
      saleDate: true,
      status: true,
      fxPkrEquivalent: true,
      currency: { select: { code: true } },
      items: {
        select: {
          lotId: true,
          amount: true,
          qty: true,
          product: { select: { unitOfMeasure: true, piecesPerCarton: true } },
        },
      },
    },
  });
  const periodStartMs = periodRange.gte?.getTime() ?? Number.NEGATIVE_INFINITY;
  const periodEndMs = periodRange.lt?.getTime() ?? Number.POSITIVE_INFINITY;
  const saleInputs = sales.map((sale) => {
    const currencyCode = String(sale.currency.code).toUpperCase();
    const saleDateMs = sale.saleDate.getTime();
    const isRecognizedCurrentSale = REVENUE_SALE_STATUSES.includes(sale.status)
      && saleDateMs >= periodStartMs
      && saleDateMs < periodEndMs;
    const postedPkrRevenue = num(postedPkrRevenueBySaleId.get(sale.id));
    const recognizedRevenuePkr = currencyCode === REPORTING_CURRENCY
      ? postedPkrRevenue
      : isRecognizedCurrentSale ? num(sale.fxPkrEquivalent) : 0;
    return {
      saleId: sale.id,
      recognizedRevenuePkr,
      items: sale.items.map((item) => ({
        lotId: item.lotId,
        revenueWeight: num(item.amount),
        cartons: isRecognizedCurrentSale ? stockQtyToReportCartons(item.qty, item.product) : 0,
      })),
    };
  });
  const revenueAdjustments = pkrRevenueRows
    .filter((row) => row.entityType !== "sale")
    .map((row) => ({
      lotId: row.lotId,
      amountPkr: num(row.credit) - num(row.debit),
      kind: row.entityType === "sale_discount" ? "discount" as const : "other" as const,
    }));
  const cogsEntries = journalRows
    .filter((row) => accountById.get(row.accountId)?.accountType === "cogs" && String(row.currencyCode).toUpperCase() === REPORTING_CURRENCY)
    .map((row) => ({ lotId: row.lotId, amountPkr: num(row.debit) - num(row.credit) }));
  const expenseEntries = journalRows
    .filter((row) => (
      accountById.get(row.accountId)?.accountType === "expense"
        && !["FX-GAIN", "FX-LOSS"].includes(accountById.get(row.accountId)?.code || "")
        && String(row.currencyCode).toUpperCase() === REPORTING_CURRENCY
    ))
    .map((row) => ({ lotId: row.lotId, amountPkr: num(row.debit) - num(row.credit) }));
  const lotProfit = buildLotProfitReconciliation({
    sales: saleInputs,
    revenueAdjustments,
    cogsEntries,
    expenseEntries,
    authoritative: authoritativeReport.profitAndLoss,
  });
  const lotIds = [...lotProfit.byLot.keys()];
  const lots = lotIds.length
    ? await prisma.lot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, lotNumber: true, country: { select: { name: true } } },
    })
    : [];
  const lotMeta = new Map(lots.map((lot) => [lot.id, lot]));
  const lotSummaries = [...lotProfit.byLot.values()].map((lot) => ({
    lotId: lot.lotId,
    lotNumber: lotMeta.get(lot.lotId)?.lotNumber || `Lot #${lot.lotId}`,
    country: lotMeta.get(lot.lotId)?.country.name || "—",
    landedCostPerCarton: lot.cartonsSold ? round2(lot.cogsPkr / lot.cartonsSold) : 0,
    landedCostPerCartonPkr: lot.cartonsSold ? round2(lot.cogsPkr / lot.cartonsSold) : 0,
    cartonsSold: lot.cartonsSold,
    grossRevenue: lot.grossRevenuePkr,
    discounts: lot.discountsPkr,
    revenue: lot.revenuePkr,
    cogs: lot.cogsPkr,
    expenses: lot.directExpensesPkr,
    grossProfit: lot.grossProfitPkr,
    netProfit: lot.netProfitBeforeFxPkr,
  })).sort((a, b) => a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true }));
  const totalCartonsSold = round2(lotSummaries.reduce((sum, lot) => sum + lot.cartonsSold, 0));

  const totalPurchased = await prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } });
  const totalPaid = await prisma.supplierPayment.aggregate({ where: { deletedAt: null }, _sum: { amountUsd: true } });

  return {
    reportingCurrency: REPORTING_CURRENCY,
    period: authoritativeReport.period,
    profitAndLoss: authoritativeReport.profitAndLoss,
    authoritativeFinancialReport: authoritativeReport,
    cartonsSold: totalCartonsSold,
    supplierAccount: {
      totalPurchasedUsd: num(totalPurchased._sum.totalPriceUsd),
      totalPaidUsd: num(totalPaid._sum.amountUsd),
      balanceOwedUsd: num(totalPurchased._sum.totalPriceUsd) - num(totalPaid._sum.amountUsd),
    },
    lotBreakdown: lotSummaries,
    lotReconciliation: lotProfit.reconciliation,
  };
}
