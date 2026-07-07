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
      if ((payment as any).chequeStatus === "used_for_liability") return errorResponse("VALIDATION_ERROR", "Cannot bounce a cheque that has already been used for a liability payment");
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
      include: {
        customer: { select: { id: true, name: true } },
        currency: { select: { id: true, code: true, symbol: true } },
        city: { include: { country: { select: { name: true } } } },
      },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Cannot edit cancelled payment");
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const nextCustomerId = data.customerId ?? payment.customerId;
    const nextCurrencyId = data.currencyId ?? payment.currencyId;
    const nextPaymentDate = data.paymentDate ? new Date(data.paymentDate) : payment.paymentDate;
    if (Number.isNaN(nextPaymentDate.getTime())) return errorResponse("VALIDATION_ERROR", "Invalid payment date");

    const nextPaymentMethod = data.paymentMethod ?? (payment as any).paymentMethod;
    const nextDestination = data.destination ?? (payment as any).destination;
    const nextAmount = data.amount ?? Number(payment.amount);
    const nextManualVoucherNo = data.manualVoucherNo !== undefined ? data.manualVoucherNo?.trim() || null : payment.manualVoucherNo;
    const nextChequeNumber = nextPaymentMethod === "cheque"
      ? (nextManualVoucherNo || data.chequeNumber?.trim() || (payment as any).chequeNumber || null)
      : (data.chequeNumber !== undefined ? data.chequeNumber?.trim() || null : (payment as any).chequeNumber);
    const nextChequeDueDate = nextPaymentMethod === "cheque"
      ? (data.chequeDueDate !== undefined
        ? (data.chequeDueDate ? new Date(data.chequeDueDate) : null)
        : ((payment as any).chequeDueDate ?? null))
      : null;
    const nextBankAccountId = ["bank_transfer", "online"].includes(nextPaymentMethod) && nextDestination === "our_account"
      ? (data.bankAccountId ?? (payment as any).bankAccountId ?? null)
      : null;
    const nextSuperAdminBankAccountId = ["bank_transfer", "online"].includes(nextPaymentMethod) && nextDestination === "haji"
      ? (data.superAdminBankAccountId ?? (payment as any).superAdminBankAccountId ?? null)
      : null;
    const nextChequeStatus = nextPaymentMethod === "cheque" && nextDestination === "our_account" ? "in_hand" : null;

    const customer = await prisma.customer.findFirst({
      where: { id: nextCustomerId, cityId: payment.cityId, isActive: true },
      select: { id: true, name: true },
    });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city");

    const cityCurrency = await prisma.cityCurrency.findFirst({
      where: { cityId: payment.cityId, currencyId: nextCurrencyId },
      include: { currency: true },
    });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");

    if (payment.city.country?.name === "Afghanistan" && nextPaymentMethod !== "cash") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan cities can record cash payments only");
    }

    const isBankLikePayment = nextPaymentMethod === "bank_transfer" || nextPaymentMethod === "online";
    if (isBankLikePayment && nextDestination === "our_account") {
      if (!nextBankAccountId) {
        return errorResponse("VALIDATION_ERROR", "Please select the city bank account that received this payment");
      }
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: nextBankAccountId } });
      if (!bankAccount || !bankAccount.isActive) return errorResponse("NOT_FOUND", "Selected city bank account not found", 404);
      if (bankAccount.cityId !== payment.cityId) return errorResponse("FORBIDDEN", "Selected bank account does not belong to your city", 403);
    }
    if (isBankLikePayment && nextDestination === "haji") {
      if (!nextSuperAdminBankAccountId) {
        return errorResponse("VALIDATION_ERROR", "Please select the super admin bank account that received this payment");
      }
      const superAdminAccount = await prisma.superAdminBankAccount.findUnique({ where: { id: nextSuperAdminBankAccountId } });
      if (!superAdminAccount || !superAdminAccount.isActive) return errorResponse("NOT_FOUND", "Selected super admin bank account not found", 404);
    }
    if (nextBankAccountId && nextSuperAdminBankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Select only one bank account");
    }
    if (nextDestination === "haji" && !isBankLikePayment) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Cash and cheque payments must go to office. Use Haji Transfers to send funds to super admin.",
      );
    }

    // Fix P1 (deposited cheque): block amount changes on cheques that have already been
    // deposited into a bank — the DEP-* journal entries would become wrong if we only
    // repost PAY-* without cascading the fix to the deposit journal.
    const isDepositedCheque = (payment as any).chequeStatus === "deposited_to_bank";
    const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(payment.amount);
    const accountingChanged =
      amountChanged ||
      nextCustomerId !== payment.customerId ||
      nextCurrencyId !== payment.currencyId ||
      nextPaymentDate.toISOString().split("T")[0] !== payment.paymentDate.toISOString().split("T")[0] ||
      nextPaymentMethod !== (payment as any).paymentMethod ||
      nextDestination !== (payment as any).destination ||
      nextBankAccountId !== ((payment as any).bankAccountId ?? null) ||
      nextSuperAdminBankAccountId !== ((payment as any).superAdminBankAccountId ?? null);
    const hasLockedChequeFlow = (payment as any).chequeStatus && (payment as any).chequeStatus !== "in_hand";
    if (accountingChanged && (isDepositedCheque || hasLockedChequeFlow)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Cannot change accounting fields for a cheque that has already moved. Cancel the related bank deposit, haji transfer, expense, or withdrawal first."
      );
    }

    const sym = payment.currency.symbol || payment.currency.code;
    const old = {
      date: payment.paymentDate.toISOString().split("T")[0],
      customer: payment.customer.name,
      detail: payment.detail,
      amount: `${sym} ${Number(payment.amount).toLocaleString("en-US")}`,
      method: (payment as any).paymentMethod,
      destination: (payment as any).destination,
      ...(payment.manualVoucherNo ? { reference: payment.manualVoucherNo } : {}),
      ...(payment.notes ? { notes: payment.notes } : {}),
    };

    const updated = await prisma.$transaction(async (tx) => {
      if (nextPaymentMethod === "cheque" && nextChequeNumber) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`city-payment-cheque:${payment.cityId}:${nextChequeNumber}`}))`;
        const duplicate = await tx.payment.findFirst({
          where: { cityId: payment.cityId, status: "active", paymentMethod: "cheque", chequeNumber: nextChequeNumber, id: { not: id } } as any,
        });
        if (duplicate) {
          throw Object.assign(
            new Error(`Cheque number "${nextChequeNumber}" already exists in an active payment for this city`),
            { code: "CHEQUE_DUPLICATE" }
          );
        }
      }

      const next = await tx.payment.update({
        where: { id },
        data: {
          customerId: nextCustomerId,
          paymentDate: nextPaymentDate,
          detail: data.detail || payment.detail,
          amount: nextAmount,
          currencyId: nextCurrencyId,
          manualVoucherNo: nextManualVoucherNo,
          paymentMethod: nextPaymentMethod,
          destination: nextDestination,
          chequeNumber: nextPaymentMethod === "cheque" ? nextChequeNumber : null,
          chequeBank: nextPaymentMethod === "cheque"
            ? (data.chequeBank !== undefined ? data.chequeBank?.trim() || null : (payment as any).chequeBank)
            : null,
          chequeDueDate: nextChequeDueDate,
          chequeStatus: nextChequeStatus as any,
          bankAccountId: nextBankAccountId,
          superAdminBankAccountId: nextSuperAdminBankAccountId,
          notes: data.notes !== undefined ? data.notes : payment.notes,
          updatedAt: new Date(),
        } as any,
      });

      if (accountingChanged) {
        await tx.journalEntry.deleteMany({
          where: {
            transactionId: {
              in: [`PAY-${id}`, `REV-PAY-${id}`],
            },
          },
        });
        const isCheque = nextPaymentMethod === "cheque" && nextDestination === "our_account";
        const journalFn = isCheque ? journalChequeReceived : journalPaymentReceived;
        await journalFn({
          id,
          customerId: nextCustomerId,
          cityId: payment.cityId,
          lotId: payment.lotId,
          amount: Number(nextAmount),
          currencyCode: cityCurrency.currency.code,
          paymentDate: nextPaymentDate,
          createdBy: user.userId,
          destination: nextDestination,
          superAdminBankAccountId: nextSuperAdminBankAccountId,
          bankAccountId: nextBankAccountId,
          paymentMethod: nextPaymentMethod,
        }, tx);
      }

      await createAuditLog(user.userId, payment.cityId, "payments", id, "update", old, {
        date: nextPaymentDate.toISOString().split("T")[0],
        customer: customer.name,
        detail: next.detail,
        amount: `${cityCurrency.currency.symbol || cityCurrency.currency.code} ${Number(next.amount).toLocaleString("en-US")}`,
        method: nextPaymentMethod,
        destination: nextDestination,
        ...(nextManualVoucherNo ? { reference: nextManualVoucherNo } : {}),
        ...(next.notes ? { notes: next.notes } : {}),
      }, getClientIP(request), tx);

      return next;
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    if ((error as any)?.code === "CHEQUE_DUPLICATE") {
      return errorResponse("VALIDATION_ERROR", (error as Error).message);
    }
    return serverError();
  }
});
