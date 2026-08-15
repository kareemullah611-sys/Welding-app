import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// POST /api/v1/personal-withdrawals/[id]/approve
// Super admin approval is status-only. The withdrawal itself remains the single
// source of truth for cash/bank deduction in treasury and balance reports.
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

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Concurrency-safe approval: only one approver can claim this withdrawal.
      const approved = await tx.personalWithdrawal.updateMany({
        where: { id, approvedAt: null },
        data: {
          approvedBy: user.userId,
          approvedAt: now,
        },
      });
      if (approved.count !== 1) {
        throw new Error("ALREADY_APPROVED");
      }

      await createAuditLog(user.userId, withdrawal.cityId, "personal_withdrawals", id, "update",
        { approvedBy: null }, { approvedBy: user.userId, approvedAt: now.toISOString() },
        getClientIP(request),
        tx
      );
    });

    return successResponse({ id, approvedAt: now.toISOString() }, "Withdrawal approved");
  } catch (error) {
    if ((error as any)?.message === "ALREADY_APPROVED") {
      return errorResponse("CONFLICT", "Already approved", 409);
    }
    console.error("Approve withdrawal error:", error);
    return serverError();
  }
});
