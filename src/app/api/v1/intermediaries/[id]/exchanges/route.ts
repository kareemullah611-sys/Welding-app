import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryExchange } from "@/lib/accounting";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import { JWTPayload } from "@/lib/auth";

function parsePositive(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const intermediaryId = parseInt(context.params.id);
  if (!Number.isFinite(intermediaryId)) return errorResponse("VALIDATION", "Invalid intermediary ID", 400);

  const intermediary = await prisma.intermediary.findUnique({ where: { id: intermediaryId }, select: { id: true, isActive: true } });
  if (!intermediary) return errorResponse("NOT_FOUND", "Intermediary not found", 404);
  if (!intermediary.isActive) return errorResponse("VALIDATION", "Intermediary is inactive", 400);

  const body = await request.json();
  if (!body.exchangeDate) return errorResponse("VALIDATION", "exchangeDate required", 400);

  const fromCurrencyId = Number(body.fromCurrencyId);
  const toCurrencyId = Number(body.toCurrencyId);
  const fromAmount = parsePositive(body.fromAmount);
  const exchangeRate = parsePositive(body.exchangeRate);

  if (!Number.isFinite(fromCurrencyId) || !Number.isFinite(toCurrencyId)) return errorResponse("VALIDATION", "Currencies are required", 400);
  if (fromCurrencyId === toCurrencyId) return errorResponse("VALIDATION", "From and To currencies must be different", 400);
  if (!fromAmount) return errorResponse("VALIDATION", "fromAmount must be > 0", 400);
  if (!exchangeRate) return errorResponse("VALIDATION", "exchangeRate must be > 0", 400);

  const [fromCurrency, toCurrency] = await Promise.all([
    prisma.currency.findUnique({ where: { id: fromCurrencyId } }),
    prisma.currency.findUnique({ where: { id: toCurrencyId } }),
  ]);
  if (!fromCurrency || !toCurrency) return errorResponse("VALIDATION", "Invalid currency selected", 400);

  const balances = await getIntermediaryBalances(intermediaryId);
  const available = Number(balances[fromCurrency.code] || 0);
  if (fromAmount > available) {
    return errorResponse("VALIDATION", `Insufficient ${fromCurrency.code} balance. Available: ${available.toLocaleString("en-US")}`, 400);
  }

  const toAmount = Math.round(fromAmount * exchangeRate * 100) / 100;
  if (!(toAmount > 0)) return errorResponse("VALIDATION", "Calculated toAmount must be > 0", 400);

  const exchange = await prisma.intermediaryExchange.create({
    data: {
      intermediaryId,
      exchangeDate: new Date(body.exchangeDate),
      fromCurrencyId,
      fromAmount,
      toCurrencyId,
      toAmount,
      exchangeRate,
      notes: body.notes || null,
      createdBy: user.userId,
    },
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
});
