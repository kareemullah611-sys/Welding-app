import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError, validationError } from "@/lib/api-response";
import { reverseJournalEntries, journalSupplierPaid } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validateSupplierPaymentSettlement } from "@/lib/settlement-validation";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const existing = await prisma.supplierPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Supplier payment not found", 404);

    const nextAmountUsd = body.amountUsd !== undefined ? Number(body.amountUsd) : Number(existing.amountUsd);
    if (!Number.isFinite(nextAmountUsd) || nextAmountUsd <= 0) {
      return validationError("Amount must be greater than 0");
    }

    const superAdminBankAccountId = existing.superAdminBankAccountId ?? null;
    const bankAccountId = existing.bankAccountId ?? null;
    const intermediaryId = existing.intermediaryId ?? null;

    const parsedExchangeRate =
      body.exchangeRate !== undefined
        ? (body.exchangeRate ? Number(body.exchangeRate) : null)
        : (existing.exchangeRate ? Number(existing.exchangeRate) : null);

    const needsBankRate = Boolean(superAdminBankAccountId || bankAccountId);
    if (needsBankRate && (!parsedExchangeRate || !Number.isFinite(parsedExchangeRate) || parsedExchangeRate <= 0)) {
      return validationError("Exchange rate is required for bank payments");
    }

    const settlement = await validateSupplierPaymentSettlement({
      amountUsd: nextAmountUsd,
      superAdminBankAccountId,
      bankAccountId,
      intermediaryId,
      exchangeRate: parsedExchangeRate,
    });
    if (!settlement.ok) {
      return errorResponse(settlement.code, settlement.message, settlement.status || 400);
    }

    const nextAmountLocal =
      settlement.settlementCurrency === "PKR" && settlement.amountPkr
        ? settlement.amountPkr
        : body.amountLocal !== undefined
          ? (body.amountLocal ? Number(body.amountLocal) : null)
          : (existing.amountLocal ? Number(existing.amountLocal) : null);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`SUPPPAY-${id}`, user.userId, tx);

      const payment = await tx.supplierPayment.update({
        where: { id },
        data: {
          amountUsd: nextAmountUsd,
          exchangeRate: parsedExchangeRate,
          amountLocal: nextAmountLocal,
          reference: body.reference ?? existing.reference,
          notes: body.notes ?? existing.notes,
        },
      });

      await journalSupplierPaid({
        id,
        supplierId: existing.supplierId,
        amountUsd: Number(payment.amountUsd),
        amountLocal: payment.amountLocal ? Number(payment.amountLocal) : null,
        paymentDate: payment.paymentDate,
        createdBy: user.userId,
        bankAccountId,
        superAdminBankAccountId,
        intermediaryId,
        settlementCurrencyCode: settlement.settlementCurrency === "PKR" ? "PKR" : null,
      }, tx);

      await createAuditLog(user.userId, null, "supplier_payments", id, "update",
        { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(payment.amountUsd) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    console.error("Update supplier payment error:", error);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.supplierPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Supplier payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`SUPPPAY-${id}`, user.userId, tx);
      await tx.supplierPayment.delete({ where: { id } });
      await createAuditLog(user.userId, null, "supplier_payments", id, "delete",
        { amountUsd: Number(existing.amountUsd), supplierId: existing.supplierId }, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
