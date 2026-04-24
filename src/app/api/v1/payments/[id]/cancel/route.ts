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

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { customer: { select: { name: true } }, currency: { select: { code: true, symbol: true } } },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (payment.status === "cancelled") return errorResponse("VALIDATION_ERROR", "Already cancelled");
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    if ((payment as any).chequeStatus === "deposited_to_bank") return errorResponse("VALIDATION_ERROR", "Cannot cancel a cheque that has already been deposited to bank — use bounce instead");
    if ((payment as any).chequeStatus === "sent_to_haji") return errorResponse("VALIDATION_ERROR", "Cannot cancel a cheque that has been sent to haji — cancel the haji transfer first");
    if ((payment as any).chequeStatus === "used_for_expense") return errorResponse("VALIDATION_ERROR", "Cannot cancel a cheque that has already been used for an expense");
    if ((payment as any).chequeStatus === "used_for_withdrawal") return errorResponse("VALIDATION_ERROR", "Cannot cancel a cheque that has already been used for a withdrawal");

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: {
          status: "cancelled",
          chequeStatus: payment.paymentMethod === "cheque" ? null : payment.chequeStatus,
          cancellationReason: body.reason,
          cancelledAt: new Date(),
          cancelledBy: user.userId,
          updatedAt: new Date(),
        },
      });

      await createAuditLog(user.userId, payment.cityId, "payments", id, "cancel", {
        date: payment.paymentDate.toISOString().split("T")[0],
        customer: payment.customer.name,
        detail: payment.detail,
        amount: `${payment.currency.symbol || payment.currency.code} ${Number(payment.amount).toLocaleString("en-US")}`,
        ...(payment.destination ? { destination: payment.destination } : {}),
        ...(payment.notes ? { notes: payment.notes } : {}),
      }, { reason: body.reason }, getClientIP(request), tx);

      await reverseJournalEntries(`PAY-${id}`, user.userId, tx);
    });

    return successResponse({ id, status: "cancelled" }, "Payment cancelled");
  } catch (error) {
    return serverError();
  }
});
