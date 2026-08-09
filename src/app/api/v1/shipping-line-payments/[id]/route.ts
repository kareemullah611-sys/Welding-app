import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import {
  consumeIntermediaryUsdFifo,
  getLotFallbackUsdToPkrRate,
  reverseIntermediaryUsdCostUsages,
} from "@/lib/intermediary-usd-fifo";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    const existing = await prisma.shippingLinePayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    const source = await validatePaymentSource({
      bankAccountId: body.bankAccountId !== undefined ? body.bankAccountId : existing.bankAccountId,
      intermediaryId: body.intermediaryId !== undefined ? body.intermediaryId : existing.intermediaryId,
      requireSelection: true,
    });
    if (!source.ok) return errorResponse(source.code, source.message, source.status);

    const amountUsd = body.amountUsd !== undefined ? Number(body.amountUsd) : Number(existing.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return errorResponse("VALIDATION_ERROR", "Amount must be greater than 0");

    const exchangeRate = body.exchangeRate !== undefined
      ? (body.exchangeRate ? Number(body.exchangeRate) : null)
      : (existing.exchangeRate ? Number(existing.exchangeRate) : null);
    if (exchangeRate !== null && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
      return errorResponse("VALIDATION_ERROR", "Exchange rate must be greater than 0");
    }
    if (source.intermediaryId) {
      const balances = await getIntermediaryBalances(source.intermediaryId, { excludeShippingLinePaymentId: id });
      const availableUsd = Number(balances.USD || 0);
      if (amountUsd > availableUsd + 0.001) {
        return errorResponse("INSUFFICIENT_FUNDS", `Insufficient intermediary USD balance. Available: $${availableUsd.toLocaleString("en-US")}`, 400);
      }
    }

    const fallbackUsdToPkrRate = source.intermediaryId
      ? await getLotFallbackUsdToPkrRate(existing.lotId || null)
      : null;

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`SLPAY-${id}`, user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ shippingLinePaymentId: id }, tx);
      const updated = await tx.shippingLinePayment.update({
        where: { id },
        data: {
          amountUsd,
          exchangeRate,
          amountPkr: exchangeRate ? Math.round(amountUsd * exchangeRate * 100) / 100 : null,
          bankAccountId: source.bankAccountId,
          intermediaryId: source.intermediaryId,
          reference: body.reference !== undefined ? body.reference || null : existing.reference,
          notes: body.notes !== undefined ? body.notes || null : existing.notes,
        },
      });
      let journalPayment = updated;
      let amountLocal = updated.amountPkr ? Number(updated.amountPkr) : null;
      let settlementCurrencyCode = updated.amountPkr ? "PKR" : null;
      if (source.intermediaryId) {
        const fifo = await consumeIntermediaryUsdFifo({
          intermediaryId: source.intermediaryId,
          amountUsd: Number(updated.amountUsd),
          paymentDate: updated.paymentDate,
          shippingLinePaymentId: id,
          fallbackRatePkr: fallbackUsdToPkrRate,
        }, tx);
        journalPayment = await tx.shippingLinePayment.update({
          where: { id },
          data: {
            amountPkr: fifo.amountPkr,
            exchangeRate: fifo.effectiveRatePkr,
          },
        });
        amountLocal = fifo.amountPkr;
        settlementCurrencyCode = "PKR";
      }
      await journalShippingLinePayment({
        id,
        shippingLineId: existing.shippingLineId,
        amountUsd: Number(journalPayment.amountUsd),
        paymentDate: journalPayment.paymentDate,
        createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
        amountLocal,
        settlementCurrencyCode,
      }, tx);
      await createAuditLog(user.userId, null, "shipping_line_payments", id, "update",
        { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(updated.amountUsd) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.shippingLinePayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`SLPAY-${id}`, user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ shippingLinePaymentId: id }, tx);
      await tx.shippingLinePayment.delete({ where: { id } });
      await createAuditLog(user.userId, null, "shipping_line_payments", id, "delete",
        { amountUsd: Number(existing.amountUsd), shippingLineId: existing.shippingLineId }, undefined, getClientIP(request as any), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
