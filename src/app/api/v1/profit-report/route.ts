import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  computeLotLandedCostPkr,
  groupExpensesByCurrency,
  type LotCostLike,
} from "@/lib/landed-cost-pkr";
import { getCountryFallbackRateToPkr } from "@/lib/intermediary-usd-fifo";
import { buildPeriodProfitReportData } from "@/lib/period-profit-report-data";

const REPORTING_CURRENCY = "PKR";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cartonsFromPurchase(p: {
  qty: unknown;
  weightPerCartonKg: unknown;
  product?: { unitOfMeasure?: string | null; piecesPerCarton?: number | null };
}): number {
  if (p.product?.unitOfMeasure === "PCS") {
    const piecesPerCarton = num(p.product.piecesPerCarton);
    return piecesPerCarton > 0 ? num(p.qty) / piecesPerCarton : 0;
  }
  const wtPerCrt = num(p.weightPerCartonKg);
  const qtyMt = num(p.qty);
  return wtPerCrt > 0 ? Math.round((qtyMt * 1000) / wtPerCrt) : 0;
}

function stockQtyToReportCartons(qty: unknown, product?: { unitOfMeasure?: string | null; piecesPerCarton?: number | null }): number {
  if (product?.unitOfMeasure === "PCS") {
    const piecesPerCarton = num(product.piecesPerCarton);
    return piecesPerCarton > 0 ? num(qty) / piecesPerCarton : 0;
  }
  return num(qty);
}

function supplierPaymentPkrAmount(payment: { amountUsd: unknown; amountLocal?: unknown; exchangeRate?: unknown }): number {
  const local = num(payment.amountLocal);
  if (local > 0) return local;
  const rate = num(payment.exchangeRate);
  return rate > 0 ? num(payment.amountUsd) * rate : 0;
}

function purchasePkrFromLinkedSupplierPayments(
  totalPurchaseUsd: number,
  fallbackUsdPkrRate: number,
  supplierPayments: Array<{ amountUsd: unknown; amountLocal?: unknown; exchangeRate?: unknown }>
): number | null {
  const actualUsd = supplierPayments.reduce((sum, payment) => sum + num(payment.amountUsd), 0);
  const actualPkr = supplierPayments.reduce((sum, payment) => sum + supplierPaymentPkrAmount(payment), 0);
  if (actualUsd <= 0 || actualPkr <= 0 || totalPurchaseUsd <= 0) return null;
  if (actualUsd >= totalPurchaseUsd) return actualPkr;
  return actualPkr + ((totalPurchaseUsd - actualUsd) * fallbackUsdPkrRate);
}

type LotProfitInputs = {
  lotId: number;
  pkrExchangeRate: number | null;
  purchasePkrOverride?: number | null;
  purchases: Array<{
    productId: number;
    qty: unknown;
    weightPerCartonKg: unknown;
    unitPriceUsd: unknown;
    totalPriceUsd: unknown;
    product: { name: string; unitOfMeasure?: string | null; piecesPerCarton?: number | null };
    supplier: { name: string };
  }>;
  lotCosts: LotCostLike[];
  lotExpensesByCurrency: Record<string, number>;
  totalCartonsBought: number;
};

function buildLotProfitMetrics(input: LotProfitInputs) {
  const usdPkrRate = num(input.pkrExchangeRate);
  const totalPurchaseUsd = input.purchases.reduce((s, p) => s + num(p.totalPriceUsd), 0);
  const totalLotCostsNative = input.lotCosts.reduce((s, c) => s + num(c.amount), 0);
  const totalLotExpensesNative = Object.values(input.lotExpensesByCurrency).reduce((s, v) => s + v, 0);

  const baseLanded = computeLotLandedCostPkr({
    totalPurchaseUsd,
    totalCartons: input.totalCartonsBought,
    lotCosts: input.lotCosts,
    lotExpensesByCurrency: input.lotExpensesByCurrency,
    usdPkrRate,
  });
  const purchasePkr = num(input.purchasePkrOverride) > 0 ? num(input.purchasePkrOverride) : baseLanded.purchasePkr;
  const purchaseDelta = purchasePkr - baseLanded.purchasePkr;
  const totalLandedCostPkr = baseLanded.totalLandedCostPkr + purchaseDelta;
  const landed = {
    ...baseLanded,
    purchasePkr: round2(purchasePkr),
    totalLandedCostPkr: round2(totalLandedCostPkr),
    landedCostPerCartonPkr: input.totalCartonsBought > 0 ? round2(totalLandedCostPkr / input.totalCartonsBought) : 0,
  };

  const additionalCostPkr =
    landed.freightPkr + landed.nonFreightCostsPkr + landed.lotExpensesPkr;

  const costBreakdown: Record<string, number> = {};
  for (const c of input.lotCosts) {
    const key = String(c.costType || "other");
    costBreakdown[key] = (costBreakdown[key] || 0) + num(c.amount);
  }

  const productCosts = input.purchases.map((p) => {
    const cartons = cartonsFromPurchase(p);
    const purchaseCostPkr = totalPurchaseUsd > 0
      ? (num(p.totalPriceUsd) / totalPurchaseUsd) * purchasePkr
      : num(p.totalPriceUsd) * usdPkrRate;
    const additionalCostShare =
      input.totalCartonsBought > 0 ? (cartons / input.totalCartonsBought) * additionalCostPkr : 0;
    const totalLandedCostPkr = purchaseCostPkr + additionalCostShare;
    const landedPerCarton = cartons > 0 ? totalLandedCostPkr / cartons : 0;
    return {
      productId: p.productId,
      productName: p.product.name,
      supplierName: p.supplier.name,
      qtyMt: num(p.qty),
      cartons,
      unitPriceUsd: num(p.unitPriceUsd),
      purchaseCostUsd: num(p.totalPriceUsd),
      purchaseCostPkr: round2(purchaseCostPkr),
      additionalCostShare: round2(additionalCostShare),
      totalLandedCostUsd: round2(num(p.totalPriceUsd)),
      totalLandedCostPkr: round2(totalLandedCostPkr),
      landedCostPerCartonUsd: round2(landedPerCarton / (usdPkrRate || 1)),
      landedCostPerCartonPkr: round2(landedPerCarton),
      landedCostPerCarton: round2(landedPerCarton),
    };
  });

  return {
    usdPkrRate,
    totalPurchaseUsd,
    totalLotCostsNative,
    totalLotExpensesNative,
    landed,
    additionalCostPkr,
    costBreakdown,
    productCosts,
  };
}

// GET /api/v1/profit-report?lot_id=X or ?year=2026 or ?date_from=&date_to=
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const lotId = sp.get("lot_id") ? parseInt(sp.get("lot_id")!) : undefined;
    const year = sp.get("year") ? parseInt(sp.get("year")!) : undefined;
    const dateFrom = sp.get("date_from");
    const dateTo = sp.get("date_to");

    if (lotId) return await lotProfitReport(lotId, user);
    return await periodProfitReport(user, year, dateFrom, dateTo);
  } catch (error) {
    console.error("Profit report error:", error);
    return serverError();
  }
});

async function lotProfitReport(lotId: number, user: JWTPayload) {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: { country: true, lotProducts: { include: { product: true } } },
  });
  if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
  const usdPkrRate = lot.pkrExchangeRate
    ? num(lot.pkrExchangeRate)
    : num(await getCountryFallbackRateToPkr({ countryId: lot.countryId, fromCurrencyCode: "USD", asOf: lot.lotDate }));

  const [purchases, costs, lotExpenses, supplierPayments] = await Promise.all([
    prisma.lotPurchase.findMany({ where: { lotId }, include: { product: true, supplier: true } }),
    prisma.lotCost.findMany({ where: { lotId } }),
    prisma.expense.findMany({
      where: { lotId, deletedAt: null },
      include: { currency: true },
    }),
    prisma.supplierPayment.findMany({
      where: { lotId },
      select: { amountUsd: true, amountLocal: true, exchangeRate: true },
    }),
  ]);

  const lotExpensesByCurrency = groupExpensesByCurrency(lotExpenses);
  const totalCartonsBought = lot.lotProducts.reduce((s, lp) => s + stockQtyToReportCartons(lp.totalQty, lp.product), 0);
  const metrics = buildLotProfitMetrics({
    lotId,
    pkrExchangeRate: usdPkrRate,
    purchasePkrOverride: purchasePkrFromLinkedSupplierPayments(
      purchases.reduce((sum, purchase) => sum + num(purchase.totalPriceUsd), 0),
      usdPkrRate,
      supplierPayments
    ),
    purchases,
    lotCosts: costs.map((c) => ({
      amount: c.amount,
      currencyCode: c.currencyCode,
      exchangeRate: c.exchangeRate,
      costType: c.costType,
    })),
    lotExpensesByCurrency,
    totalCartonsBought,
  });

  const salesWhere: any = { OR: [{ lotId }, { items: { some: { lotId } } }], status: "active" };
  if (user.role === "city_admin") salesWhere.cityId = user.cityId;

  const sales = await prisma.sale.findMany({
    where: salesWhere,
    include: { items: { include: { product: true } }, currency: true, city: true },
  });

  let totalRevenue = 0;
  const salesByProduct: Record<number, { qty: number; revenue: number; productName: string }> = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      if (Number(item.lotId || sale.lotId) !== lotId) continue;
      const pid = item.productId;
      if (!salesByProduct[pid]) {
        salesByProduct[pid] = { qty: 0, revenue: 0, productName: item.product.name };
      }
      salesByProduct[pid].qty += num(item.qty);
      salesByProduct[pid].revenue += num(item.amount);
      totalRevenue += num(item.amount);
    }
  }

  const discountWhere: any = { appliedToLotId: lotId };
  if (user.role === "city_admin") discountWhere.sale = { cityId: user.cityId };
  const discountsAgg = await prisma.saleDiscount.aggregate({
    where: discountWhere,
    _sum: { discountAmount: true },
  });
  const totalDiscounts = num(discountsAgg._sum.discountAmount);
  const netRevenue = totalRevenue - totalDiscounts;

  // Operational expenses only — lot-tagged expenses are already in landed cost / COGS.
  const operationalExpenses = { _sum: { amount: null as number | null } };
  const totalOperationalExpenses = num(operationalExpenses._sum.amount);

  const productProfits = metrics.productCosts.map((pc) => {
    const soldData = salesByProduct[pc.productId];
    const cartonsSold = soldData?.qty || 0;
    const grossRevenue = soldData?.revenue || 0;
    const discountShare = totalRevenue > 0 ? (grossRevenue / totalRevenue) * totalDiscounts : 0;
    const revenue = grossRevenue - discountShare;
    const costOfSold = cartonsSold * pc.landedCostPerCartonPkr;
    const grossProfit = revenue - costOfSold;
    return {
      ...pc,
      cartonsSold,
      revenue: round2(revenue),
      costOfGoodsSold: round2(costOfSold),
      grossProfit: round2(grossProfit),
      cartonsRemaining: pc.cartons - cartonsSold,
      unsoldValue: round2((pc.cartons - cartonsSold) * pc.landedCostPerCartonPkr),
    };
  });

  const totalGrossProfit = productProfits.reduce((s, p) => s + p.grossProfit, 0);
  const netProfit = totalGrossProfit - totalOperationalExpenses;

  return successResponse({
    reportingCurrency: REPORTING_CURRENCY,
    lot: {
      id: lot.id,
      lotNumber: lot.lotNumber,
      lotDate: lot.lotDate.toISOString().split("T")[0],
      country: lot.country.name,
      status: lot.status,
      pkrExchangeRate: metrics.usdPkrRate || null,
      exchangeRateSource: lot.pkrExchangeRate ? "lot" : "country_fallback",
    },
    costSummary: {
      totalPurchaseUsd: round2(metrics.totalPurchaseUsd),
      totalLotCosts: round2(metrics.totalLotCostsNative),
      totalLotExpenses: round2(metrics.totalLotExpensesNative),
      totalAdditionalCosts: round2(metrics.additionalCostPkr),
      costBreakdown: metrics.costBreakdown,
      totalLandedCostUsd: round2(metrics.totalPurchaseUsd + metrics.totalLotCostsNative),
      totalLandedCostPkr: metrics.landed.totalLandedCostPkr,
      totalCartons: totalCartonsBought,
      landedCostPerCarton: metrics.landed.landedCostPerCartonPkr,
      landedCostPerCartonPkr: metrics.landed.landedCostPerCartonPkr,
      purchasePkr: metrics.landed.purchasePkr,
      freightPkr: metrics.landed.freightPkr,
      otherCostsPkr: round2(metrics.landed.nonFreightCostsPkr + metrics.landed.lotExpensesPkr),
    },
    productCosts: productProfits,
    profitSummary: {
      grossRevenue: round2(totalRevenue),
      totalDiscounts: round2(totalDiscounts),
      netRevenue: round2(netRevenue),
      totalCOGS: round2(productProfits.reduce((s, p) => s + p.costOfGoodsSold, 0)),
      totalGrossProfit: round2(totalGrossProfit),
      totalExpenses: round2(totalOperationalExpenses),
      lotExpensesInLandedCost: round2(metrics.landed.lotExpensesPkr),
      netProfit: round2(netProfit),
      unsoldInventoryValue: round2(productProfits.reduce((s, p) => s + p.unsoldValue, 0)),
      totalRevenue: round2(netRevenue),
    },
  });
}

function parseDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

async function periodProfitReport(
  user: JWTPayload,
  year?: number,
  dateFrom?: string | null,
  dateTo?: string | null
) {
  return successResponse(await buildPeriodProfitReportData(user, year, dateFrom, dateTo));
}
