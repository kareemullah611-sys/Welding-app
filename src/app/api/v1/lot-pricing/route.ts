import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

/**
 * GET /api/v1/lot-pricing?lot_id=X
 * Returns per-product landed cost per carton for a lot.
 * Used by the sales form to show salesman the floor price.
 *
 * Landed cost = (purchase cost USD + additional LotCost USD + lot-tagged expenses) / total cartons
 * Per product: purchase cost + proportional share of overheads
 */
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const lotId = sp.get("lot_id") ? parseInt(sp.get("lot_id")!) : undefined;
    if (!lotId) return errorResponse("VALIDATION_ERROR", "lot_id is required", 400);

    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: { lotProducts: { include: { product: true } } },
    });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    // --- Purchase costs per product ---
    const purchases = await prisma.lotPurchase.findMany({
      where: { lotId },
      include: { product: { select: { id: true, name: true } } },
    });

    // --- Additional costs (LotCost records, USD) ---
    const lotCosts = await prisma.lotCost.findMany({ where: { lotId } });
    const totalAdditionalCosts = lotCosts.reduce((s, c) => s + Number(c.amount), 0);

    // --- Lot-tagged expenses (also part of overhead) ---
    const expenses = await prisma.expense.aggregate({
      where: { lotId, deletedAt: null },
      _sum: { amount: true },
    });
    const totalExpenses = Number(expenses._sum.amount || 0);

    // Total overhead to distribute proportionally
    const totalOverhead = totalAdditionalCosts + totalExpenses;

    // Total cartons from purchases (source of truth for cost allocation)
    const totalCartonsBought = purchases.reduce((s, p) => s + Number(p.qty), 0);

    // Latest exchange rate (from purchases or costs)
    const latestExchangeRate =
      [...purchases].reverse().find((p) => p.exchangeRate && Number(p.exchangeRate) > 0)?.exchangeRate ??
      [...lotCosts].reverse().find((c) => c.exchangeRate && Number(c.exchangeRate) > 0)?.exchangeRate ??
      null;

    // --- Per-product landed cost ---
    const productMap: Record<
      number,
      { productId: number; productName: string; qty: number; purchaseCostUsd: number; landedCostUsd: number; landedPerCartonUsd: number; landedPerCartonLocal: number | null }
    > = {};

    for (const p of purchases) {
      const pid = p.productId;
      if (!productMap[pid]) {
        productMap[pid] = {
          productId: pid,
          productName: p.product.name,
          qty: 0,
          purchaseCostUsd: 0,
          landedCostUsd: 0,
          landedPerCartonUsd: 0,
          landedPerCartonLocal: null,
        };
      }
      productMap[pid].qty += Number(p.qty);
      productMap[pid].purchaseCostUsd += Number(p.totalPriceUsd);
    }

    for (const pid of Object.keys(productMap)) {
      const entry = productMap[parseInt(pid)];
      const overheadShare =
        totalCartonsBought > 0 ? (entry.qty / totalCartonsBought) * totalOverhead : 0;
      entry.landedCostUsd = Math.round((entry.purchaseCostUsd + overheadShare) * 100) / 100;
      entry.landedPerCartonUsd =
        entry.qty > 0 ? Math.round((entry.landedCostUsd / entry.qty) * 100) / 100 : 0;
      entry.landedPerCartonLocal =
        latestExchangeRate && Number(latestExchangeRate) > 0
          ? Math.round(entry.landedPerCartonUsd * Number(latestExchangeRate) * 100) / 100
          : null;
    }

    return successResponse({
      lotId,
      lotNumber: lot.lotNumber,
      totalCartons: totalCartonsBought,
      totalPurchaseCostUsd: Math.round(purchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0) * 100) / 100,
      totalOverheadUsd: Math.round(totalOverhead * 100) / 100,
      latestExchangeRate: latestExchangeRate ? Number(latestExchangeRate) : null,
      products: Object.values(productMap),
    });
  } catch (error) {
    console.error("Lot pricing error:", error);
    return serverError();
  }
});
