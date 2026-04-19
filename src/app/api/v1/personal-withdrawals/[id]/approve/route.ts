import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// POST /api/v1/personal-withdrawals/[id]/approve
// Super admin approves a withdrawal → auto-creates a HajiTransfer (administrative link only).
// IMPORTANT: The WDRAW-* journal created at withdrawal creation already records the cash
// outflow (DR Owner Withdrawals / CR Cash). Calling journalHajiTransfer here would credit
// cash a second time for the same event. The hajiTransfer is purely a management record —
// no additional journal is created.
export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can approve withdrawals", 403);
    }

    const id = parseInt(context.params.id);
    const withdrawal = await prisma.personalWithdrawal.findUnique({
      where: { id },
      include: { currency: true },
    });

    if (!withdrawal) return errorResponse("NOT_FOUND", "Withdrawal not found", 404);
    if (withdrawal.approvedAt) return errorResponse("CONFLICT", "Already approved", 409);

    // Find the FIFO ongoing lot for this city
    const city = await prisma.city.findUnique({ where: { id: withdrawal.cityId }, select: { countryId: true } });
    if (!city) return errorResponse("NOT_FOUND", "City not found", 404);

    const lot = await prisma.lot.findFirst({
      where: {
        countryId: city.countryId,
        status: "ongoing",
        lotCityDistributions: { some: { cityId: withdrawal.cityId } },
      },
      orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "No ongoing lot found for this city");

    const detail = withdrawal.withdrawnBy
      ? `Withdrawal approved: ${withdrawal.withdrawnBy} — ${withdrawal.detail}`
      : `Withdrawal approved: ${withdrawal.detail}`;

    const now = new Date();
    const hajiTransfer = await prisma.$transaction(async (tx) => {
      // Create HajiTransfer as an administrative link — no journal fired here.
      // The WDRAW-{withdrawalId} journal already captured cash leaving (DR Owner Withdrawals / CR Cash).
      // Creating another HAJI journal would double-credit cash for the same physical event.
      const createdTransfer = await tx.hajiTransfer.create({
        data: {
          cityId: withdrawal.cityId,
          lotId: lot.id,
          transferDate: now,
          amount: withdrawal.amount,
          currencyId: withdrawal.currencyId,
          detail,
          transferType: (withdrawal as any).sourceType === "cheque" ? "direct" : "from_in_hand",
          sourceType: (withdrawal as any).sourceType === "cheque" ? "cheque" : "cash_office",
          ...(withdrawal as any).chequePaymentId ? { chequePaymentId: (withdrawal as any).chequePaymentId } : {},
          notes: withdrawal.notes,
          createdBy: user.userId,
        },
      });

      // Concurrency-safe approval: only one approver can claim this withdrawal.
      const approved = await tx.personalWithdrawal.updateMany({
        where: { id, approvedAt: null },
        data: {
          approvedBy: user.userId,
          approvedAt: now,
          hajiTransferId: createdTransfer.id,
        },
      });
      if (approved.count !== 1) {
        throw new Error("ALREADY_APPROVED");
      }

      await createAuditLog(user.userId, withdrawal.cityId, "personal_withdrawals", id, "update",
        { approvedBy: null }, { approvedBy: user.userId, hajiTransferId: createdTransfer.id },
        getClientIP(request),
        tx
      );
      return createdTransfer;
    });

    return successResponse({ hajiTransferId: hajiTransfer.id }, "Withdrawal approved and haji transfer created");
  } catch (error) {
    if ((error as any)?.message === "ALREADY_APPROVED") {
      return errorResponse("CONFLICT", "Already approved", 409);
    }
    console.error("Approve withdrawal error:", error);
    return serverError();
  }
});
