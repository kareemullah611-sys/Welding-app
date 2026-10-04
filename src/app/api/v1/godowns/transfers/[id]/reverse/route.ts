import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { lockGodownProductStock } from "@/lib/financial-locks";

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can reverse stock transfers", 403);
    const id = Number(context.params.id);
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (!reason) return validationError("Reversal reason is required");

    const reversal = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`godown-transfer:${id}`}))`;
      const original = await tx.godownTransfer.findFirst({
        where: { id, fromGodown: { cityId: user.cityId! }, toGodown: { cityId: user.cityId! } },
      });
      if (!original) throw Object.assign(new Error("Transfer not found"), { code: "NOT_FOUND" });
      const prior = await tx.auditLog.findFirst({
        where: { entityType: "godown_transfers", entityId: id, action: "cancel" },
      });
      if (prior) throw Object.assign(new Error("Transfer is already reversed"), { code: "ALREADY_REVERSED" });

      await lockGodownProductStock(tx, [
        { godownId: original.fromGodownId, productId: original.productId },
        { godownId: original.toGodownId, productId: original.productId },
      ]);
      const rows: Array<{ available: unknown }> = await tx.$queryRaw`
        SELECT
          COALESCE((SELECT SUM(lcga.qty) FROM lot_city_godown_allocations lcga
            JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
            WHERE lcga.godown_id = ${original.toGodownId} AND lcd.product_id = ${original.productId} AND lcd.lot_id = ${original.lotId}), 0)
          - COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id
            WHERE s.godown_id = ${original.toGodownId} AND si.product_id = ${original.productId}
              AND si.lot_id = ${original.lotId} AND s.status IN ('active','marked_short')), 0)
          - COALESCE((SELECT SUM(gt.qty) FROM godown_transfers gt
            WHERE gt.from_godown_id = ${original.toGodownId} AND gt.product_id = ${original.productId} AND gt.lot_id = ${original.lotId}), 0)
          + COALESCE((SELECT SUM(gt.qty) FROM godown_transfers gt
            WHERE gt.to_godown_id = ${original.toGodownId} AND gt.product_id = ${original.productId} AND gt.lot_id = ${original.lotId}), 0)
          AS available
      `;
      const available = Number(rows[0]?.available || 0);
      if (Number(original.qty) > available + 0.001) {
        throw Object.assign(new Error(`Destination has only ${available} available; consumed stock cannot be reversed`), { code: "STOCK_CONSUMED" });
      }

      const created = await tx.godownTransfer.create({
        data: {
          fromGodownId: original.toGodownId,
          toGodownId: original.fromGodownId,
          productId: original.productId,
          lotId: original.lotId,
          qty: original.qty,
          transferDate: new Date(),
          notes: `Reversal of transfer #${original.id}: ${reason}`,
          createdBy: user.userId,
        },
      });
      await createAuditLog(user.userId, user.cityId!, "godown_transfers", original.id, "cancel", original, { reversalTransferId: created.id, reason }, getClientIP(request), tx);
      return created;
    });
    return successResponse({ id: reversal.id }, "Stock transfer reversed");
  } catch (error: any) {
    if (error?.code === "NOT_FOUND") return errorResponse("NOT_FOUND", error.message, 404);
    if (error?.code === "ALREADY_REVERSED") return errorResponse("ALREADY_REVERSED", error.message, 409);
    if (error?.code === "STOCK_CONSUMED") return errorResponse("STOCK_CONSUMED", error.message, 409);
    console.error("Reverse godown transfer:", error);
    return serverError();
  }
});
