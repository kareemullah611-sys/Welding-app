import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/profit-report?lot_id=X or ?year=2026 or ?date_from=&date_to=
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const lotId = sp.get("lot_id") ? parseInt(sp.get("lot_id")!) : undefined;
    const year = sp.get("year") ? parseInt(sp.get("year")!) : undefined;
    const dateFrom = sp.get("date_from");
    const dateTo = sp.get("date_to");

    // LOT-LEVEL PROFIT
    if (lotId) {
      return await lotProfitReport(lotId, user);
    }

    // YEAR-END / DATE RANGE PROFIT
    return await periodProfitReport(user, year, dateFrom, dateTo);
  } catch (error) { console.error("Profit report error:", error); return serverError(); }
});

async function lotProfitReport(lotId: number, user: JWTPayload) {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: { country: true, lotProducts: { include: { product: true } } },
  });
  if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

  // Purchase costs
  const purchases = await prisma.lotPurchase.findMany({ where: { lotId }, include: { product: true, supplier: true } });
  const totalPurchaseUsd = purchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);
  const totalCartonsBought = lot.lotProducts.reduce((s, lp) => s + Number(lp.totalQty), 0);

  // Additional costs (customs, freight, transport, etc.)
  const costs = await prisma.lotCost.findMany({ where: { lotId } });
  const totalLotCosts = costs.reduce((s, c) => s + Number(c.amount), 0);
  const costBreakdown: Record<string, number> = {};
  for (const c of costs) { costBreakdown[c.costType] = (costBreakdown[c.costType] || 0) + Number(c.amount); }

  // Lot-tagged expenses also count as overhead (freight, misc paid as expenses)
  const lotExpensesAgg = await prisma.expense.aggregate({ where: { lotId, deletedAt: null }, _sum: { amount: true } });
  const totalLotExpenses = Number(lotExpensesAgg._sum.amount || 0);
  const totalAdditionalCosts = totalLotCosts + totalLotExpenses;

  // Total landed cost (purchases + ALL overheads including tagged expenses)
  const totalLandedCostUsd = totalPurchaseUsd + totalAdditionalCosts;
  const landedCostPerCarton = totalCartonsBought > 0 ? totalLandedCostUsd / totalCartonsBought : 0;

  // Per product breakdown
  const productCosts = purchases.map((p) => {
    const qtyMt = Number(p.qty);
    const wtPerCrt = p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null;
    const cartons = wtPerCrt && wtPerCrt > 0 ? Math.round((qtyMt * 1000) / wtPerCrt) : 0;
    const purchaseCost = Number(p.totalPriceUsd);
    const additionalCostShare = totalCartonsBought > 0 ? (cartons / totalCartonsBought) * totalAdditionalCosts : 0;
    const landedCost = purchaseCost + additionalCostShare;
    const landedPerCarton = cartons > 0 ? landedCost / cartons : 0;
    return {
      productId: p.productId, productName: p.product.name, supplierName: p.supplier.name,
      qtyMt, cartons, unitPriceUsd: Number(p.unitPriceUsd), purchaseCostUsd: purchaseCost,
      additionalCostShare: Math.round(additionalCostShare * 100) / 100,
      totalLandedCostUsd: Math.round(landedCost * 100) / 100,
      landedCostPerCartonUsd: Math.round(landedPerCarton * 100) / 100,
    };
  });

  // Sales revenue
  const salesWhere: any = { lotId, status: "active" };
  if (user.role === "city_admin") salesWhere.cityId = user.cityId;

  const sales = await prisma.sale.findMany({
    where: salesWhere,
    include: { items: { include: { product: true } }, currency: true, city: true },
  });

  let totalRevenue = 0;
  const salesByProduct: Record<number, { qty: number; revenue: number; productName: string }> = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      const pid = item.productId;
      if (!salesByProduct[pid]) salesByProduct[pid] = { qty: 0, revenue: 0, productName: item.product.name };
      salesByProduct[pid].qty += Number(item.qty);
      salesByProduct[pid].revenue += Number(item.amount);
      totalRevenue += Number(item.amount);
    }
  }

  // Discounts applied against this lot — reduce effective revenue
  const discountWhere: any = { appliedToLotId: lotId };
  if (user.role === "city_admin") discountWhere.sale = { cityId: user.cityId };
  const discountsAgg = await prisma.saleDiscount.aggregate({ where: discountWhere, _sum: { discountAmount: true } });
  const totalDiscounts = Number(discountsAgg._sum.discountAmount || 0);
  const netRevenue = totalRevenue - totalDiscounts;

  // City expenses for this lot (exclude soft-deleted)
  const expWhere: any = { lotId, deletedAt: null };
  if (user.role === "city_admin") expWhere.cityId = user.cityId;
  const expenses = await prisma.expense.aggregate({ where: expWhere, _sum: { amount: true } });
  const totalExpenses = Number(expenses._sum.amount || 0);

  // Profit per product
  const productProfits = productCosts.map((pc) => {
    const soldData = salesByProduct[pc.productId];
    const cartonsSold = soldData?.qty || 0;
    const grossRevenue = soldData?.revenue || 0;
    // Allocate discounts proportionally by revenue share
    const discountShare = totalRevenue > 0 ? (grossRevenue / totalRevenue) * totalDiscounts : 0;
    const revenue = grossRevenue - discountShare;
    const costOfSold = cartonsSold * pc.landedCostPerCartonUsd;
    const grossProfit = revenue - costOfSold;
    return {
      ...pc, cartonsSold, revenue: Math.round(revenue * 100) / 100,
      costOfGoodsSold: Math.round(costOfSold * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      cartonsRemaining: pc.cartons - cartonsSold,
      unsoldValue: Math.round((pc.cartons - cartonsSold) * pc.landedCostPerCartonUsd * 100) / 100,
    };
  });

  const totalGrossProfit = productProfits.reduce((s, p) => s + p.grossProfit, 0);
  const netProfit = totalGrossProfit - totalExpenses;

  return successResponse({
    lot: { id: lot.id, lotNumber: lot.lotNumber, lotDate: lot.lotDate.toISOString().split("T")[0], country: lot.country.name, status: lot.status },
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
      // backward-compat alias
      totalRevenue: Math.round(netRevenue * 100) / 100,
    },
  });
}

function parseDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

async function periodProfitReport(user: JWTPayload, year?: number, dateFrom?: string | null, dateTo?: string | null) {
  const saleWhere: any = { status: "active" };
  if (user.role === "city_admin") saleWhere.cityId = user.cityId;
  if (year) { saleWhere.saleDate = { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) }; }
  else if (dateFrom || dateTo) {
    saleWhere.saleDate = {};
    const from = parseDate(dateFrom);
    const to = parseDate(dateTo);
    if (from) saleWhere.saleDate.gte = from;
    if (to) saleWhere.saleDate.lte = to;
  }

  // Get all lots with purchases
  const lots = await prisma.lot.findMany({
    include: {
      lotPurchases: true, lotProducts: true, lotCosts: true, country: true,
      sales: { where: saleWhere, include: { items: true } },
      expenses: { where: user.role === "city_admin" ? { cityId: user.cityId!, deletedAt: null } : { deletedAt: null } },
    },
  });

  let totalRevenue = 0, totalCOGS = 0, totalExpenses = 0, totalCartonsSold = 0;
  const lotSummaries = [];

  // Fetch discounts for all lots in one query
  const allDiscounts = await prisma.saleDiscount.findMany({
    where: user.role === "city_admin" ? { sale: { cityId: user.cityId! } } : {},
    select: { appliedToLotId: true, discountAmount: true },
  });
  const discountByLot: Record<number, number> = {};
  for (const d of allDiscounts) {
    discountByLot[d.appliedToLotId] = (discountByLot[d.appliedToLotId] || 0) + Number(d.discountAmount);
  }

  for (const lot of lots) {
    if (!lot.sales.length && !lot.lotPurchases.length) continue;

    const purchaseTotal = lot.lotPurchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);
    const costsTotal = lot.lotCosts.reduce((s, c) => s + Number(c.amount), 0);
    // Include lot-tagged expenses in the overhead (same as lot-level report)
    const lotExpenses = lot.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalCartons = (lot.lotProducts as any[]).reduce((s: number, lp: any) => s + Number(lp.totalQty), 0);
    const landedCostPerCarton = totalCartons > 0 ? (purchaseTotal + costsTotal + lotExpenses) / totalCartons : 0;

    let grossLotRevenue = 0, lotCartonsSold = 0;
    for (const sale of lot.sales) {
      for (const item of sale.items) { grossLotRevenue += Number(item.amount); lotCartonsSold += Number(item.qty); }
    }
    // Subtract discounts from revenue
    const lotDiscounts = discountByLot[lot.id] || 0;
    const lotRevenue = grossLotRevenue - lotDiscounts;
    const lotCOGS = lotCartonsSold * landedCostPerCarton;

    totalRevenue += lotRevenue;
    totalCOGS += lotCOGS;
    totalExpenses += lotExpenses;
    totalCartonsSold += lotCartonsSold;

    if (grossLotRevenue > 0 || lotCartonsSold > 0) {
      lotSummaries.push({
        lotId: lot.id, lotNumber: lot.lotNumber, country: lot.country.name,
        landedCostPerCarton: Math.round(landedCostPerCarton * 100) / 100,
        cartonsSold: lotCartonsSold,
        grossRevenue: Math.round(grossLotRevenue * 100) / 100,
        discounts: Math.round(lotDiscounts * 100) / 100,
        revenue: Math.round(lotRevenue * 100) / 100,
        cogs: Math.round(lotCOGS * 100) / 100, expenses: Math.round(lotExpenses * 100) / 100,
        grossProfit: Math.round((lotRevenue - lotCOGS) * 100) / 100,
        netProfit: Math.round((lotRevenue - lotCOGS - lotExpenses) * 100) / 100,
      });
    }
  }

  // Supplier balance
  const totalPurchased = await prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } });
  const totalPaid = await prisma.supplierPayment.aggregate({ _sum: { amountUsd: true } });

  return successResponse({
    period: year ? `Year ${year}` : dateFrom || dateTo ? `${dateFrom || "start"} to ${dateTo || "now"}` : "All Time",
    profitAndLoss: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCOGS: Math.round(totalCOGS * 100) / 100,
      grossProfit: Math.round((totalRevenue - totalCOGS) * 100) / 100,
      grossMarginPercent: totalRevenue > 0 ? Math.round((totalRevenue - totalCOGS) / totalRevenue * 10000) / 100 : 0,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      netProfit: Math.round((totalRevenue - totalCOGS - totalExpenses) * 100) / 100,
      netMarginPercent: totalRevenue > 0 ? Math.round((totalRevenue - totalCOGS - totalExpenses) / totalRevenue * 10000) / 100 : 0,
    },
    cartonsSold: totalCartonsSold,
    supplierAccount: {
      totalPurchasedUsd: Number(totalPurchased._sum.totalPriceUsd || 0),
      totalPaidUsd: Number(totalPaid._sum.amountUsd || 0),
      balanceOwedUsd: Number(totalPurchased._sum.totalPriceUsd || 0) - Number(totalPaid._sum.amountUsd || 0),
    },
    lotBreakdown: lotSummaries,
  });
}
