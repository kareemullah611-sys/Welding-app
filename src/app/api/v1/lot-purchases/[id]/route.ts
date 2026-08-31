import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import {
  buildLotPurchasePkrBasis,
  journalLotPurchase,
  lotPurchaseJournalTransactionId,
  reverseJournalEntries,
} from "@/lib/accounting";
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

    const lot = await prisma.lot.findUnique({ where: { id: existing.lotId }, select: { lotDate: true, pkrExchangeRate: true, pkrExchangeRateMetadata: true } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    const carryingRatePkr = Number(existing.carryingRatePkr || lot.pkrExchangeRate || 0);
    const basis = buildLotPurchasePkrBasis({ totalUsd: totalPriceUsd, carryingRatePkr });

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(lotPurchaseJournalTransactionId(existing.lotId, id, existing.journalVersion), user.userId, tx);
      const updated = await tx.lotPurchase.update({
        where: { id },
        data: {
          qty: qtyMt,
          unitPriceUsd: unitPriceUsdPerMt,
          totalPriceUsd,
          weightPerCartonKg: weightPerCartonKg ?? undefined,
          carryingRatePkr: basis.carryingRatePkr,
          carryingAmountPkr: basis.carryingAmountPkr,
          recognitionDate: existing.recognitionDate || lot.lotDate,
          recognitionRateMetadata: existing.recognitionRateMetadata || lot.pkrExchangeRateMetadata as any,
          journalVersion: { increment: 1 },
        },
      });
      await journalLotPurchase({
        id,
        supplierId: existing.supplierId,
        lotId: existing.lotId,
        totalUsd: totalPriceUsd,
        carryingRatePkr: basis.carryingRatePkr,
        carryingAmountPkr: basis.carryingAmountPkr,
        recognitionDate: updated.recognitionDate || lot.lotDate,
        journalVersion: updated.journalVersion,
        createdBy: user.userId,
      }, tx);

      if (newCartons !== null) {
        const allPurchases = await tx.lotPurchase.findMany({
          where: { lotId: existing.lotId, productId: existing.productId },
        });
      const totalCartons = allPurchases.reduce((s, p) => {
        const wt = p.id === id ? weightPerCartonKg! : (p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null);
        const mt = p.id === id ? qtyMt : Number(p.qty);
        return s + (wt && wt > 0 ? Math.round((mt * 1000) / wt) : 0);
      }, 0);
        await tx.lotProduct.updateMany({
          where: { lotId: existing.lotId, productId: existing.productId },
          data: { totalQty: totalCartons },
        });
      }

      await createAuditLog(user.userId, null, "lot_purchases", id, "update",
        { qty: Number(existing.qty), unitPriceUsd: Number(existing.unitPriceUsd) },
        { qtyMt, unitPriceUsdPerMt, totalPriceUsd }, getClientIP(request), tx);
    });

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

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(lotPurchaseJournalTransactionId(existing.lotId, id, existing.journalVersion), user.userId, tx);
      await tx.lotPurchase.delete({ where: { id } });

      const remaining = await tx.lotPurchase.findMany({
        where: { lotId: existing.lotId, productId: existing.productId },
      });
      const totalCartons = remaining.reduce((s, p) => {
        const wt = p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null;
        const mt = Number(p.qty);
        return s + (wt && wt > 0 ? Math.round((mt * 1000) / wt) : 0);
      }, 0);
      if (remaining.length > 0) {
        await tx.lotProduct.updateMany({
          where: { lotId: existing.lotId, productId: existing.productId },
          data: { totalQty: totalCartons },
        });
      } else {
        await tx.lotProduct.deleteMany({
          where: { lotId: existing.lotId, productId: existing.productId },
        });
      }

      await createAuditLog(user.userId, null, "lot_purchases", id, "delete",
        { qty: Number(existing.qty), supplierId: existing.supplierId, lotId: existing.lotId }, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Purchase item deleted");
  } catch (error) { console.error("Delete lot purchase:", error); return serverError(); }
});
