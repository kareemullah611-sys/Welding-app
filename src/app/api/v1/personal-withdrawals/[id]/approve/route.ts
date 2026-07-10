import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalWithdrawal } from "@/lib/accounting";

// POST /api/v1/personal-withdrawals/[id]/approve
// Super admin approves a withdrawal → posts the WDRAW journal AND auto-creates a
// HajiTransfer (administrative link only).
//
// Fix C7: the WDRAW-* journal is now posted here at approval time, NOT at withdrawal
// creation. Previously it was posted at create-time, which meant pending (un-approved)
// withdrawals distorted treasury and bank-balance reports.
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
      // Create HajiTransfer as an administrative link — no HAJI journal fired here.
      // The WDRAW-{withdrawalId} journal (posted below) captures cash leaving.
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

      // Fix C7: post the WDRAW journal now that the withdrawal is approved.
      await journalWithdrawal({
        id: withdrawal.id,
        cityId: withdrawal.cityId,
        amount: Number(withdrawal.amount),
        currencyCode: withdrawal.currency.code,
        date: now,
        createdBy: user.userId,
        sourceType: (withdrawal as any).sourceType ?? "cash_office",
        bankAccountId: (withdrawal as any).bankAccountId ?? null,
      }, tx);

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
