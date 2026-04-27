import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryExchange } from "@/lib/accounting";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const INTERMEDIARY_EXCHANGE_SYNC_MODULE = "intermediary_exchanges";
const SUPERADMIN_SYNC_CITY_ID = 0;

function parsePositive(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  const intermediaryId = parseInt(context.params.id);
  if (!Number.isFinite(intermediaryId)) return errorResponse("VALIDATION", "Invalid intermediary ID", 400);

  const intermediary = await prisma.intermediary.findUnique({ where: { id: intermediaryId }, select: { id: true, isActive: true } });
  if (!intermediary) return errorResponse("NOT_FOUND", "Intermediary not found", 404);
  if (!intermediary.isActive) return errorResponse("VALIDATION", "Intermediary is inactive", 400);

  const body = await request.json();
  if (!body.exchangeDate) return errorResponse("VALIDATION", "exchangeDate required", 400);

  const baseCurrencyId = Number(body.baseCurrencyId);
  const quoteCurrencyId = Number(body.quoteCurrencyId);
  const fromCurrencyId = Number(body.fromCurrencyId);
  const toCurrencyId = Number(body.toCurrencyId);
  const fromAmount = parsePositive(body.fromAmount);
  const exchangeRate = parsePositive(body.exchangeRate);

  if (!Number.isFinite(baseCurrencyId) || !Number.isFinite(quoteCurrencyId)) return errorResponse("VALIDATION", "Base and quote currencies are required", 400);
  if (baseCurrencyId === quoteCurrencyId) return errorResponse("VALIDATION", "Base and quote currencies must be different", 400);
  if (!Number.isFinite(fromCurrencyId) || !Number.isFinite(toCurrencyId)) return errorResponse("VALIDATION", "Currencies are required", 400);
  if (fromCurrencyId === toCurrencyId) return errorResponse("VALIDATION", "From and To currencies must be different", 400);
  if (!fromAmount) return errorResponse("VALIDATION", "fromAmount must be > 0", 400);
  if (!exchangeRate) return errorResponse("VALIDATION", "exchangeRate must be > 0", 400);

  const [baseCurrency, quoteCurrency, fromCurrency, toCurrency] = await Promise.all([
    prisma.currency.findUnique({ where: { id: baseCurrencyId } }),
    prisma.currency.findUnique({ where: { id: quoteCurrencyId } }),
    prisma.currency.findUnique({ where: { id: fromCurrencyId } }),
    prisma.currency.findUnique({ where: { id: toCurrencyId } }),
  ]);
  if (!baseCurrency || !quoteCurrency || !fromCurrency || !toCurrency) return errorResponse("VALIDATION", "Invalid currency selected", 400);

  let toAmount = 0;
  if (fromCurrencyId === baseCurrencyId && toCurrencyId === quoteCurrencyId) {
    toAmount = Math.round((fromAmount * exchangeRate) * 100) / 100;
  } else if (fromCurrencyId === quoteCurrencyId && toCurrencyId === baseCurrencyId) {
    toAmount = Math.round((fromAmount / exchangeRate) * 100) / 100;
  } else {
    return errorResponse("VALIDATION", "From/To must match selected base/quote pair", 400);
  }

  const balances = await getIntermediaryBalances(intermediaryId);
  const available = Number(balances[fromCurrency.code] || 0);
  if (fromAmount > available) {
    return errorResponse("VALIDATION", `Insufficient ${fromCurrency.code} balance. Available: ${available.toLocaleString("en-US")}`, 400);
  }

  if (!(toAmount > 0)) return errorResponse("VALIDATION", "Calculated toAmount must be > 0", 400);

  try {
    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_EXCHANGE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingExchange = await prisma.intermediaryExchange.findUnique({ where: { id: existingSync.entityId } });
        if (existingExchange) return successResponse(existingExchange, "Exchange already synced");
      }
    }

    const exchange = await prisma.$transaction(async (tx) => {
      const created = await tx.intermediaryExchange.create({
        data: {
          intermediaryId,
          exchangeDate: new Date(body.exchangeDate),
          baseCurrencyId,
          quoteCurrencyId,
          fromCurrencyId,
          fromAmount,
          toCurrencyId,
          toAmount,
          exchangeRate,
          notes: body.notes || null,
          createdBy: user.userId,
        },
      });

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_EXCHANGE_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "intermediary_exchanges",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    await journalIntermediaryExchange({
      id: exchange.id,
      intermediaryId,
      exchangeDate: exchange.exchangeDate,
      fromCurrencyCode: fromCurrency.code,
      fromAmount: Number(exchange.fromAmount),
      toCurrencyCode: toCurrency.code,
      toAmount: Number(exchange.toAmount),
      createdBy: user.userId,
    });

    return successResponse(exchange, "Exchange executed", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_EXCHANGE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingExchange = await prisma.intermediaryExchange.findUnique({ where: { id: existingSync.entityId } });
        if (existingExchange) return successResponse(existingExchange, "Exchange already synced");
      }
    }
    throw error;
  }
});
