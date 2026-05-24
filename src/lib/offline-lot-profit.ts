import { getSyncedModuleData } from "@/lib/offline-full-sync";
import { readOfflineAuthCache } from "@/lib/offline-auth-cache";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Approximate per-lot profit report from synced modules (offline fallback). */
export async function buildOfflineLotProfitReport(lotId: number): Promise<Record<string, unknown> | null> {
  if (!lotId) return null;

  const [lots, lotPurchases, lotCosts, sales, expenses] = await Promise.all([
    getSyncedModuleData("lots"),
    getSyncedModuleData("lotPurchases"),
    getSyncedModuleData("lotCosts"),
    getSyncedModuleData("sales"),
    getSyncedModuleData("expenses"),
  ]);

  const cachedUser = typeof window !== "undefined" ? readOfflineAuthCache(window.localStorage)?.user : null;
  const cityScope = cachedUser?.role === "city_admin" ? cachedUser.cityId : null;

  return buildOfflineLotProfitFromModules({
    lotId,
    lots,
    lotPurchases,
    lotCosts,
    sales,
    expenses,
    cityScope,
  });
}

export function buildOfflineLotProfitFromModules(input: {
  lotId: number;
  lots: unknown;
  lotPurchases: unknown;
  lotCosts: unknown;
  sales: unknown;
  expenses: unknown;
  cityScope: number | null | undefined;
}): Record<string, unknown> | null {
  const lotId = input.lotId;
  if (!lotId) return null;

  const lots = input.lots;
  const lotPurchases = input.lotPurchases;
  const lotCosts = input.lotCosts;
  const sales = input.sales;
  const expenses = input.expenses;
  const cityScope = input.cityScope;

  const lot = asArray(lots).find((row) => Number((row as { id?: number }).id) === lotId) as Record<string, unknown> | undefined;
  if (!lot) return null;

  const purchases = asArray(lotPurchases).filter((row) => Number((row as { lotId?: number }).lotId) === lotId);
  const costs = asArray(lotCosts).filter((row) => Number((row as { lotId?: number }).lotId) === lotId);
  const lotExpenses = asArray(expenses).filter((row) => {
    const e = row as { lotId?: number; cityId?: number; deletedAt?: unknown };
    if (Number(e.lotId) !== lotId) return false;
    if (e.deletedAt) return false;
    if (cityScope && Number(e.cityId) !== cityScope) return false;
    return true;
  });

  const totalPurchaseUsd = purchases.reduce((s: number, p) => s + num((p as { totalPriceUsd?: number }).totalPriceUsd), 0);
  const totalLotCosts = costs.reduce((s: number, c) => s + num((c as { amount?: number }).amount), 0);
  const totalLotExpenses = lotExpenses.reduce((s: number, e) => s + num((e as { amount?: number }).amount), 0);
  const totalAdditionalCosts = totalLotCosts + totalLotExpenses;
  const totalLandedCostUsd = totalPurchaseUsd + totalAdditionalCosts;

  const lotProducts = asArray(lot.products).length ? asArray(lot.products) : asArray((lot as { lotProducts?: unknown[] }).lotProducts);
  const totalCartonsBought = lotProducts.reduce((s: number, lp) => s + num((lp as { totalQty?: number }).totalQty), 0);
  const landedCostPerCarton = totalCartonsBought > 0 ? totalLandedCostUsd / totalCartonsBought : 0;

  const costBreakdown: Record<string, number> = {};
  for (const c of costs) {
    const costType = String((c as { costType?: string }).costType || "other");
    costBreakdown[costType] = (costBreakdown[costType] || 0) + num((c as { amount?: number }).amount);
  }

  const productCosts = purchases.map((p) => {
    const row = p as {
      productId?: number;
      product?: { name?: string };
      supplier?: { name?: string };
      qty?: number;
      weightPerCartonKg?: number;
      unitPriceUsd?: number;
      totalPriceUsd?: number;
    };
    const wtPerCrt = num(row.weightPerCartonKg);
    const qtyMt = num(row.qty);
    const cartons = wtPerCrt > 0 ? Math.round((qtyMt * 1000) / wtPerCrt) : 0;
    const purchaseCost = num(row.totalPriceUsd);
    const additionalCostShare = totalCartonsBought > 0 ? (cartons / totalCartonsBought) * totalAdditionalCosts : 0;
    const landedCost = purchaseCost + additionalCostShare;
    const landedPerCarton = cartons > 0 ? landedCost / cartons : 0;
    return {
      productId: row.productId,
      productName: row.product?.name ?? "",
      supplierName: row.supplier?.name ?? "",
      qtyMt,
      cartons,
      unitPriceUsd: num(row.unitPriceUsd),
      purchaseCostUsd: purchaseCost,
      additionalCostShare: Math.round(additionalCostShare * 100) / 100,
      totalLandedCostUsd: Math.round(landedCost * 100) / 100,
      landedCostPerCartonUsd: Math.round(landedPerCarton * 100) / 100,
    };
  });

  let totalRevenue = 0;
  const salesByProduct: Record<number, { qty: number; revenue: number; productName: string }> = {};
  for (const sale of asArray(sales)) {
    const s = sale as { lotId?: number; status?: string; cityId?: number; items?: unknown[]; discounts?: unknown[] };
    if (Number(s.lotId) !== lotId || s.status !== "active") continue;
    if (cityScope && Number(s.cityId) !== cityScope) continue;
    for (const item of asArray(s.items)) {
      const si = item as { productId?: number; qty?: number; amount?: number; product?: { name?: string } };
      const pid = Number(si.productId || 0);
      if (!salesByProduct[pid]) {
        salesByProduct[pid] = { qty: 0, revenue: 0, productName: si.product?.name ?? "" };
      }
      salesByProduct[pid].qty += num(si.qty);
      salesByProduct[pid].revenue += num(si.amount);
      totalRevenue += num(si.amount);
    }
  }

  let totalDiscounts = 0;
  for (const sale of asArray(sales)) {
    const s = sale as { lotId?: number; status?: string; cityId?: number; discounts?: unknown[] };
    if (Number(s.lotId) !== lotId || s.status !== "active") continue;
    if (cityScope && Number(s.cityId) !== cityScope) continue;
    for (const d of asArray(s.discounts)) {
      totalDiscounts += num((d as { discountAmount?: number }).discountAmount);
    }
  }

  const netRevenue = totalRevenue - totalDiscounts;
  const totalExpenses = totalLotExpenses;

  const productProfits = productCosts.map((pc) => {
    const soldData = salesByProduct[Number(pc.productId)];
    const cartonsSold = soldData?.qty || 0;
    const grossRevenue = soldData?.revenue || 0;
    const discountShare = totalRevenue > 0 ? (grossRevenue / totalRevenue) * totalDiscounts : 0;
    const revenue = grossRevenue - discountShare;
    const costOfSold = cartonsSold * pc.landedCostPerCartonUsd;
    const grossProfit = revenue - costOfSold;
    return {
      ...pc,
      cartonsSold,
      revenue: Math.round(revenue * 100) / 100,
      costOfGoodsSold: Math.round(costOfSold * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      cartonsRemaining: pc.cartons - cartonsSold,
      unsoldValue: Math.round((pc.cartons - cartonsSold) * pc.landedCostPerCartonUsd * 100) / 100,
    };
  });

  const totalGrossProfit = productProfits.reduce((s, p) => s + p.grossProfit, 0);
  const netProfit = totalGrossProfit - totalExpenses;

  return {
    lot: {
      id: lot.id,
      lotNumber: lot.lotNumber,
      lotDate: String(lot.lotDate || "").slice(0, 10),
      country: lot.countryName ?? (lot.country as { name?: string })?.name ?? "",
      status: lot.status,
    },
    costSummary: {
      totalPurchaseUsd: Math.round(totalPurchaseUsd * 100) / 100,
      totalLotCosts: Math.round(totalLotCosts * 100) / 100,
      totalLotExpenses: Math.round(totalLotExpenses * 100) / 100,
      totalAdditionalCosts: Math.round(totalAdditionalCosts * 100) / 100,
      costBreakdown,
      totalLandedCostUsd: Math.round(totalLandedCostUsd * 100) / 100,
      totalCartons: totalCartonsBought,
      landedCostPerCarton: Math.round(landedCostPerCarton * 100) / 100,
    },
    productCosts: productProfits,
    profitSummary: {
      grossRevenue: Math.round(totalRevenue * 100) / 100,
      totalDiscounts: Math.round(totalDiscounts * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      totalCOGS: Math.round(productProfits.reduce((s, p) => s + p.costOfGoodsSold, 0) * 100) / 100,
      totalGrossProfit: Math.round(totalGrossProfit * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      unsoldInventoryValue: Math.round(productProfits.reduce((s, p) => s + p.unsoldValue, 0) * 100) / 100,
      totalRevenue: Math.round(netRevenue * 100) / 100,
    },
  };
}
