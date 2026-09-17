import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  computeLotLandedCostPkr,
  type LotCostLike,
} from "@/lib/landed-cost-pkr";
import { getCountryFallbackRateToPkr } from "@/lib/intermediary-usd-fifo";
import { buildPeriodProfitReportData } from "@/lib/period-profit-report-data";
import { allocateMoneyByWeights } from "@/lib/lot-profit-reconciliation";
import { REVENUE_SALE_STATUSES } from "@/lib/sale-status";
import { calculateLotProductLandedCosts, type LotCostAllocationBasis } from "@/lib/lot-product-cost-allocation";

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

type LotProfitInputs = {
  lotId: number;
  pkrExchangeRate: number | null;
  purchases: Array<{
    productId: number;
    qty: unknown;
    weightPerCartonKg: unknown;
    unitPriceUsd: unknown;
    totalPriceUsd: unknown;
    carryingAmountPkr?: unknown;
    carryingRatePkr?: unknown;
    product: { name: string; unitOfMeasure?: string | null; piecesPerCarton?: number | null; defaultWeightPerCartonKg?: unknown };
    supplier: { name: string };
  }>;
  lotCosts: Array<LotCostLike & { allocationBasis?: string | null; allocatedProductId?: number | null }>;
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
  const landed = {
    ...baseLanded,
    purchasePkr: round2(baseLanded.purchasePkr),
    totalLandedCostPkr: round2(baseLanded.totalLandedCostPkr),
    landedCostPerCartonPkr: input.totalCartonsBought > 0 ? round2(baseLanded.totalLandedCostPkr / input.totalCartonsBought) : 0,
  };

  const additionalCostPkr =
    landed.freightPkr + landed.nonFreightCostsPkr + landed.lotExpensesPkr;

  const costBreakdown: Record<string, number> = {};
  for (const c of input.lotCosts) {
    const key = String(c.costType || "other");
    costBreakdown[key] = (costBreakdown[key] || 0) + num(c.amount);
  }

  const purchaseByProduct = new Map<number, typeof input.purchases>();
  for (const purchase of input.purchases) {
    purchaseByProduct.set(purchase.productId, [...(purchaseByProduct.get(purchase.productId) || []), purchase]);
  }
  const productInputs = Array.from(purchaseByProduct.entries()).map(([productId, purchases]) => {
    const first = purchases[0];
    const cartons = purchases.reduce((sum, purchase) => sum + cartonsFromPurchase(purchase), 0);
    const purchaseValuePkr = purchases.reduce((sum, purchase) => {
      const carrying = num(purchase.carryingAmountPkr);
      return sum + (carrying > 0 ? carrying : num(purchase.totalPriceUsd) * num(purchase.carryingRatePkr || usdPkrRate));
    }, 0);
    const weightKg = first.product.unitOfMeasure === "PCS"
      ? cartons * num(first.product.defaultWeightPerCartonKg)
      : purchases.reduce((sum, purchase) => sum + num(purchase.qty) * 1000, 0);
    return {
      productId,
      productName: first.product.name,
      purchaseValuePkr,
      weightKg,
      cartonQty: cartons,
      totalStockQty: cartons,
      operatingSoldStockQty: 0,
      openingSoldStockQty: 0,
    };
  });
  const landedByProduct = calculateLotProductLandedCosts({
    products: productInputs,
    costs: input.lotCosts.map((cost) => ({
      amountPkr: num(cost.amount) * (String(cost.currencyCode || "PKR").toUpperCase() === "PKR" ? 1 : num(cost.exchangeRate)),
      basis: (cost.allocationBasis || "cartons") as LotCostAllocationBasis,
      allocatedProductId: cost.allocatedProductId,
    })),
  });
  const productCosts = landedByProduct.map((landedProduct) => {
    const purchases = purchaseByProduct.get(landedProduct.productId) || [];
    const first = purchases[0];
    const purchaseCostUsd = purchases.reduce((sum, purchase) => sum + num(purchase.totalPriceUsd), 0);
    const qtyMt = purchases.reduce((sum, purchase) => sum + num(purchase.qty), 0);
    const weightedUnitPriceUsd = qtyMt > 0 ? purchaseCostUsd / qtyMt : 0;
    return {
      productId: landedProduct.productId,
      productName: landedProduct.productName,
      supplierName: Array.from(new Set(purchases.map((purchase) => purchase.supplier.name))).join(", "),
      qtyMt,
      cartons: landedProduct.cartonQty,
      unitPriceUsd: weightedUnitPriceUsd,
      purchaseCostUsd,
      purchaseCostPkr: round2(landedProduct.purchaseValuePkr),
      additionalCostShare: round2(landedProduct.additionalCostPkr),
      totalLandedCostUsd: round2(purchaseCostUsd),
      totalLandedCostPkr: round2(landedProduct.totalLandedCostPkr),
      landedCostPerCartonUsd: round2(landedProduct.unitCostPkr / (usdPkrRate || 1)),
      landedCostPerCartonPkr: round2(landedProduct.unitCostPkr),
      landedCostPerCarton: round2(landedProduct.unitCostPkr),
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
export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
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

  const [purchases, costs, lotExpenses] = await Promise.all([
    prisma.lotPurchase.findMany({ where: { lotId }, include: { product: true, supplier: true } }),
    prisma.lotCost.findMany({ where: { lotId } }),
    prisma.expense.findMany({
      where: { lotId, deletedAt: null },
      include: { currency: true },
    }),
  ]);

  const totalCartonsBought = lot.lotProducts.reduce((s, lp) => s + stockQtyToReportCartons(lp.totalQty, lp.product), 0);
  const metrics = buildLotProfitMetrics({
    lotId,
    pkrExchangeRate: usdPkrRate,
    purchases,
    lotCosts: costs.map((c) => ({
      amount: c.amount,
      currencyCode: c.currencyCode,
      exchangeRate: c.exchangeRate,
      costType: c.costType,
      allocationBasis: c.allocationBasis,
      allocatedProductId: c.allocatedProductId,
    })),
    lotExpensesByCurrency: {},
    totalCartonsBought,
  });

  const salesWhere: any = { OR: [{ lotId }, { items: { some: { lotId } } }], status: { in: REVENUE_SALE_STATUSES } };
  if (user.role === "city_admin") salesWhere.cityId = user.cityId;

  const sales = await prisma.sale.findMany({
    where: salesWhere,
    include: { items: { include: { product: true } }, currency: true, city: true },
  });

  const salesByProduct: Record<number, { qty: number; revenue: number; productName: string }> = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      if (Number(item.lotId || sale.lotId) !== lotId) continue;
      const pid = item.productId;
      if (!salesByProduct[pid]) {
        salesByProduct[pid] = { qty: 0, revenue: 0, productName: item.product.name };
      }
      salesByProduct[pid].qty += stockQtyToReportCartons(item.qty, item.product);
      salesByProduct[pid].revenue += num(item.amount);
    }
  }

  const unsupportedExpenseCurrencies = Array.from(new Set(
    lotExpenses
      .filter((expense) => String(expense.currency.code).toUpperCase() !== "PKR")
      .map((expense) => String(expense.currency.code).toUpperCase()),
  ));
  const allTimeReport = await buildPeriodProfitReportData(
    user,
    undefined,
    "1900-01-01",
    new Date().toISOString().slice(0, 10),
  );
  const recognizedLot = allTimeReport.lotBreakdown.find((row) => row.lotId === lotId);
  const recognizedGrossRevenue = num(recognizedLot?.grossRevenue);
  const recognizedDiscounts = num(recognizedLot?.discounts);
  const recognizedRevenue = num(recognizedLot?.revenue);
  const recognizedCogs = num(recognizedLot?.cogs);
  const recognizedExpenses = num(recognizedLot?.expenses);
  const revenueWeights = metrics.productCosts.map((pc) => num(salesByProduct[pc.productId]?.revenue));
  const cogsWeights = metrics.productCosts.map((pc) => (
    num(salesByProduct[pc.productId]?.qty) * pc.landedCostPerCartonPkr
  ));
  const productGrossRevenue = allocateMoneyByWeights(recognizedGrossRevenue, revenueWeights);
  const productDiscounts = allocateMoneyByWeights(recognizedDiscounts, revenueWeights);
  const productCogs = allocateMoneyByWeights(recognizedCogs, cogsWeights);

  const productProfits = metrics.productCosts.map((pc, index) => {
    const soldData = salesByProduct[pc.productId];
    const cartonsSold = soldData?.qty || 0;
    const grossRevenue = productGrossRevenue[index] || 0;
    const discountShare = productDiscounts[index] || 0;
    const revenue = grossRevenue - discountShare;
    const costOfSold = productCogs[index] || 0;
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

  const totalGrossProfit = recognizedRevenue - recognizedCogs;
  const netProfit = totalGrossProfit - recognizedExpenses;

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
      grossRevenue: round2(recognizedGrossRevenue),
      totalDiscounts: round2(recognizedDiscounts),
      netRevenue: round2(recognizedRevenue),
      totalCOGS: round2(recognizedCogs),
      totalGrossProfit: round2(totalGrossProfit),
      totalExpenses: round2(recognizedExpenses),
      lotExpensesInLandedCost: round2(metrics.landed.lotExpensesPkr),
      netProfit: round2(netProfit),
      unsoldInventoryValue: round2(productProfits.reduce((s, p) => s + p.unsoldValue, 0)),
        totalRevenue: round2(recognizedRevenue),
      },
      lotReconciliation: allTimeReport.lotReconciliation,
      warnings: [
        ...unsupportedExpenseCurrencies.map((currency) => `${currency} expenses require stored PKR recognition metadata and are excluded from this lot preview.`),
        ...(!recognizedLot ? ["No posted PKR revenue or COGS was found for this lot."] : []),
        ...(revenueWeights.reduce((sum, weight) => sum + weight, 0) <= 0 && recognizedGrossRevenue !== 0
          ? ["Recognized lot revenue could not be allocated to product rows because product sale weights are unavailable."]
          : []),
        ...(cogsWeights.reduce((sum, weight) => sum + weight, 0) <= 0 && recognizedCogs !== 0
          ? ["Posted lot COGS could not be allocated to product rows because product cost weights are unavailable."]
          : []),
      ],
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
