import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { journalForeignFundingAssetAdjustments, journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { consumeIntermediaryUsdFifo, getLotFallbackUsdToPkrRate } from "@/lib/intermediary-usd-fifo";
import { resolveShippingSettlementContext } from "@/lib/liability-settlement-context";
import { LiabilityFxValidationError, settlementJournalTransactionId } from "@/lib/realized-liability-fx";
import {
  assertForeignLiabilitySettlementReconciles,
  foreignCurrencyOwnerKey,
  settleForeignCurrencyOutflow,
  settleForeignCurrencyLiability,
} from "@/lib/foreign-currency-carrying-db";

const SHIPPING_LINE_PAYMENT_SYNC_MODULE = "shipping_line_payments";
const SUPERADMIN_SYNC_CITY_ID = 0;
const round2 = (value: number) => Math.round(value * 100) / 100;

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const { shippingLineId, lotId, paymentDate, amountUsd, settlementCurrency, exchangeRate, reference, notes, bankAccountId, superAdminBankAccountId, intermediaryId, superAdminCashAccountId } = body;
    const parsedShippingLineId = Number(shippingLineId);
    const parsedLotId = lotId ? Number(lotId) : null;

    if (!parsedShippingLineId || !paymentDate || !amountUsd) return validationError("shippingLineId, paymentDate, and amountUsd are required");
    if (Number(amountUsd) <= 0) return validationError("Amount must be greater than 0");

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SHIPPING_LINE_PAYMENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingPayment = await prisma.shippingLinePayment.findUnique({ where: { id: existingSync.entityId } });
        if (existingPayment) {
          return successResponse(
            { id: existingPayment.id, amountUsd: Number(existingPayment.amountUsd), amountPkr: existingPayment.amountPkr ? Number(existingPayment.amountPkr) : null },
            "Payment already synced"
          );
        }
      }
    }

    const [sl, lot] = await Promise.all([
      prisma.shippingLine.findUnique({ where: { id: parsedShippingLineId }, select: { id: true } }),
      parsedLotId ? prisma.lot.findUnique({ where: { id: parsedLotId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    if (parsedLotId && !lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const source = await validatePaymentSource({
      bankAccountId,
      superAdminBankAccountId,
      superAdminCashAccountId,
      intermediaryId,
      currencyCode: String(settlementCurrency || "USD"),
      requireSelection: true,
    });
    if (!source.ok) return errorResponse(source.code, source.message, source.status);
    const resolvedBankAccountId = source.bankAccountId;
    const resolvedSuperAdminBankAccountId = source.superAdminBankAccountId;
    const resolvedSuperAdminCashAccountId = source.superAdminCashAccountId;
    const resolvedIntermediaryId = source.intermediaryId;
    const normalizedSettlementCurrency = String(settlementCurrency || "USD").trim().toUpperCase();
    const documentedRate = exchangeRate ? Number(exchangeRate) : 0;
    if (!resolvedIntermediaryId && (!Number.isFinite(documentedRate) || documentedRate <= 0)) {
      return validationError("Documented USD → PKR settlement rate is required");
    }
    let amountLocal: number | null = !resolvedIntermediaryId ? Math.round(Number(amountUsd) * documentedRate * 100) / 100 : null;
    const amountPkr = amountLocal;

    const fallbackUsdToPkrRate = resolvedIntermediaryId
      ? await getLotFallbackUsdToPkrRate(parsedLotId)
      : null;

    const payment = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        `shipping-liability:${parsedShippingLineId}:${parsedLotId || "none"}`,
      );
      const created = await tx.shippingLinePayment.create({
        data: {
          shippingLineId: parsedShippingLineId,
          lotId: parsedLotId,
          bankAccountId: resolvedBankAccountId,
          superAdminBankAccountId: resolvedSuperAdminBankAccountId,
          intermediaryId: resolvedIntermediaryId,
          superAdminCashAccountId: resolvedSuperAdminCashAccountId,
          paymentDate: new Date(paymentDate),
          amountUsd: Number(amountUsd),
          exchangeRate: exchangeRate ? Number(exchangeRate) : null,
          amountPkr,
          reference: reference || null,
          notes: notes || null,
          createdBy: user.userId,
        },
      });

      await createAuditLog(user.userId, null, "shipping_line_payments", created.id, "create", undefined,
        { shippingLineId: parsedShippingLineId, amountUsd, bankAccountId: resolvedBankAccountId, superAdminBankAccountId: resolvedSuperAdminBankAccountId, intermediaryId: resolvedIntermediaryId, superAdminCashAccountId: resolvedSuperAdminCashAccountId }, getClientIP(request), tx);

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SHIPPING_LINE_PAYMENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "shipping_line_payments",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      let paymentForJournal = created;
      if (resolvedIntermediaryId) {
        const fifo = await consumeIntermediaryUsdFifo({
          intermediaryId: resolvedIntermediaryId,
          amountUsd: Number(amountUsd),
          paymentDate: created.paymentDate,
          shippingLinePaymentId: created.id,
          fallbackRatePkr: fallbackUsdToPkrRate,
        }, tx);
        paymentForJournal = await tx.shippingLinePayment.update({
          where: { id: created.id },
          data: {
            amountPkr: fifo.amountPkr,
            exchangeRate: fifo.effectiveRatePkr,
          },
        });
        amountLocal = fifo.amountPkr;
      }
      const actualSettlementPkr = resolvedIntermediaryId
        ? Number(amountLocal || 0)
        : Number(amountPkr || 0);
      if (actualSettlementPkr <= 0) {
        throw new LiabilityFxValidationError("Actual PKR settlement value is required to recognize shipping FX; provide the documented settlement rate.");
      }
      const fx = await resolveShippingSettlementContext({
        shippingLineId: parsedShippingLineId,
        lotId: parsedLotId,
        paymentId: created.id,
        settlementAmountUsd: Number(amountUsd),
        actualSettlementPkr,
      }, tx);
      paymentForJournal = await tx.shippingLinePayment.update({
        where: { id: created.id },
        data: {
          amountPkr: actualSettlementPkr,
          carryingRatePkr: fx.carryingRatePkr,
          carryingAmountPkr: fx.carryingAmountPkr,
          realizedFxPkr: fx.realizedFxPkr,
          fxPoolDate: new Date(fx.originalPoolDate),
        },
      });
      const fundingAssetSettlement = normalizedSettlementCurrency === "USD"
        ? await settleForeignCurrencyOutflow(tx, {
            sourceOwnerKey: resolvedIntermediaryId
              ? foreignCurrencyOwnerKey.intermediary(resolvedIntermediaryId)
              : resolvedSuperAdminCashAccountId
                ? foreignCurrencyOwnerKey.superAdminCash(resolvedSuperAdminCashAccountId)
                : resolvedSuperAdminBankAccountId
                  ? foreignCurrencyOwnerKey.superAdminBank(resolvedSuperAdminBankAccountId)
                  : foreignCurrencyOwnerKey.cityBank(resolvedBankAccountId!),
            currencyCode: "USD",
            amount: Number(amountUsd),
            sourceType: "shipping_line_payment",
            sourceId: created.id,
            settlementDate: paymentForJournal.paymentDate,
            settlementRate: {
              ratePkr: round2(actualSettlementPkr / Number(amountUsd)),
              rateType: "actual_shipping_settlement",
              provider: resolvedIntermediaryId ? "INTERMEDIARY_USD_FIFO" : "DOCUMENTED_SETTLEMENT_RATE",
              reference: `shipping_line_payment:${created.id}`,
            },
            createdBy: user.userId,
          })
        : null;
      await journalShippingLinePayment({
        id: paymentForJournal.id,
        shippingLineId: parsedShippingLineId,
        amountUsd: Number(paymentForJournal.amountUsd),
        paymentDate: paymentForJournal.paymentDate,
        createdBy: user.userId,
        bankAccountId: resolvedBankAccountId,
        superAdminBankAccountId: resolvedSuperAdminBankAccountId,
        intermediaryId: resolvedIntermediaryId,
        superAdminCashAccountId: resolvedSuperAdminCashAccountId,
        carryingAmountPkr: fx.carryingAmountPkr,
        actualSettlementPkr,
        journalVersion: paymentForJournal.journalVersion,
      }, tx);
      if (fundingAssetSettlement) {
        await journalForeignFundingAssetAdjustments({
          entityPrefix: "FXSHIPASSET",
          entityType: "shipping_line_payment",
          entityId: created.id,
          date: paymentForJournal.paymentDate,
          createdBy: user.userId,
          bankAccountId: resolvedBankAccountId,
          superAdminBankAccountId: resolvedSuperAdminBankAccountId,
          superAdminCashAccountId: resolvedSuperAdminCashAccountId,
          intermediaryId: resolvedIntermediaryId,
          movements: fundingAssetSettlement.movements,
        }, tx);
      }
      const liabilitySettlement = await settleForeignCurrencyLiability(tx, {
        sourceOwnerKey: foreignCurrencyOwnerKey.shippingPayable(parsedShippingLineId, parsedLotId),
        currencyCode: "USD",
        amount: Number(amountUsd),
        sourceType: "shipping_line_payment",
        sourceId: created.id,
        settlementDate: paymentForJournal.paymentDate,
        settlementRate: {
          ratePkr: round2(actualSettlementPkr / Number(amountUsd)),
          rateType: "actual_shipping_settlement",
          provider: resolvedIntermediaryId ? "INTERMEDIARY_USD_FIFO" : "DOCUMENTED_SETTLEMENT_RATE",
          reference: `shipping_line_payment:${created.id}`,
        },
        journalTransactionId: settlementJournalTransactionId("SLPAY", created.id, paymentForJournal.journalVersion),
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
      return paymentForJournal;
    });

    return successResponse({ id: payment.id, amountUsd: Number(payment.amountUsd), amountPkr }, "Payment recorded", 201);
  } catch (error) {
    if (error instanceof LiabilityFxValidationError) {
      return errorResponse("FX_BASIS_REQUIRED", error.message, 400);
    }
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SHIPPING_LINE_PAYMENT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingPayment = await prisma.shippingLinePayment.findUnique({ where: { id: existingSync.entityId } });
        if (existingPayment) {
          return successResponse(
            { id: existingPayment.id, amountUsd: Number(existingPayment.amountUsd), amountPkr: existingPayment.amountPkr ? Number(existingPayment.amountPkr) : null },
            "Payment already synced"
          );
        }
      }
    }
    console.error("Create shipping line payment:", error);
    return serverError();
  }
});
