import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, comparePassword } from "@/lib/auth";

// DELETE /api/v1/payments/:id/hard-delete
// Super admin only — permanently removes a payment record from the database.
// Requires the super admin to supply their current password as 2FA confirmation.
export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can permanently delete records", 403);

    const id = parseInt(context.params.id);
    const body = await request.json();
    if (!body.password) return validationError("Password confirmation is required");

    // 2FA: verify super admin password
    const admin = await prisma.user.findUnique({ where: { id: user.userId } });
    if (!admin) return errorResponse("NOT_FOUND", "Admin user not found", 404);
    const valid = await comparePassword(body.password, admin.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Incorrect password", 401);

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.journalEntry.deleteMany({ where: { transactionId: `PAY-${id}` } });
      await tx.payment.delete({ where: { id } });
    });

    await createAuditLog(user.userId, payment.cityId, "payments", id, "hard_delete", { amount: payment.amount }, undefined, getClientIP(request));
    return successResponse({ id }, "Payment permanently deleted");
  } catch (error) {
    console.error("Hard delete payment error:", error);
    return serverError();
  }
});
