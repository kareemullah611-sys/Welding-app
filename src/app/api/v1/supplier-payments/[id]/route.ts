import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError, validationError } from "@/lib/api-response";
import { journalForeignFundingAssetAdjustments, reverseJournalEntries, journalSupplierPaid } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validateSupplierPaymentSettlement } from "@/lib/settlement-validation";
import {
  consumeIntermediaryUsdFifo,
  getLotFallbackUsdToPkrRate,
  reverseIntermediaryUsdCostUsages,
} from "@/lib/intermediary-usd-fifo";
import { resolveSupplierSettlementContext } from "@/lib/liability-settlement-context";
import { LiabilityFxValidationError, settlementJournalTransactionId } from "@/lib/realized-liability-fx";
import { getSupplierLotPaymentCapacity } from "@/lib/supplier-payment-capacity";
import {
  assertForeignLiabilitySettlementReconciles,
  foreignCurrencyOwnerKey,
  reverseForeignCurrencyMovements,
  settleForeignCurrencyOutflow,
  settleForeignCurrencyLiability,
} from "@/lib/foreign-currency-carrying-db";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

class SupplierPaymentCapacityError extends Error {}

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const existing = await prisma.supplierPayment.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return errorResponse("NOT_FOUND", "Supplier payment not found", 404);

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

    const settlement = await validateSupplierPaymentSettlement({
          amountUsd: nextAmountUsd,
          superAdminBankAccountId,
          superAdminCashAccountId,
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
      if (!lockedExisting || lockedExisting.deletedAt) throw Object.assign(new Error("Supplier payment no longer exists"), { code: "PAYMENT_CHANGED_RETRY" });
      if (lockedExisting.journalVersion !== existing.journalVersion) {
        throw Object.assign(new Error("Supplier payment changed while this edit was open"), { code: "PAYMENT_CHANGED_RETRY" });
      }
      if (lockedExisting.lotId) {
        const capacity = await getSupplierLotPaymentCapacity({
          supplierId: lockedExisting.supplierId,
          lotId: lockedExisting.lotId,
          excludePaymentId: id,
          db: tx,
        });
        const maximumAllowed = Math.max(capacity.outstandingUsd, Number(lockedExisting.amountUsd));
        if (nextAmountUsd > maximumAllowed + 0.001) {
          throw new SupplierPaymentCapacityError(
            `Payment exceeds this supplier's outstanding purchase amount for the lot. Available: USD ${maximumAllowed.toLocaleString("en-US")}`,
          );
        }
      }
      const reversedForeign = await reverseForeignCurrencyMovements(tx, { sourceType: "supplier_payment", sourceId: id, reversalDate: new Date(), createdBy: user.userId });
      for (const transactionId of reversedForeign.journalTransactionIds) await reverseJournalEntries(transactionId, user.userId, tx);
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
      const fundingAssetSettlement = settlement.settlementCurrency === "USD"
        ? await settleForeignCurrencyOutflow(tx, {
            sourceOwnerKey: intermediaryId
              ? foreignCurrencyOwnerKey.intermediary(intermediaryId)
              : superAdminCashAccountId
                ? foreignCurrencyOwnerKey.superAdminCash(superAdminCashAccountId)
                : superAdminBankAccountId
                  ? foreignCurrencyOwnerKey.superAdminBank(superAdminBankAccountId)
                  : foreignCurrencyOwnerKey.cityBank(bankAccountId!),
            currencyCode: "USD",
            amount: Number(journalPayment.amountUsd),
            sourceType: "supplier_payment",
            sourceId: id,
            settlementDate: journalPayment.paymentDate,
            settlementRate: {
              ratePkr: round2(actualSettlementPkr / Number(journalPayment.amountUsd)),
              rateType: "actual_supplier_settlement",
              provider: intermediaryId ? "INTERMEDIARY_USD_FIFO" : "DOCUMENTED_SETTLEMENT_RATE",
              reference: `supplier_payment:${id}`,
            },
            createdBy: user.userId,
          })
        : null;

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
      if (fundingAssetSettlement) {
        await journalForeignFundingAssetAdjustments({
          entityPrefix: "FXSUPASSET",
          entityType: "supplier_payment",
          entityId: id,
          date: journalPayment.paymentDate,
          createdBy: user.userId,
          bankAccountId,
          superAdminBankAccountId,
          superAdminCashAccountId,
          intermediaryId,
          movements: fundingAssetSettlement.movements,
        }, tx);
      }
      const liabilitySettlement = await settleForeignCurrencyLiability(tx, {
        sourceOwnerKey: foreignCurrencyOwnerKey.supplierPayable(existing.supplierId, existing.lotId),
        currencyCode: "USD",
        amount: Number(journalPayment.amountUsd),
        sourceType: "supplier_payment",
        sourceId: id,
        settlementDate: journalPayment.paymentDate,
        settlementRate: {
          ratePkr: round2(actualSettlementPkr / Number(journalPayment.amountUsd)),
          rateType: "actual_supplier_settlement",
          provider: intermediaryId ? "INTERMEDIARY_USD_FIFO" : "DOCUMENTED_SETTLEMENT_RATE",
          reference: `supplier_payment:${id}`,
        },
        journalTransactionId: settlementJournalTransactionId("SUPPPAY", id, journalPayment.journalVersion),
        createdBy: user.userId,
      });
      assertForeignLiabilitySettlementReconciles({
        expectedCarryingAmountPkr: fx.carryingAmountPkr,
        expectedSettlementAmountPkr: actualSettlementPkr,
        expectedRealizedFxPkr: fx.realizedFxPkr,
        actualCarryingAmountPkr: liabilitySettlement.carryingAmountPkr,
        actualSettlementAmountPkr: liabilitySettlement.settlementAmountPkr,
        actualRealizedFxPkr: liabilitySettlement.realizedFxPkr,
      });

      await createAuditLog(user.userId, null, "supplier_payments", id, "update",
        { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(payment.amountUsd) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    if (error instanceof SupplierPaymentCapacityError) return validationError(error.message);
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
    if (!existing || existing.deletedAt) return errorResponse("NOT_FOUND", "Supplier payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        `supplier-liability:${existing.supplierId}:${existing.lotId || "none"}`,
      );
      const lockedExisting = await tx.supplierPayment.findUnique({ where: { id } });
      if (!lockedExisting || lockedExisting.deletedAt) throw Object.assign(new Error("Supplier payment no longer exists"), { code: "PAYMENT_CHANGED_RETRY" });
      const reversedForeign = await reverseForeignCurrencyMovements(tx, { sourceType: "supplier_payment", sourceId: id, reversalDate: new Date(), createdBy: user.userId });
      for (const transactionId of reversedForeign.journalTransactionIds) await reverseJournalEntries(transactionId, user.userId, tx);
      await reverseJournalEntries(settlementJournalTransactionId("SUPPPAY", id, lockedExisting.journalVersion), user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ supplierPaymentId: id }, tx);
      await tx.supplierPayment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.userId } });
      await createAuditLog(user.userId, null, "supplier_payments", id, "delete",
        { amountUsd: Number(existing.amountUsd), supplierId: existing.supplierId }, undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
