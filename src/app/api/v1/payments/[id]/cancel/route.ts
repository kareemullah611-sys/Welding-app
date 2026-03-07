import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries } from "@/lib/accounting";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    if (!body.reason) return validationError("Cancellation reason is required");

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (payment.status === "cancelled") return errorResponse("VALIDATION_ERROR", "Already cancelled");
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    await prisma.payment.update({
      where: { id },
      data: { status: "cancelled", cancellationReason: body.reason, cancelledAt: new Date(), cancelledBy: user.userId, updatedAt: new Date() },
    });

    await createAuditLog(user.userId, payment.cityId, "payments", id, "cancel", { status: "active" }, { status: "cancelled", reason: body.reason }, getClientIP(request));

    // Reverse journal entries so accounting books stay balanced
    try { await reverseJournalEntries(`PAY-${id}`, user.userId); } catch (je) { console.error("Journal reversal error (payment cancel):", je); }

    return successResponse({ id, status: "cancelled" }, "Payment cancelled");
  } catch (error) {
    return serverError();
  }
});
