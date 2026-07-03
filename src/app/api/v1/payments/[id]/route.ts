import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries, journalPaymentReceived, journalChequeReceived } from "@/lib/accounting";
import { getPaymentHajiAuditStateMap, isHajiAuditEligible } from "@/lib/payment-audit";
import { paymentActionSchema, updatePaymentSchema } from "@/lib/validations";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        customer: true,
        lot: { select: { id: true, lotNumber: true } },
        currency: true,
        creator: { select: { id: true, fullName: true } },
        bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
      },
    } as any) as any;
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    const hajiAuditStateById = await getPaymentHajiAuditStateMap([payment.id]);

    return successResponse({
      id: payment.id, paymentDate: payment.paymentDate.toISOString().split("T")[0],
      amount: Number(payment.amount), detail: payment.detail, notes: payment.notes,
      manualVoucherNo: payment.manualVoucherNo, paymentMethod: payment.paymentMethod,
      destination: payment.destination, status: payment.status,
      bankAccountId: (payment as any).bankAccountId ?? null,
      bankAccount: (payment as any).bankAccount ?? null,
      superAdminBankAccountId: (payment as any).superAdminBankAccountId ?? null,
      superAdminBankAccount: (payment as any).superAdminBankAccount ?? null,
      hajiAudit: isHajiAuditEligible(payment) ? (hajiAuditStateById[payment.id] || null) : null,
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
    const parsed = paymentActionSchema.safeParse(body);
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid payment action", 400, parsed.error.errors);
    const actionBody = parsed.data;

    if (actionBody.action === "set_haji_audit") {
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can confirm Haji payments", 403);
      if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Only active payments can be confirmed");
      if (!isHajiAuditEligible(payment)) {
        return errorResponse("VALIDATION_ERROR", "Only Haji-destination cash or bank payments can be audit-confirmed");
      }

      const confirmed = actionBody.confirmed;
      const stateById = await getPaymentHajiAuditStateMap([payment.id]);
      const current = stateById[payment.id] || null;
      if ((current?.confirmed || false) === confirmed) {
        return successResponse({
          confirmed,
          confirmedAt: current?.confirmedAt || null,
          confirmedBy: current?.confirmedBy || null,
        }, confirmed ? "Payment was already confirmed" : "Payment was already unconfirmed");
      }

      await createAuditLog(
        user.userId,
        payment.cityId,
        "payments",
        payment.id,
        "update",
        {
          hajiAuditConfirmed: current?.confirmed || false,
          hajiAuditConfirmedAt: current?.confirmedAt || null,
          hajiAuditConfirmedBy: current?.confirmedBy?.fullName || current?.confirmedBy?.username || null,
        },
        {
          hajiAuditConfirmed: confirmed,
          hajiAuditNote: confirmed ? "Super admin confirmed payment to Haji account" : "Super admin removed Haji payment confirmation",
        },
        getClientIP(request)
      );

      return successResponse({
        confirmed,
        confirmedAt: new Date().toISOString(),
        confirmedBy: { id: user.userId, fullName: user.username, username: user.username },
      }, confirmed ? "Haji payment confirmed" : "Haji payment confirmation removed");
    }

    if (actionBody.action === "bounce_cheque") {
      const payment = await prisma.payment.findUnique({ where: { id } });
      if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
      if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
      if ((payment as any).paymentMethod !== "cheque") return errorResponse("VALIDATION_ERROR", "Payment method is not cheque");
      if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Payment is not active");
      if ((payment as any).chequeStatus === "bounced") return errorResponse("VALIDATION_ERROR", "Cheque is already marked as bounced");
      if ((payment as any).chequeStatus === "sent_to_haji") return errorResponse("VALIDATION_ERROR", "Cannot bounce a cheque that has been sent to haji — cancel the haji transfer first");
      if ((payment as any).chequeStatus === "used_for_expense") return errorResponse("VALIDATION_ERROR", "Cannot bounce a cheque that has already been used for an expense");
      if ((payment as any).chequeStatus === "used_for_withdrawal") return errorResponse("VALIDATION_ERROR", "Cannot bounce a cheque that has already been used for a withdrawal");

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
    const parsed = updatePaymentSchema.safeParse(body);
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid payment update", 400, parsed.error.errors);
    const data = parsed.data;
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { customer: { select: { name: true } }, currency: { select: { code: true, symbol: true } } },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Cannot edit cancelled payment");
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    // Fix P1 (deposited cheque): block amount changes on cheques that have already been
    // deposited into a bank — the DEP-* journal entries would become wrong if we only
    // repost PAY-* without cascading the fix to the deposit journal.
    const isDepositedCheque = (payment as any).chequeStatus === "deposited_to_bank";
    const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(payment.amount);
    if (amountChanged && isDepositedCheque) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Cannot change the amount of a cheque that has already been deposited to a bank. Cancel the bank deposit first, then edit the payment."
      );
    }

    const sym = payment.currency.symbol || payment.currency.code;
    const old = {
      date: payment.paymentDate.toISOString().split("T")[0],
      customer: payment.customer.name,
      detail: payment.detail,
      amount: `${sym} ${Number(payment.amount).toLocaleString("en-US")}`,
      ...(payment.notes ? { notes: payment.notes } : {}),
    };

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.payment.update({
        where: { id },
        data: {
          detail: data.detail || payment.detail,
          amount: data.amount || payment.amount,
          notes: data.notes !== undefined ? data.notes : payment.notes,
          updatedAt: new Date(),
        },
      });

      if (amountChanged) {
        await tx.journalEntry.deleteMany({
          where: {
            transactionId: {
              in: [`PAY-${id}`, `REV-PAY-${id}`],
            },
          },
        });
        const isCheque = (payment as any).paymentMethod === "cheque" && (payment as any).destination === "our_account";
        const journalFn = isCheque ? journalChequeReceived : journalPaymentReceived;
        await journalFn({
          id,
          customerId: payment.customerId,
          cityId: payment.cityId,
          lotId: payment.lotId,
          amount: Number(next.amount),
          currencyCode: payment.currency.code,
          paymentDate: payment.paymentDate,
          createdBy: user.userId,
          destination: (payment as any).destination,
          superAdminBankAccountId: (payment as any).superAdminBankAccountId ?? null,
          bankAccountId: (payment as any).bankAccountId ?? null,
          paymentMethod: (payment as any).paymentMethod,
        }, tx);
      }

      await createAuditLog(user.userId, payment.cityId, "payments", id, "update", old, {
        detail: next.detail,
        amount: `${sym} ${Number(next.amount).toLocaleString("en-US")}`,
        ...(next.notes ? { notes: next.notes } : {}),
      }, getClientIP(request), tx);

      return next;
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    return serverError();
  }
});
