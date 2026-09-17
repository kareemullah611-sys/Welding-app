import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import {
  buildLotPurchasePkrBasis,
  calculateLotProductLandedCostsForLot,
  journalLotPurchaseCorrection,
  loadLotSupplierPurchaseBalances,
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lot-purchase:${existing.lotId}`}::text)::bigint)`;
      const [beforeProducts, beforeSupplierBalances] = await Promise.all([
        calculateLotProductLandedCostsForLot(existing.lotId, tx),
        loadLotSupplierPurchaseBalances(existing.lotId, tx),
      ]);
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
      const [afterProducts, afterSupplierBalances] = await Promise.all([
        calculateLotProductLandedCostsForLot(existing.lotId, tx),
        loadLotSupplierPurchaseBalances(existing.lotId, tx),
      ]);
      await journalLotPurchaseCorrection({
        lotId: existing.lotId,
        correctionReference: `PURCHCORR-${existing.lotId}-${id}-V${updated.journalVersion}`,
        correctionDate: new Date(),
        createdBy: user.userId,
        beforeProducts,
        afterProducts,
        beforeSupplierBalances,
        afterSupplierBalances,
      }, tx);

      await createAuditLog(user.userId, null, "lot_purchases", id, "update",
        { qty: Number(existing.qty), unitPriceUsd: Number(existing.unitPriceUsd) },
        { qtyMt, unitPriceUsdPerMt, totalPriceUsd }, getClientIP(request), tx);
    });

    return successResponse({ id, qtyMt, unitPriceUsdPerMt, totalPriceUsd, weightPerCartonKg }, "Purchase item updated");
  } catch (error) {
    if (error instanceof Error && /sold quantities exceed corrected product quantity/i.test(error.message)) {
      return errorResponse("VALIDATION_ERROR", error.message, 400);
    }
    console.error("Update lot purchase:", error);
    return serverError();
  }
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lot-purchase:${existing.lotId}`}::text)::bigint)`;
      const [beforeProducts, beforeSupplierBalances] = await Promise.all([
        calculateLotProductLandedCostsForLot(existing.lotId, tx),
        loadLotSupplierPurchaseBalances(existing.lotId, tx),
      ]);
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
        const soldCount = await tx.saleItem.count({
          where: { lotId: existing.lotId, productId: existing.productId, sale: { status: { in: ["active", "marked_short"] } } },
        });
        if (soldCount > 0) throw new Error("PRODUCT_WITH_SALES_REMOVED");
        await tx.lotProduct.deleteMany({
          where: { lotId: existing.lotId, productId: existing.productId },
        });
      }
      const [afterProducts, afterSupplierBalances] = await Promise.all([
        calculateLotProductLandedCostsForLot(existing.lotId, tx),
        loadLotSupplierPurchaseBalances(existing.lotId, tx),
      ]);
      await journalLotPurchaseCorrection({
        lotId: existing.lotId,
        correctionReference: `PURCHCORR-${existing.lotId}-${id}-DELETE-V${existing.journalVersion + 1}`,
        correctionDate: new Date(),
        createdBy: user.userId,
        beforeProducts,
        afterProducts,
        beforeSupplierBalances,
        afterSupplierBalances,
      }, tx);

      await createAuditLog(user.userId, null, "lot_purchases", id, "delete",
        { qty: Number(existing.qty), supplierId: existing.supplierId, lotId: existing.lotId }, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Purchase item deleted");
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_WITH_SALES_REMOVED") {
      return errorResponse("VALIDATION_ERROR", "A purchase product with recorded sales cannot be removed", 400);
    }
    console.error("Delete lot purchase:", error);
    return serverError();
  }
});
