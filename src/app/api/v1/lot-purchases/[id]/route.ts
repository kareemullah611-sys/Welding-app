import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalLotPurchase } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lot-purchases/[id] — edit a purchase line item
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const existing = await prisma.lotPurchase.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Purchase item not found", 404);

    const qtyMt = body.qtyMt !== undefined ? Number(body.qtyMt) : Number(existing.qty);
    const unitPriceUsdPerMt = body.unitPriceUsdPerMt !== undefined ? Number(body.unitPriceUsdPerMt) : Number(existing.unitPriceUsd);
    const weightPerCartonKg = body.weightPerCartonKg !== undefined ? Number(body.weightPerCartonKg) : (existing.weightPerCartonKg ? Number(existing.weightPerCartonKg) : null);
    const totalPriceUsd = Math.round(qtyMt * unitPriceUsdPerMt * 100) / 100;
    const newCartons = weightPerCartonKg && weightPerCartonKg > 0 ? Math.round((qtyMt * 1000) / weightPerCartonKg) : null;

    // Reverse old journal
    try { await reverseJournalEntries(`PURCH-${existing.lotId}-${id}`, user.userId); } catch (je) { console.error("Reverse journal (lot purchase):", je); }

    const updated = await prisma.lotPurchase.update({
      where: { id },
      data: { qty: qtyMt, unitPriceUsd: unitPriceUsdPerMt, totalPriceUsd, weightPerCartonKg: weightPerCartonKg ?? undefined },
    });

    // Re-create journal
    try {
      await journalLotPurchase({ id, supplierId: existing.supplierId, lotId: existing.lotId, totalUsd: totalPriceUsd, createdBy: user.userId });
    } catch (je) { console.error("Re-journal (lot purchase):", je); }

    // Recalculate lotProduct.totalQty for this product
    if (newCartons !== null) {
      const allPurchases = await prisma.lotPurchase.findMany({
        where: { lotId: existing.lotId, productId: existing.productId },
      });
      const totalCartons = allPurchases.reduce((s, p) => {
        const wt = p.id === id ? weightPerCartonKg! : (p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null);
        const mt = p.id === id ? qtyMt : Number(p.qty);
        return s + (wt && wt > 0 ? Math.round((mt * 1000) / wt) : 0);
      }, 0);
      await prisma.lotProduct.updateMany({
        where: { lotId: existing.lotId, productId: existing.productId },
        data: { totalQty: totalCartons },
      });
    }

    await createAuditLog(user.userId, null, "lot_purchases", id, "update",
      { qty: Number(existing.qty), unitPriceUsd: Number(existing.unitPriceUsd) },
      { qtyMt, unitPriceUsdPerMt, totalPriceUsd }, getClientIP(request));

    return successResponse({ id, qtyMt, unitPriceUsdPerMt, totalPriceUsd, weightPerCartonKg }, "Purchase item updated");
  } catch (error) { console.error("Update lot purchase:", error); return serverError(); }
});

// DELETE /api/v1/lot-purchases/[id] — delete a purchase line item
export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.lotPurchase.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Purchase item not found", 404);

    // Check there is more than one purchase item for this lot
    const count = await prisma.lotPurchase.count({ where: { lotId: existing.lotId } });
    if (count <= 1) return errorResponse("VALIDATION_ERROR", "Cannot delete the only purchase item in a lot", 400);

    // Reverse journal
    try { await reverseJournalEntries(`PURCH-${existing.lotId}-${id}`, user.userId); } catch (je) { console.error("Reverse journal (lot purchase delete):", je); }

    await prisma.lotPurchase.delete({ where: { id } });

    // Recalculate lotProduct.totalQty for this product
    const remaining = await prisma.lotPurchase.findMany({
      where: { lotId: existing.lotId, productId: existing.productId },
    });
    const totalCartons = remaining.reduce((s, p) => {
      const wt = p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null;
      const mt = Number(p.qty);
      return s + (wt && wt > 0 ? Math.round((mt * 1000) / wt) : 0);
    }, 0);
    if (remaining.length > 0) {
      await prisma.lotProduct.updateMany({
        where: { lotId: existing.lotId, productId: existing.productId },
        data: { totalQty: totalCartons },
      });
    } else {
      // No more purchases for this product in this lot — remove lotProduct
      await prisma.lotProduct.deleteMany({
        where: { lotId: existing.lotId, productId: existing.productId },
      });
    }

    await createAuditLog(user.userId, null, "lot_purchases", id, "delete",
      { qty: Number(existing.qty), supplierId: existing.supplierId, lotId: existing.lotId }, undefined, getClientIP(request));

    return successResponse({ id }, "Purchase item deleted");
  } catch (error) { console.error("Delete lot purchase:", error); return serverError(); }
});
