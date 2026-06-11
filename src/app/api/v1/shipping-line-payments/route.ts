import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";
import { settlementAmountToPkr } from "@/lib/payment-currencies";

const SHIPPING_LINE_PAYMENT_SYNC_MODULE = "shipping_line_payments";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const { shippingLineId, lotId, paymentDate, amountUsd, settlementCurrency, exchangeRate, reference, notes, bankAccountId, intermediaryId } = body;
    const parsedShippingLineId = Number(shippingLineId);
    const parsedLotId = lotId ? Number(lotId) : null;

    if (!parsedShippingLineId || !paymentDate || !amountUsd) return validationError("shippingLineId, paymentDate, and amountUsd are required");
    if (Number(amountUsd) <= 0) return validationError("Amount must be greater than 0");

    const [sl, lot, source] = await Promise.all([
      prisma.shippingLine.findUnique({ where: { id: parsedShippingLineId }, select: { id: true } }),
      parsedLotId ? prisma.lot.findUnique({ where: { id: parsedLotId }, select: { id: true } }) : Promise.resolve(null),
      validatePaymentSource({ bankAccountId, intermediaryId, requireSelection: true }),
    ]);
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    if (parsedLotId && !lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (!source.ok) return errorResponse(source.code, source.message, source.status);

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

    const amountPkrValue = settlementAmountToPkr(
      Number(amountUsd),
      String(settlementCurrency || "USD"),
      exchangeRate ? Number(exchangeRate) : 0
    );
    const amountPkr = amountPkrValue > 0 ? Math.round(amountPkrValue * 100) / 100 : null;

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.shippingLinePayment.create({
        data: {
          shippingLineId: parsedShippingLineId,
          lotId: parsedLotId,
          bankAccountId: source.bankAccountId,
          intermediaryId: source.intermediaryId,
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
        { shippingLineId: parsedShippingLineId, amountUsd, bankAccountId: source.bankAccountId, intermediaryId: source.intermediaryId }, getClientIP(request), tx);

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
      return created;
    });

    try {
      await journalShippingLinePayment({
        id: payment.id,
        shippingLineId: parsedShippingLineId,
        amountUsd: Number(amountUsd),
        paymentDate: new Date(paymentDate),
        createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
      });
    } catch (je) { console.error("Journal (shipping line payment):", je); }

    return successResponse({ id: payment.id, amountUsd: Number(payment.amountUsd), amountPkr }, "Payment recorded", 201);
  } catch (error) {
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
