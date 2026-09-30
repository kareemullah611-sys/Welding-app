import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries } from "@/lib/accounting";
import { reverseForeignCurrencyMovements } from "@/lib/foreign-currency-carrying-db";
import { reverseHajiTransferAccounting } from "@/lib/haji-transfer-accounting";

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
    if ((payment as any).chequeStatus === "used_for_liability") return errorResponse("VALIDATION_ERROR", "Cannot cancel a cheque that has already been used for a liability payment");
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

      // M1: cascade — a cancelled payment must not leave its linked haji transfer standing.
      const linkedTransfer = await tx.hajiTransfer.findUnique({
        where: { paymentId: id },
        include: { currency: { select: { code: true } } },
      });
      if (linkedTransfer) {
        await reverseHajiTransferAccounting(tx, linkedTransfer, user.userId, "delete");
        const transferChequeId = (linkedTransfer as any).chequePaymentId;
        if (transferChequeId && transferChequeId !== id) {
          await tx.payment.update({ where: { id: transferChequeId }, data: { chequeStatus: "in_hand" } as any });
        }
        await tx.hajiTransfer.delete({ where: { id: linkedTransfer.id } });
        await createAuditLog(user.userId, payment.cityId, "haji_transfers", linkedTransfer.id, "cancel", undefined, { viaPaymentId: id, reason: body.reason }, getClientIP(request), tx);
      }

      await reverseJournalEntries(`PAY-${id}`, user.userId, tx);
      const adjTxns = await tx.journalEntry.findMany({
        where: { transactionId: { startsWith: `ADJPAY-${id}-` } },
        select: { transactionId: true },
        distinct: ["transactionId"],
      });
      for (const adj of adjTxns) {
        await reverseJournalEntries(adj.transactionId, user.userId, tx);
      }
      const reversedFx = await reverseForeignCurrencyMovements(tx, {
        sourceType: "customer_payment",
        sourceId: id,
        reversalDate: new Date(),
        createdBy: user.userId,
      });
      for (const transactionId of reversedFx.journalTransactionIds) {
        await reverseJournalEntries(transactionId, user.userId, tx);
      }
    });

    return successResponse({ id, status: "cancelled" }, "Payment cancelled");
  } catch (error) {
    return serverError();
  }
});
