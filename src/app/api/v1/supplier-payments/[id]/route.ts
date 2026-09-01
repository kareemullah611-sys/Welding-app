import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError, validationError } from "@/lib/api-response";
import { reverseJournalEntries, journalSupplierPaid } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validateSupplierPaymentSettlement } from "@/lib/settlement-validation";
import {
  consumeIntermediaryUsdFifo,
  getLotFallbackUsdToPkrRate,
  reverseIntermediaryUsdCostUsages,
} from "@/lib/intermediary-usd-fifo";
import { resolveSupplierSettlementContext } from "@/lib/liability-settlement-context";
import { LiabilityFxValidationError, settlementJournalTransactionId } from "@/lib/realized-liability-fx";

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
    const superAdminCashAccountId = existing.superAdminCashAccountId ?? null;
    const bankAccountId = existing.bankAccountId ?? null;
    const intermediaryId = existing.intermediaryId ?? null;

    const parsedExchangeRate =
      body.exchangeRate !== undefined
        ? (body.exchangeRate ? Number(body.exchangeRate) : null)
        : (existing.exchangeRate ? Number(existing.exchangeRate) : null);

    const needsBankRate = Boolean(superAdminBankAccountId || superAdminCashAccountId || bankAccountId);
    if (needsBankRate && (!parsedExchangeRate || !Number.isFinite(parsedExchangeRate) || parsedExchangeRate <= 0)) {
      return validationError("Exchange rate is required for bank payments");
    }

    const settlement = superAdminCashAccountId
      ? { ok: true as const, settlementCurrency: "PKR" as const, amountPkr: round2(nextAmountUsd * Number(parsedExchangeRate)) }
      : await validateSupplierPaymentSettlement({
          amountUsd: nextAmountUsd,
          superAdminBankAccountId,
          bankAccountId,
          intermediaryId,
          exchangeRate: parsedExchangeRate,
          excludeSupplierPaymentId: id,
        });
    if (!settlement.ok) return errorResponse(settlement.code, settlement.message, settlement.status || 400);

    const nextAmountLocal =
      settlement.settlementCurrency === "PKR" && settlement.amountPkr
        ? settlement.amountPkr
        : body.amountLocal !== undefined
          ? (body.amountLocal ? Number(body.amountLocal) : null)
          : (existing.amountLocal ? Number(existing.amountLocal) : null);

    const fallbackUsdToPkrRate = intermediaryId
      ? await getLotFallbackUsdToPkrRate(existing.lotId || null)
      : null;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        `supplier-liability:${existing.supplierId}:${existing.lotId || "none"}`,
      );
      const lockedExisting = await tx.supplierPayment.findUnique({ where: { id } });
      if (!lockedExisting) throw Object.assign(new Error("Supplier payment no longer exists"), { code: "PAYMENT_CHANGED_RETRY" });
      if (lockedExisting.journalVersion !== existing.journalVersion) {
        throw Object.assign(new Error("Supplier payment changed while this edit was open"), { code: "PAYMENT_CHANGED_RETRY" });
      }
      await reverseJournalEntries(settlementJournalTransactionId("SUPPPAY", id, lockedExisting.journalVersion), user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ supplierPaymentId: id }, tx);

      const payment = await tx.supplierPayment.update({
        where: { id },
        data: {
          amountUsd: nextAmountUsd,
          exchangeRate: parsedExchangeRate,
          amountLocal: nextAmountLocal,
          reference: body.reference ?? existing.reference,
          notes: body.notes ?? existing.notes,
          journalVersion: { increment: 1 },
        },
      });

      let journalAmountLocal = payment.amountLocal ? Number(payment.amountLocal) : null;
      let journalPayment = payment;
      if (intermediaryId) {
        const fifo = await consumeIntermediaryUsdFifo({
          intermediaryId,
          amountUsd: Number(payment.amountUsd),
          paymentDate: payment.paymentDate,
          supplierPaymentId: id,
          fallbackRatePkr: fallbackUsdToPkrRate,
        }, tx);
        journalPayment = await tx.supplierPayment.update({
          where: { id },
          data: {
            amountLocal: fifo.amountPkr,
            exchangeRate: fifo.effectiveRatePkr,
          },
        });
        journalAmountLocal = fifo.amountPkr;
      }

      const actualSettlementPkr = intermediaryId
        ? Number(journalAmountLocal || 0)
        : parsedExchangeRate && parsedExchangeRate > 0
          ? round2(Number(journalPayment.amountUsd) * parsedExchangeRate)
          : 0;
      if (actualSettlementPkr <= 0) {
        throw new LiabilityFxValidationError("Actual PKR settlement value is required to recognize supplier FX; provide the documented settlement rate.");
      }
      const fx = await resolveSupplierSettlementContext({
        supplierId: existing.supplierId,
        lotId: existing.lotId,
        paymentId: id,
        settlementAmountUsd: Number(journalPayment.amountUsd),
        actualSettlementPkr,
      }, tx);
      journalPayment = await tx.supplierPayment.update({
        where: { id },
        data: {
          amountLocal: actualSettlementPkr,
          carryingRatePkr: fx.carryingRatePkr,
          carryingAmountPkr: fx.carryingAmountPkr,
          realizedFxPkr: fx.realizedFxPkr,
          fxPoolDate: new Date(fx.originalPoolDate),
        },
      });

      await journalSupplierPaid({
        id,
        supplierId: existing.supplierId,
        amountUsd: Number(journalPayment.amountUsd),
        carryingAmountPkr: fx.carryingAmountPkr,
        actualSettlementPkr,
        journalVersion: journalPayment.journalVersion,
        paymentDate: journalPayment.paymentDate,
        createdBy: user.userId,
        bankAccountId,
        superAdminBankAccountId,
        superAdminCashAccountId,
        intermediaryId,
      }, tx);

      await createAuditLog(user.userId, null, "supplier_payments", id, "update",
        { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(payment.amountUsd) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    if (error instanceof LiabilityFxValidationError) return errorResponse("FX_BASIS_REQUIRED", error.message, 400);
    if ((error as any)?.code === "PAYMENT_CHANGED_RETRY") return errorResponse("PAYMENT_CHANGED_RETRY", error instanceof Error ? error.message : "Payment changed; reload and retry", 409);
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
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        `supplier-liability:${existing.supplierId}:${existing.lotId || "none"}`,
      );
      const lockedExisting = await tx.supplierPayment.findUnique({ where: { id } });
      if (!lockedExisting) throw Object.assign(new Error("Supplier payment no longer exists"), { code: "PAYMENT_CHANGED_RETRY" });
      await reverseJournalEntries(settlementJournalTransactionId("SUPPPAY", id, lockedExisting.journalVersion), user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ supplierPaymentId: id }, tx);
      await tx.supplierPayment.delete({ where: { id } });
      await createAuditLog(user.userId, null, "supplier_payments", id, "delete",
        { amountUsd: Number(existing.amountUsd), supplierId: existing.supplierId }, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
