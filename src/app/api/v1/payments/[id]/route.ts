import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries, journalPaymentReceived, journalChequeReceived } from "@/lib/accounting";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { customer: true, lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    return successResponse({
      id: payment.id, paymentDate: payment.paymentDate.toISOString().split("T")[0],
      amount: Number(payment.amount), detail: payment.detail, notes: payment.notes,
      manualVoucherNo: payment.manualVoucherNo, paymentMethod: payment.paymentMethod,
      destination: payment.destination, status: payment.status,
      customer: { id: payment.customer.id, name: payment.customer.name },
      lot: payment.lot, currency: { id: payment.currency.id, code: payment.currency.code, symbol: payment.currency.symbol },
      createdBy: payment.creator,
    });
  } catch (error) {
    return serverError();
  }
});

export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    if (body.action === "bounce_cheque") {
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
      if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
      if ((payment as any).paymentMethod !== "cheque") return errorResponse("VALIDATION_ERROR", "Payment method is not cheque");
      if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Payment is not active");
      if ((payment as any).chequeStatus === "bounced") return errorResponse("VALIDATION_ERROR", "Cheque is already marked as bounced");
      if ((payment as any).chequeStatus === "sent_to_haji") return errorResponse("VALIDATION_ERROR", "Cannot bounce a cheque that has been sent to haji — cancel the haji transfer first");

      await prisma.payment.update({
        where: { id },
        data: {
          chequeStatus: "bounced",
          status: "cancelled",
          cancellationReason: "Cheque bounced",
          cancelledAt: new Date(),
          cancelledBy: user.userId,
        } as any,
      });

      // Reverse the cheque receipt entry (PAY-{id})
      try { await reverseJournalEntries(`PAY-${id}`, user.userId); } catch (je) { console.error("Journal reversal error (bounce PAY):", je); }

      // If the cheque was already deposited, also reverse that deposit leg
      const bankDepositId = (payment as any).bankDepositId;
      if (bankDepositId) {
        try { await reverseJournalEntries(`DEP-${bankDepositId}-PAY-${id}`, user.userId); } catch (je) { console.error("Journal reversal error (bounce DEP):", je); }
      }

      await createAuditLog(user.userId, payment.cityId, "payments", id, "update",
        { chequeStatus: (payment as any).chequeStatus, status: payment.status },
        { chequeStatus: "bounced", status: "cancelled", cancellationReason: "Cheque bounced" },
        getClientIP(request)
      );

      return successResponse({ success: true }, "Cheque marked as bounced. Please create a new payment for this customer.");
    }

    return errorResponse("VALIDATION_ERROR", "Unknown action");
  } catch (error) {
    return serverError();
  }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { customer: { select: { name: true } }, currency: { select: { code: true, symbol: true } } },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Cannot edit cancelled payment");
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const sym = payment.currency.symbol || payment.currency.code;
    const old = {
      date: payment.paymentDate.toISOString().split("T")[0],
      customer: payment.customer.name,
      detail: payment.detail,
      amount: `${sym} ${Number(payment.amount).toLocaleString("en-US")}`,
      ...(payment.notes ? { notes: payment.notes } : {}),
    };
    const amountChanged = body.amount !== undefined && Number(body.amount) !== Number(payment.amount);

    const updated = await prisma.payment.update({
      where: { id },
      data: {
        detail: body.detail || payment.detail,
        amount: body.amount || payment.amount,
        notes: body.notes !== undefined ? body.notes : payment.notes,
        updatedAt: new Date(),
      },
    });

    // If amount changed, reverse old journal and create new one with updated amount
    if (amountChanged) {
      try {
        await reverseJournalEntries(`PAY-${id}`, user.userId);
        const isCheque = (payment as any).paymentMethod === "cheque" && (payment as any).destination === "our_account";
        const journalFn = isCheque ? journalChequeReceived : journalPaymentReceived;
        await journalFn({
          id, customerId: payment.customerId, cityId: payment.cityId, lotId: payment.lotId,
          amount: Number(updated.amount), currencyCode: payment.currency.code,
          paymentDate: payment.paymentDate, createdBy: user.userId,
        });
      } catch (je) { console.error("Journal re-entry error (payment edit):", je); }
    }

    await createAuditLog(user.userId, payment.cityId, "payments", id, "update", old, {
      detail: updated.detail,
      amount: `${sym} ${Number(updated.amount).toLocaleString("en-US")}`,
      ...(updated.notes ? { notes: updated.notes } : {}),
    }, getClientIP(request));
    return successResponse({ id }, "Payment updated");
  } catch (error) {
    return serverError();
  }
});
