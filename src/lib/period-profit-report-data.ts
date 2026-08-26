import prisma from "@/lib/prisma";
import { buildAuthoritativeFinancialReportResult } from "@/lib/authoritative-financial-report";
import {
  computeLotLandedCostPkr,
  groupExpensesByCurrency,
  type LotCostLike,
} from "@/lib/landed-cost-pkr";
import { getCountryFallbackRateToPkr } from "@/lib/intermediary-usd-fifo";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange, buildYearDateRange } from "@/lib/date-range";

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

function buildLotProfitMetrics(input: {
  pkrExchangeRate: number | null;
  purchases: Array<{ totalPriceUsd: unknown }>;
  lotCosts: LotCostLike[];
  lotExpensesByCurrency: Record<string, number>;
  totalCartonsBought: number;
}) {
  const usdPkrRate = num(input.pkrExchangeRate);
  const totalPurchaseUsd = input.purchases.reduce((sum, purchase) => sum + num(purchase.totalPriceUsd), 0);
  const baseLanded = computeLotLandedCostPkr({
    totalPurchaseUsd,
    totalCartons: input.totalCartonsBought,
    lotCosts: input.lotCosts,
    lotExpensesByCurrency: input.lotExpensesByCurrency,
    usdPkrRate,
  });
  return {
    landedCostPerCartonPkr: input.totalCartonsBought > 0 ? round2(baseLanded.totalLandedCostPkr / input.totalCartonsBought) : 0,
  };
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
  const saleWhere: any = { status: "active" };
  if (user.role === "city_admin") saleWhere.cityId = user.cityId;
  if (year) {
    saleWhere.saleDate = buildYearDateRange(year);
  } else if (dateFrom || dateTo) {
    saleWhere.saleDate = buildDateRange(dateFrom, dateTo);
  }

  const lots = await prisma.lot.findMany({
    include: {
      lotPurchases: { include: { product: true, supplier: true } },
      lotProducts: { include: { product: true } },
      lotCosts: true,
      country: true,
      sales: { where: saleWhere, include: { items: true } },
      expenses: {
        where: user.role === "city_admin" ? { cityId: user.cityId!, deletedAt: null } : { deletedAt: null },
        include: { currency: true },
      },
    },
  });

  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalCartonsSold = 0;
  const lotSummaries = [];

  const allDiscounts = await prisma.saleDiscount.findMany({
    where: user.role === "city_admin" ? { sale: { cityId: user.cityId! } } : {},
    select: { appliedToLotId: true, discountAmount: true },
  });
  const discountByLot: Record<number, number> = {};
  for (const discount of allDiscounts) {
    discountByLot[discount.appliedToLotId] = (discountByLot[discount.appliedToLotId] || 0) + num(discount.discountAmount);
  }

  for (const lot of lots) {
    if (!lot.sales.length && !lot.lotPurchases.length) continue;

    const totalCartons = lot.lotProducts.reduce((sum, lotProduct) => (
      sum + stockQtyToReportCartons(lotProduct.totalQty, lotProduct.product)
    ), 0);
    const lotExpensesByCurrency = groupExpensesByCurrency(lot.expenses);
    const usdPkrRate = lot.pkrExchangeRate
      ? num(lot.pkrExchangeRate)
      : num(await getCountryFallbackRateToPkr({ countryId: lot.countryId, fromCurrencyCode: "USD", asOf: lot.lotDate }));
    const metrics = buildLotProfitMetrics({
      pkrExchangeRate: usdPkrRate,
      purchases: lot.lotPurchases,
      lotCosts: lot.lotCosts.map((cost) => ({
        amount: cost.amount,
        currencyCode: cost.currencyCode,
        exchangeRate: cost.exchangeRate,
        costType: cost.costType,
      })),
      lotExpensesByCurrency,
      totalCartonsBought: totalCartons,
    });

    let grossLotRevenue = 0;
    let lotCartonsSold = 0;
    for (const sale of lot.sales) {
      for (const item of sale.items) {
        grossLotRevenue += num(item.amount);
        lotCartonsSold += num(item.qty);
      }
    }

    const lotDiscounts = discountByLot[lot.id] || 0;
    const lotRevenue = grossLotRevenue - lotDiscounts;
    const lotCOGS = lotCartonsSold * metrics.landedCostPerCartonPkr;

    totalRevenue += lotRevenue;
    totalCOGS += lotCOGS;
    totalCartonsSold += lotCartonsSold;

    if (grossLotRevenue > 0 || lotCartonsSold > 0) {
      lotSummaries.push({
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        country: lot.country.name,
        landedCostPerCarton: metrics.landedCostPerCartonPkr,
        landedCostPerCartonPkr: metrics.landedCostPerCartonPkr,
        cartonsSold: lotCartonsSold,
        grossRevenue: round2(grossLotRevenue),
        discounts: round2(lotDiscounts),
        revenue: round2(lotRevenue),
        cogs: round2(lotCOGS),
        expenses: 0,
        grossProfit: round2(lotRevenue - lotCOGS),
        netProfit: round2(lotRevenue - lotCOGS),
      });
    }
  }

  const totalPurchased = await prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } });
  const totalPaid = await prisma.supplierPayment.aggregate({ _sum: { amountUsd: true } });

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
  };
}
