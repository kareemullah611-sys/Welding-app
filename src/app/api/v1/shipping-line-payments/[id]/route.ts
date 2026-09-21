import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { journalForeignFundingAssetAdjustments, reverseJournalEntries, journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";
import {
  consumeIntermediaryUsdFifo,
  getLotFallbackUsdToPkrRate,
  reverseIntermediaryUsdCostUsages,
} from "@/lib/intermediary-usd-fifo";
import { resolveShippingSettlementContext } from "@/lib/liability-settlement-context";
import { LiabilityFxValidationError, settlementJournalTransactionId } from "@/lib/realized-liability-fx";
import {
  assertForeignLiabilitySettlementReconciles,
  foreignCurrencyOwnerKey,
  reverseForeignCurrencyMovements,
  settleForeignCurrencyOutflow,
  settleForeignCurrencyLiability,
} from "@/lib/foreign-currency-carrying-db";

const round2 = (value: number) => Math.round(value * 100) / 100;

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    const existing = await prisma.shippingLinePayment.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return errorResponse("NOT_FOUND", "Payment not found", 404);

    const source = await validatePaymentSource({
      bankAccountId: body.bankAccountId !== undefined ? body.bankAccountId : existing.bankAccountId,
      superAdminBankAccountId: body.superAdminBankAccountId !== undefined ? body.superAdminBankAccountId : existing.superAdminBankAccountId,
      superAdminCashAccountId: body.superAdminCashAccountId !== undefined ? body.superAdminCashAccountId : existing.superAdminCashAccountId,
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
    const fallbackUsdToPkrRate = source.intermediaryId
      ? await getLotFallbackUsdToPkrRate(existing.lotId || null)
      : null;
    const settlementCurrency = source.intermediaryId
      ? "USD"
      : source.superAdminBankAccountId || source.superAdminCashAccountId
        ? String((await prisma.superAdminBankAccount.findUnique({
            where: { id: (source.superAdminBankAccountId || source.superAdminCashAccountId)! },
            include: { currency: { select: { code: true } } },
          }))?.currency.code || "").toUpperCase()
        : "PKR";

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        `shipping-liability:${existing.shippingLineId}:${existing.lotId || "none"}`,
      );
      const lockedExisting = await tx.shippingLinePayment.findUnique({ where: { id } });
      if (!lockedExisting) throw Object.assign(new Error("Shipping payment no longer exists"), { code: "PAYMENT_CHANGED_RETRY" });
      if (lockedExisting.journalVersion !== existing.journalVersion) {
        throw Object.assign(new Error("Shipping payment changed while this edit was open"), { code: "PAYMENT_CHANGED_RETRY" });
      }
      const reversedForeign = await reverseForeignCurrencyMovements(tx, { sourceType: "shipping_line_payment", sourceId: id, reversalDate: new Date(), createdBy: user.userId });
      for (const transactionId of reversedForeign.journalTransactionIds) await reverseJournalEntries(transactionId, user.userId, tx);
      await reverseJournalEntries(settlementJournalTransactionId("SLPAY", id, lockedExisting.journalVersion), user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ shippingLinePaymentId: id }, tx);
      const updated = await tx.shippingLinePayment.update({
        where: { id },
        data: {
          amountUsd,
          exchangeRate,
          amountPkr: exchangeRate ? Math.round(amountUsd * exchangeRate * 100) / 100 : null,
          bankAccountId: source.bankAccountId,
          superAdminBankAccountId: source.superAdminBankAccountId,
          superAdminCashAccountId: source.superAdminCashAccountId,
          intermediaryId: source.intermediaryId,
          reference: body.reference !== undefined ? body.reference || null : existing.reference,
          notes: body.notes !== undefined ? body.notes || null : existing.notes,
          journalVersion: { increment: 1 },
        },
      });
      let journalPayment = updated;
      let amountLocal = updated.amountPkr ? Number(updated.amountPkr) : null;
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
      }
      const actualSettlementPkr = source.intermediaryId
        ? Number(amountLocal || 0)
        : Number(exchangeRate || 0) > 0
          ? Math.round(Number(journalPayment.amountUsd) * Number(exchangeRate) * 100) / 100
          : 0;
      if (actualSettlementPkr <= 0) {
        throw new LiabilityFxValidationError("Actual PKR settlement value is required to recognize shipping FX; provide the documented settlement rate.");
      }
      const fx = await resolveShippingSettlementContext({
        shippingLineId: existing.shippingLineId,
        lotId: existing.lotId,
        paymentId: id,
        settlementAmountUsd: Number(journalPayment.amountUsd),
        actualSettlementPkr,
      }, tx);
      journalPayment = await tx.shippingLinePayment.update({
        where: { id },
        data: {
          amountPkr: actualSettlementPkr,
          carryingRatePkr: fx.carryingRatePkr,
          carryingAmountPkr: fx.carryingAmountPkr,
          realizedFxPkr: fx.realizedFxPkr,
          fxPoolDate: new Date(fx.originalPoolDate),
        },
      });
      const fundingAssetSettlement = settlementCurrency === "USD"
        ? await settleForeignCurrencyOutflow(tx, {
            sourceOwnerKey: source.intermediaryId
              ? foreignCurrencyOwnerKey.intermediary(source.intermediaryId)
              : source.superAdminCashAccountId
                ? foreignCurrencyOwnerKey.superAdminCash(source.superAdminCashAccountId)
                : source.superAdminBankAccountId
                  ? foreignCurrencyOwnerKey.superAdminBank(source.superAdminBankAccountId)
                  : foreignCurrencyOwnerKey.cityBank(source.bankAccountId!),
            currencyCode: "USD",
            amount: Number(journalPayment.amountUsd),
            sourceType: "shipping_line_payment",
            sourceId: id,
            settlementDate: journalPayment.paymentDate,
            settlementRate: {
              ratePkr: round2(actualSettlementPkr / Number(journalPayment.amountUsd)),
              rateType: "actual_shipping_settlement",
              provider: source.intermediaryId ? "INTERMEDIARY_USD_FIFO" : "DOCUMENTED_SETTLEMENT_RATE",
              reference: `shipping_line_payment:${id}`,
            },
            createdBy: user.userId,
          })
        : null;
      await journalShippingLinePayment({
        id,
        shippingLineId: existing.shippingLineId,
        amountUsd: Number(journalPayment.amountUsd),
        paymentDate: journalPayment.paymentDate,
        createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        superAdminBankAccountId: source.superAdminBankAccountId,
        intermediaryId: source.intermediaryId,
        superAdminCashAccountId: source.superAdminCashAccountId,
        carryingAmountPkr: fx.carryingAmountPkr,
        actualSettlementPkr,
        journalVersion: journalPayment.journalVersion,
      }, tx);
      if (fundingAssetSettlement) {
        await journalForeignFundingAssetAdjustments({
          entityPrefix: "FXSHIPASSET",
          entityType: "shipping_line_payment",
          entityId: id,
          date: journalPayment.paymentDate,
          createdBy: user.userId,
          bankAccountId: source.bankAccountId,
          superAdminBankAccountId: source.superAdminBankAccountId,
          superAdminCashAccountId: source.superAdminCashAccountId,
          intermediaryId: source.intermediaryId,
          movements: fundingAssetSettlement.movements,
        }, tx);
      }
      const liabilitySettlement = await settleForeignCurrencyLiability(tx, {
        sourceOwnerKey: foreignCurrencyOwnerKey.shippingPayable(existing.shippingLineId, existing.lotId),
        currencyCode: "USD",
        amount: Number(journalPayment.amountUsd),
        sourceType: "shipping_line_payment",
        sourceId: id,
        settlementDate: journalPayment.paymentDate,
        settlementRate: {
          ratePkr: round2(actualSettlementPkr / Number(journalPayment.amountUsd)),
          rateType: "actual_shipping_settlement",
          provider: source.intermediaryId ? "INTERMEDIARY_USD_FIFO" : "DOCUMENTED_SETTLEMENT_RATE",
          reference: `shipping_line_payment:${id}`,
        },
        journalTransactionId: settlementJournalTransactionId("SLPAY", id, journalPayment.journalVersion),
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
      await createAuditLog(user.userId, null, "shipping_line_payments", id, "update",
        { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(updated.amountUsd) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    if (error instanceof LiabilityFxValidationError) return errorResponse("FX_BASIS_REQUIRED", error.message, 400);
    if ((error as any)?.code === "PAYMENT_CHANGED_RETRY") return errorResponse("PAYMENT_CHANGED_RETRY", error instanceof Error ? error.message : "Payment changed; reload and retry", 409);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.shippingLinePayment.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return errorResponse("NOT_FOUND", "Payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        `shipping-liability:${existing.shippingLineId}:${existing.lotId || "none"}`,
      );
      const lockedExisting = await tx.shippingLinePayment.findUnique({ where: { id } });
      if (!lockedExisting || lockedExisting.deletedAt) throw Object.assign(new Error("Shipping payment no longer exists"), { code: "PAYMENT_CHANGED_RETRY" });
      const reversedForeign = await reverseForeignCurrencyMovements(tx, { sourceType: "shipping_line_payment", sourceId: id, reversalDate: new Date(), createdBy: user.userId });
      for (const transactionId of reversedForeign.journalTransactionIds) await reverseJournalEntries(transactionId, user.userId, tx);
      await reverseJournalEntries(settlementJournalTransactionId("SLPAY", id, lockedExisting.journalVersion), user.userId, tx);
      await reverseIntermediaryUsdCostUsages({ shippingLinePaymentId: id }, tx);
      await tx.shippingLinePayment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.userId } });
      await createAuditLog(user.userId, null, "shipping_line_payments", id, "delete",
        { amountUsd: Number(existing.amountUsd), shippingLineId: existing.shippingLineId }, undefined, getClientIP(request as any), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
