import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { autoActivateShortSales } from "@/lib/stock-activation";
import { lockGodownProductStock } from "@/lib/financial-locks";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const { action, toGodownId, approvalNotes } = body;

    const anchor = await prisma.cityTransfer.findUnique({ where: { id } });
    if (!anchor) return errorResponse("NOT_FOUND", "Transfer not found", 404);
    const transfers = anchor.batchId
      ? await prisma.cityTransfer.findMany({ where: { batchId: anchor.batchId }, orderBy: { id: "asc" } })
      : [anchor];
    if (transfers.some((transfer) => transfer.status !== "pending")) {
      return errorResponse("VALIDATION_ERROR", "Transfer is not pending");
    }
    if (user.role === "city_admin" && anchor.toCityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Only the receiving city can approve/reject", 403);
    }

    const transferIds = transfers.map((transfer) => transfer.id);
    const sourceLocks = transfers.map((transfer) => ({ godownId: transfer.fromGodownId, productId: transfer.productId }));

    if (action === "approve") {
      const parsedToGodownId = Number(toGodownId || 0);
      if (!parsedToGodownId) return errorResponse("VALIDATION_ERROR", "Select a godown to receive goods");
      const godown = await prisma.godown.findFirst({
        where: { id: parsedToGodownId, cityId: anchor.toCityId, isActive: true },
      });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in receiving city");

      const lotIds = Array.from(new Set(transfers.map((transfer) => transfer.lotId)));
      const openLotCount = await prisma.lot.count({ where: { id: { in: lotIds }, status: "ongoing" } });
      if (openLotCount !== lotIds.length) {
        return errorResponse("VALIDATION_ERROR", "Cannot approve because one or more source lots are completed. Ask super admin to reopen them first.");
      }

      const result = await prisma.$transaction(async (tx) => {
        await lockGodownProductStock(tx, [
          ...sourceLocks,
          ...transfers.map((transfer) => ({ godownId: parsedToGodownId, productId: transfer.productId })),
        ]);
        const updated = await tx.cityTransfer.updateMany({
          where: { id: { in: transferIds }, status: "pending" },
          data: {
            status: "approved",
            toGodownId: parsedToGodownId,
            approvalNotes,
            approvedBy: user.userId,
            approvedAt: new Date(),
          },
        });
        if (updated.count !== transferIds.length) throw new Error("TRANSFER_NOT_PENDING");

        for (const row of transfers) {
          const transferQty = Number(row.qty);
          if (!row.batchId) {
            const sourceDistribution = await tx.lotCityDistribution.findUnique({
              where: { lotId_cityId_productId: { lotId: row.lotId, cityId: row.fromCityId, productId: row.productId } },
            });
            if (!sourceDistribution) throw new Error("SOURCE_DISTRIBUTION_MISSING");
            const sourceAllocation = await tx.lotCityGodownAllocation.findFirst({
              where: { lotCityDistributionId: sourceDistribution.id, godownId: row.fromGodownId },
            });
            if (!sourceAllocation) throw new Error("SOURCE_ALLOCATION_MISSING");
            const [sold, transferredOut, transferredIn, otherLegacyPending] = await Promise.all([
              tx.saleItem.aggregate({
                where: { productId: row.productId, lotId: row.lotId, sale: { godownId: row.fromGodownId, status: { in: ["active", "marked_short"] } } },
                _sum: { qty: true },
              }),
              tx.godownTransfer.aggregate({ where: { fromGodownId: row.fromGodownId, productId: row.productId, lotId: row.lotId }, _sum: { qty: true } }),
              tx.godownTransfer.aggregate({ where: { toGodownId: row.fromGodownId, productId: row.productId, lotId: row.lotId }, _sum: { qty: true } }),
              tx.cityTransfer.aggregate({
                where: { fromGodownId: row.fromGodownId, productId: row.productId, lotId: row.lotId, status: "pending", batchId: null, id: { not: row.id } },
                _sum: { qty: true },
              }),
            ]);
            const available = Number(sourceAllocation.qty)
              - Number(sold._sum.qty || 0)
              - Number(transferredOut._sum.qty || 0)
              + Number(transferredIn._sum.qty || 0)
              - Number(otherLegacyPending._sum.qty || 0);
            if (available < transferQty) throw new Error("SOURCE_INSUFFICIENT_STOCK");
            await tx.lotCityGodownAllocation.update({
              where: { id: sourceAllocation.id },
              data: { qty: { decrement: transferQty } },
            });
            await tx.lotCityDistribution.update({
              where: { id: sourceDistribution.id },
              data: { allocatedQty: { decrement: transferQty } },
            });
          }
          const distribution = await tx.lotCityDistribution.upsert({
            where: { lotId_cityId_productId: { lotId: row.lotId, cityId: row.toCityId, productId: row.productId } },
            create: { lotId: row.lotId, cityId: row.toCityId, productId: row.productId, allocatedQty: transferQty },
            update: { allocatedQty: { increment: transferQty } },
          });
          const destinationAllocation = await tx.lotCityGodownAllocation.findFirst({
            where: { lotCityDistributionId: distribution.id, godownId: parsedToGodownId },
          });
          if (destinationAllocation) {
            await tx.lotCityGodownAllocation.update({
              where: { id: destinationAllocation.id },
              data: { qty: { increment: transferQty } },
            });
          } else {
            await tx.lotCityGodownAllocation.create({
              data: {
                lotCityDistributionId: distribution.id,
                godownId: parsedToGodownId,
                productId: row.productId,
                qty: transferQty,
              },
            });
          }
          await createAuditLog(user.userId, row.toCityId, "city_transfers", row.id, "update", { status: "pending" }, {
            status: "approved", toGodownId: parsedToGodownId, batchId: row.batchId,
          }, getClientIP(request), tx);
        }
        return { count: updated.count };
      }).catch((error: unknown) => {
        const message = (error as Error)?.message || "";
        if (message === "TRANSFER_NOT_PENDING") return { error: "Transfer is no longer pending", status: 409 };
        if (message === "SOURCE_DISTRIBUTION_MISSING" || message === "SOURCE_ALLOCATION_MISSING" || message === "SOURCE_INSUFFICIENT_STOCK") {
          return { error: "Sender stock no longer covers this legacy transfer; approval was rolled back", status: 409 };
        }
        throw error;
      });
      if ("error" in result) return errorResponse("CONFLICT", result.error, result.status);

      const activated = await autoActivateShortSales(parsedToGodownId);
      return successResponse(
        { id, batchId: anchor.batchId, transferIds, salesActivated: activated },
        activated > 0 ? `Transfer approved — ${activated} short sale(s) auto-activated` : "Transfer approved — goods added to godown",
      );
    }

    if (action === "reject") {
      const result = await prisma.$transaction(async (tx) => {
        await lockGodownProductStock(tx, sourceLocks);
        const updated = await tx.cityTransfer.updateMany({
          where: { id: { in: transferIds }, status: "pending" },
          data: { status: "rejected", approvalNotes, approvedBy: user.userId, approvedAt: new Date() },
        });
        if (updated.count !== transferIds.length) throw new Error("TRANSFER_NOT_PENDING");

        for (const row of transfers) {
          if (!row.batchId) {
            await createAuditLog(user.userId, row.toCityId, "city_transfers", row.id, "update", { status: "pending" }, {
              status: "rejected", batchId: null,
            }, getClientIP(request), tx);
            continue;
          }
          const distribution = await tx.lotCityDistribution.findUnique({
            where: { lotId_cityId_productId: { lotId: row.lotId, cityId: row.fromCityId, productId: row.productId } },
          });
          if (!distribution) throw new Error("SOURCE_DISTRIBUTION_MISSING");
          const sourceAllocation = await tx.lotCityGodownAllocation.findFirst({
            where: { lotCityDistributionId: distribution.id, godownId: row.fromGodownId },
          });
          if (!sourceAllocation) throw new Error("SOURCE_ALLOCATION_MISSING");
          await tx.lotCityGodownAllocation.update({
            where: { id: sourceAllocation.id },
            data: { qty: { increment: Number(row.qty) } },
          });
          await tx.lotCityDistribution.update({
            where: { id: distribution.id },
            data: { allocatedQty: { increment: Number(row.qty) } },
          });
          await createAuditLog(user.userId, row.toCityId, "city_transfers", row.id, "update", { status: "pending" }, {
            status: "rejected", batchId: row.batchId,
          }, getClientIP(request), tx);
        }
        return { count: updated.count };
      }).catch((error: unknown) => {
        const message = (error as Error)?.message || "";
        if (message === "TRANSFER_NOT_PENDING") return { error: "Transfer is no longer pending", status: 409 };
        if (message === "SOURCE_DISTRIBUTION_MISSING" || message === "SOURCE_ALLOCATION_MISSING") {
          return { error: "Source stock allocation is missing; rejection was rolled back", status: 409 };
        }
        throw error;
      });
      if ("error" in result) return errorResponse("CONFLICT", result.error, result.status);
      return successResponse({ id, batchId: anchor.batchId, transferIds }, "Transfer rejected — source stock restored");
    }

    return errorResponse("VALIDATION_ERROR", "Action must be 'approve' or 'reject'");
  } catch (error) {
    console.error("City transfer action:", error);
    return serverError();
  }
});
