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

      // Approve: update status and create godown allocation for receiver
      await prisma.cityTransfer.update({
        where: { id },
        data: { status: "approved", toGodownId, approvalNotes, approvedBy: user.userId, approvedAt: new Date() },
      });

      // Add stock to receiving godown (create allocation record)
      // Find or create lot city distribution for receiving city
      let lcd = await prisma.lotCityDistribution.findUnique({
        where: { lotId_cityId_productId: { lotId: transfer.lotId, cityId: transfer.toCityId, productId: transfer.productId } },
      });
      if (!lcd) {
        lcd = await prisma.lotCityDistribution.create({
          data: { lotId: transfer.lotId, cityId: transfer.toCityId, productId: transfer.productId, allocatedQty: Number(transfer.qty) },
        });
      } else {
        await prisma.lotCityDistribution.update({
          where: { id: lcd.id },
          data: { allocatedQty: { increment: Number(transfer.qty) } },
        });
      }

      // Create godown allocation for receiving city
      const existingAlloc = await prisma.lotCityGodownAllocation.findFirst({
        where: { lotCityDistributionId: lcd.id, godownId: toGodownId },
      });
      if (existingAlloc) {
        await prisma.lotCityGodownAllocation.update({
          where: { id: existingAlloc.id },
          data: { qty: { increment: Number(transfer.qty) } },
        });
      } else {
        await prisma.lotCityGodownAllocation.create({
          data: { lotCityDistributionId: lcd.id, godownId: toGodownId, productId: transfer.productId, qty: Number(transfer.qty) },
        });
      }

      // Deduct stock from sending city's godown allocation
      const sendingAlloc = await prisma.lotCityGodownAllocation.findFirst({
        where: { godownId: transfer.fromGodownId, lotCityDistribution: { lotId: transfer.lotId, cityId: transfer.fromCityId, productId: transfer.productId } },
      });
      if (sendingAlloc) {
        await prisma.lotCityGodownAllocation.update({
          where: { id: sendingAlloc.id },
          data: { qty: { decrement: Number(transfer.qty) } },
        });
      }
      // Also decrement sending city's distribution total
      await prisma.lotCityDistribution.updateMany({
        where: { lotId: transfer.lotId, cityId: transfer.fromCityId, productId: transfer.productId },
        data: { allocatedQty: { decrement: Number(transfer.qty) } },
      });

      await createAuditLog(user.userId, transfer.toCityId, "city_transfers", id, "update", { status: "pending" }, { status: "approved", toGodownId }, getClientIP(request));

      // Auto-activate any marked_short sales now covered by the incoming stock
      const activated = await autoActivateShortSales(toGodownId);
      return successResponse(
        { id, salesActivated: activated },
        activated > 0
          ? `Transfer approved — ${activated} short sale(s) auto-activated`
          : "Transfer approved — goods added to godown"
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
