import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { autoActivateShortSales } from "@/lib/stock-activation";

// PUT - approve or reject
export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const { action, toGodownId, approvalNotes } = body; // action: "approve" | "reject"

    const transfer = await prisma.cityTransfer.findUnique({ where: { id } });
    if (!transfer) return errorResponse("NOT_FOUND", "Transfer not found", 404);
    if (transfer.status !== "pending") return errorResponse("VALIDATION_ERROR", "Transfer is not pending");

    // Only receiving city admin or super admin can approve/reject
    if (user.role === "city_admin" && transfer.toCityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Only the receiving city can approve/reject", 403);
    }

    if (action === "approve") {
      if (!toGodownId) return errorResponse("VALIDATION_ERROR", "Select a godown to receive goods");

      // Verify godown belongs to receiving city
      const godown = await prisma.godown.findFirst({ where: { id: toGodownId, cityId: transfer.toCityId, isActive: true } });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in receiving city");

      const lot = await prisma.lot.findUnique({ where: { id: transfer.lotId }, select: { status: true, lotNumber: true } });
      if (!lot || lot.status === "completed") {
        return errorResponse("VALIDATION_ERROR", `Cannot approve — lot ${lot?.lotNumber || transfer.lotId} is completed. Ask super admin to reopen it first.`);
      }

      const transferQty = Number(transfer.qty);

      // Fix C2: wrap the entire approval in a single transaction with an advisory lock.
      const approvedResult = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(31001, ${transfer.fromGodownId * 100000 + transfer.productId}::int)`;

        const fresh = await tx.cityTransfer.findUnique({ where: { id }, select: { status: true } });
        if (!fresh || fresh.status !== "pending") {
          throw new Error("TRANSFER_NOT_PENDING");
        }

        let effectiveLotId = transfer.lotId;
        let senderLcd = await tx.lotCityDistribution.findUnique({
          where: { lotId_cityId_productId: { lotId: transfer.lotId, cityId: transfer.fromCityId, productId: transfer.productId } },
          include: { godownAllocations: { where: { godownId: transfer.fromGodownId }, select: { id: true, qty: true } } },
        });
        let senderAllocRow = senderLcd?.godownAllocations[0];

        if (!senderAllocRow || Number(senderAllocRow.qty) < transferQty) {
          const fallbackRows: any[] = await tx.$queryRaw`
            SELECT
              lcd.id as lcd_id,
              lcd.lot_id,
              lcga.id as allocation_id,
              lcga.qty,
              COALESCE(lcga.qty, 0) - COALESCE((
                SELECT SUM(si.qty) FROM sale_items si
                JOIN sales s ON s.id = si.sale_id AND s.status IN ('active','marked_short')
                WHERE s.godown_id = ${transfer.fromGodownId} AND si.product_id = ${transfer.productId} AND si.lot_id = lcd.lot_id
              ), 0) - COALESCE((
                SELECT SUM(ct.qty) FROM city_transfers ct
                WHERE ct.from_godown_id = ${transfer.fromGodownId}
                  AND ct.product_id = ${transfer.productId}
                  AND ct.lot_id = lcd.lot_id
                  AND ct.status = 'pending'
                  AND ct.id <> ${id}
              ), 0) as available
            FROM lot_city_godown_allocations lcga
            JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
            JOIN lots l ON l.id = lcd.lot_id
            WHERE lcga.godown_id = ${transfer.fromGodownId}
              AND lcd.city_id = ${transfer.fromCityId}
              AND lcd.product_id = ${transfer.productId}
              AND l.status = 'ongoing'
              AND COALESCE(lcga.qty, 0) - COALESCE((
                SELECT SUM(si.qty) FROM sale_items si
                JOIN sales s ON s.id = si.sale_id AND s.status IN ('active','marked_short')
                WHERE s.godown_id = ${transfer.fromGodownId} AND si.product_id = ${transfer.productId} AND si.lot_id = lcd.lot_id
              ), 0) - COALESCE((
                SELECT SUM(ct.qty) FROM city_transfers ct
                WHERE ct.from_godown_id = ${transfer.fromGodownId}
                  AND ct.product_id = ${transfer.productId}
                  AND ct.lot_id = lcd.lot_id
                  AND ct.status = 'pending'
                  AND ct.id <> ${id}
              ), 0) >= ${transferQty}
            ORDER BY l.lot_date ASC, l.id ASC
            LIMIT 1
          `;
          const fallback = fallbackRows[0];
          if (fallback) {
            effectiveLotId = Number(fallback.lot_id);
            senderLcd = { id: Number(fallback.lcd_id), godownAllocations: [{ id: Number(fallback.allocation_id), qty: fallback.qty }] } as any;
            senderAllocRow = { id: Number(fallback.allocation_id), qty: fallback.qty };
          }
        }

        if (!senderLcd || !senderAllocRow) {
          throw new Error("SENDER_NO_STOCK");
        }
        if (Number(senderAllocRow.qty) < transferQty) {
          throw new Error("SENDER_INSUFFICIENT_STOCK");
        }

        await tx.cityTransfer.update({
          where: { id },
          data: { status: "approved", lotId: effectiveLotId, toGodownId, approvalNotes, approvedBy: user.userId, approvedAt: new Date() },
        });

        let lcd = await tx.lotCityDistribution.findUnique({
          where: { lotId_cityId_productId: { lotId: effectiveLotId, cityId: transfer.toCityId, productId: transfer.productId } },
        });
        if (!lcd) {
          lcd = await tx.lotCityDistribution.create({
            data: { lotId: effectiveLotId, cityId: transfer.toCityId, productId: transfer.productId, allocatedQty: transferQty },
          });
        } else {
          await tx.lotCityDistribution.update({ where: { id: lcd.id }, data: { allocatedQty: { increment: transferQty } } });
        }

        const existingAlloc = await tx.lotCityGodownAllocation.findFirst({ where: { lotCityDistributionId: lcd.id, godownId: toGodownId } });
        if (existingAlloc) {
          await tx.lotCityGodownAllocation.update({ where: { id: existingAlloc.id }, data: { qty: { increment: transferQty } } });
        } else {
          await tx.lotCityGodownAllocation.create({ data: { lotCityDistributionId: lcd.id, godownId: toGodownId, productId: transfer.productId, qty: transferQty } });
        }

        await tx.lotCityGodownAllocation.update({ where: { id: senderAllocRow.id }, data: { qty: { decrement: transferQty } } });
        await tx.lotCityDistribution.update({ where: { id: senderLcd.id }, data: { allocatedQty: { decrement: transferQty } } });

        await createAuditLog(user.userId, transfer.toCityId, "city_transfers", id, "update", { status: "pending" }, { status: "approved", toGodownId }, getClientIP(request), tx);
        return { ok: true as const };
      }).catch((err: unknown) => {
        const msg = (err as Error)?.message ?? "";
        if (msg === "TRANSFER_NOT_PENDING") return { ok: false as const, code: "CONFLICT", message: "Transfer is no longer pending" };
        if (msg === "SENDER_NO_STOCK") return { ok: false as const, code: "NOT_FOUND", message: "Sender has no stock allocation for this godown/lot/product — refresh and try again" };
        if (msg === "SENDER_INSUFFICIENT_STOCK") return { ok: false as const, code: "CONFLICT", message: `Sender has insufficient stock (${transferQty} requested). Refresh and reject the transfer if needed.` };
        throw err;
      });

      if (!approvedResult.ok) {
        return errorResponse(approvedResult.code, approvedResult.message, approvedResult.code === "CONFLICT" ? 409 : 404);
      }

      const activated = await autoActivateShortSales(toGodownId);
      return successResponse(
        { id, salesActivated: activated },
        activated > 0 ? `Transfer approved — ${activated} short sale(s) auto-activated` : "Transfer approved — goods added to godown"
      );

    } else if (action === "reject") {
      await prisma.cityTransfer.update({
        where: { id },
        data: { status: "rejected", approvalNotes, approvedBy: user.userId, approvedAt: new Date() },
      });
      await createAuditLog(user.userId, transfer.toCityId, "city_transfers", id, "update", { status: "pending" }, { status: "rejected" }, getClientIP(request));
      return successResponse({ id }, "Transfer rejected");
    }

    return errorResponse("VALIDATION_ERROR", "Action must be 'approve' or 'reject'");
  } catch (error) { console.error("City transfer action:", error); return serverError(); }
});
