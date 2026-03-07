import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lots/:id/reopen - Undo lot completion
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = parseInt(context.params.id);
    const lot = await prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (lot.status !== "completed") return errorResponse("VALIDATION_ERROR", "Lot is not completed");

    // Delete any overflow records FROM this lot
    const overflows = await prisma.lotSettlementOverflow.findMany({ where: { fromLotId: lotId } });
    for (const ov of overflows) {
      // Delete the auto-created haji transfer on the target lot
      await prisma.hajiTransfer.deleteMany({
        where: {
          lotId: ov.toLotId,
          detail: { contains: `Overflow credit from completed lot ${lot.lotNumber}` },
        },
      });
    }
    await prisma.lotSettlementOverflow.deleteMany({ where: { fromLotId: lotId } });

    // Reopen the lot
    await prisma.lot.update({
      where: { id: lotId },
      data: { status: "ongoing", completedBy: null, completedAt: null, updatedAt: new Date() },
    });

    await createAuditLog(user.userId, null, "lots", lotId, "update", { status: "completed" }, { status: "ongoing", action: "reopen" }, getClientIP(request));

    return successResponse({ lotId, lotNumber: lot.lotNumber, status: "ongoing" }, "Lot reopened successfully");
  } catch (error) {
    console.error("Lot reopen error:", error);
    return serverError();
  }
});
