import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";
import { assertSuperAdminCashHasFunds } from "@/lib/haji-cash-balance";
import { settlementAmountToPkr } from "@/lib/payment-currencies";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import { consumeIntermediaryUsdFifo, getLotFallbackUsdToPkrRate } from "@/lib/intermediary-usd-fifo";
import { resolveShippingSettlementContext } from "@/lib/liability-settlement-context";
import { LiabilityFxValidationError } from "@/lib/realized-liability-fx";

const SHIPPING_LINE_PAYMENT_SYNC_MODULE = "shipping_line_payments";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const { shippingLineId, lotId, paymentDate, amountUsd, settlementCurrency, exchangeRate, reference, notes, bankAccountId, intermediaryId, superAdminCashAccountId } = body;
    const parsedShippingLineId = Number(shippingLineId);
    const parsedLotId = lotId ? Number(lotId) : null;
    const parsedCashAccountId = superAdminCashAccountId ? Number(superAdminCashAccountId) : null;

    if (!parsedShippingLineId || !paymentDate || !amountUsd) return validationError("shippingLineId, paymentDate, and amountUsd are required");
    if (Number(amountUsd) <= 0) return validationError("Amount must be greater than 0");

    const [sl, lot] = await Promise.all([
      prisma.shippingLine.findUnique({ where: { id: parsedShippingLineId }, select: { id: true } }),
      parsedLotId ? prisma.lot.findUnique({ where: { id: parsedLotId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    if (parsedLotId && !lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    let resolvedBankAccountId: number | null = null;
    let resolvedIntermediaryId: number | null = null;
    let amountLocal: number | null = null;

    if (parsedCashAccountId) {
      if (bankAccountId || intermediaryId) {
        return validationError("Choose either haji cash or another funding source, not both");
      }
      const amountPkrValue = settlementAmountToPkr(
        Number(amountUsd),
        String(settlementCurrency || "USD"),
        exchangeRate ? Number(exchangeRate) : 0
      );
      amountLocal = amountPkrValue > 0 ? Math.round(amountPkrValue * 100) / 100 : Number(amountUsd);
      const funds = await assertSuperAdminCashHasFunds(parsedCashAccountId, amountLocal);
      if (!funds.ok) return errorResponse("VALIDATION", funds.message, 400);
      const cashAcct = await prisma.superAdminBankAccount.findUnique({
        where: { id: parsedCashAccountId },
        include: { currency: true },
      });
      if (!cashAcct || cashAcct.accountKind !== "cash") {
        return errorResponse("NOT_FOUND", "Haji cash account not found", 404);
      }
    } else {
      const source = await validatePaymentSource({ bankAccountId, intermediaryId, requireSelection: true });
      if (!source.ok) return errorResponse(source.code, source.message, source.status);
      resolvedBankAccountId = source.bankAccountId;
      resolvedIntermediaryId = source.intermediaryId;
      if (resolvedIntermediaryId) {
        const balances = await getIntermediaryBalances(resolvedIntermediaryId);
        const availableUsd = Number(balances.USD || 0);
        if (Number(amountUsd) > availableUsd + 0.001) {
          return errorResponse("INSUFFICIENT_FUNDS", `Insufficient intermediary USD balance. Available: $${availableUsd.toLocaleString("en-US")}`, 400);
        }
      }
    }

    const amountPkrValue = settlementAmountToPkr(
      Number(amountUsd),
      String(settlementCurrency || "USD"),
      exchangeRate ? Number(exchangeRate) : 0
    );
    const amountPkr = amountPkrValue > 0 ? Math.round(amountPkrValue * 100) / 100 : null;
    if (!amountLocal && amountPkr) amountLocal = amountPkr;

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
          intermediaryId: resolvedIntermediaryId,
          superAdminCashAccountId: parsedCashAccountId,
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
        { shippingLineId: parsedShippingLineId, amountUsd, bankAccountId: resolvedBankAccountId, intermediaryId: resolvedIntermediaryId, superAdminCashAccountId: parsedCashAccountId }, getClientIP(request), tx);

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
        : Number(exchangeRate || 0) > 0
          ? Math.round(Number(amountUsd) * Number(exchangeRate) * 100) / 100
          : 0;
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
      await journalShippingLinePayment({
        id: paymentForJournal.id,
        shippingLineId: parsedShippingLineId,
        amountUsd: Number(paymentForJournal.amountUsd),
        paymentDate: paymentForJournal.paymentDate,
        createdBy: user.userId,
        bankAccountId: resolvedBankAccountId,
        intermediaryId: resolvedIntermediaryId,
        superAdminCashAccountId: parsedCashAccountId,
        carryingAmountPkr: fx.carryingAmountPkr,
        actualSettlementPkr,
        journalVersion: paymentForJournal.journalVersion,
      }, tx);
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
