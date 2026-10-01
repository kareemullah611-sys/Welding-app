import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lots/:id/reopen - Undo lot completion
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = parseInt(context.params.id);
    const lot = await prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (lot.status !== "completed") return errorResponse("VALIDATION_ERROR", "Lot is not completed");

    // Block reopen if any overflow target lot is already completed
    const overflowCheck = await prisma.lotSettlementOverflow.findMany({
      where: { fromLotId: lotId },
      include: { toLot: { select: { lotNumber: true, status: true } } },
    });
    const completedDeps = overflowCheck.filter((ov: any) => ov.toLot?.status === "completed");
    if (completedDeps.length > 0) {
      const nums = completedDeps.map((ov: any) => ov.toLot.lotNumber).join(", ");
      return errorResponse("CONFLICT", `Cannot reopen — overflow was applied to completed lot(s): ${nums}. Reopen those first.`, 409);
    }

    await prisma.$transaction(async (tx) => {
      const overflows = await tx.lotSettlementOverflow.findMany({ where: { fromLotId: lotId } });
      for (const ov of overflows) {
        const legacyTransfers = await tx.hajiTransfer.findMany({
          where: {
            cityId: ov.cityId,
            lotId: ov.toLotId,
            currencyId: ov.currencyId,
            detail: { contains: `Overflow credit from completed lot ${lot.lotNumber}` },
          },
          select: { id: true },
        });
        for (const transfer of legacyTransfers) {
          await reverseJournalEntries(`HAJI-${transfer.id}`, user.userId, tx);
          await tx.hajiTransfer.delete({ where: { id: transfer.id } });
        }
      }
      await tx.lotSettlementOverflow.deleteMany({ where: { fromLotId: lotId } });
      await tx.lot.update({
        where: { id: lotId },
        data: { status: "ongoing", completedBy: null, completedAt: null, updatedAt: new Date() },
      });
      await createAuditLog(user.userId, null, "lots", lotId, "update", { status: "completed" }, { status: "ongoing", action: "reopen" }, getClientIP(request), tx);
    });

    return successResponse({ lotId, lotNumber: lot.lotNumber, status: "ongoing" }, "Lot reopened successfully");
  } catch (error) {
    console.error("Lot reopen error:", error);
    return serverError();
  }
});
