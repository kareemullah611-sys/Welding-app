import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryExchange, reverseJournalEntries } from "@/lib/accounting";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import { JWTPayload } from "@/lib/auth";

function parsePositive(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  if (!Number.isFinite(id)) return errorResponse("VALIDATION", "Invalid exchange ID", 400);

  const existing = await prisma.intermediaryExchange.findUnique({
    where: { id },
    include: { fromCurrency: true, toCurrency: true },
  });
  if (!existing || !existing.isActive) return errorResponse("NOT_FOUND", "Exchange not found", 404);

  const body = await request.json();

  const baseCurrencyId = body.baseCurrencyId !== undefined ? Number(body.baseCurrencyId) : (existing.baseCurrencyId ?? existing.fromCurrencyId);
  const quoteCurrencyId = body.quoteCurrencyId !== undefined ? Number(body.quoteCurrencyId) : (existing.quoteCurrencyId ?? existing.toCurrencyId);
  const fromCurrencyId = body.fromCurrencyId !== undefined ? Number(body.fromCurrencyId) : existing.fromCurrencyId;
  const toCurrencyId = body.toCurrencyId !== undefined ? Number(body.toCurrencyId) : existing.toCurrencyId;
  const fromAmount = body.fromAmount !== undefined ? parsePositive(body.fromAmount) : Number(existing.fromAmount);
  const exchangeRate = body.exchangeRate !== undefined ? parsePositive(body.exchangeRate) : Number(existing.exchangeRate);

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

  const balances = await getIntermediaryBalances(existing.intermediaryId, { excludeExchangeId: id });
  const available = Number(balances[fromCurrency.code] || 0);
  if (fromAmount > available) {
    return errorResponse("VALIDATION", `Insufficient ${fromCurrency.code} balance. Available: ${available.toLocaleString("en-US")}`, 400);
  }

  if (!(toAmount > 0)) return errorResponse("VALIDATION", "Calculated toAmount must be > 0", 400);

  await reverseJournalEntries(`INTFX-OUT-${id}`, user.userId);
  await reverseJournalEntries(`INTFX-IN-${id}`, user.userId);

  const updated = await prisma.intermediaryExchange.update({
    where: { id },
    data: {
      exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : undefined,
      baseCurrencyId,
      quoteCurrencyId,
      fromCurrencyId,
      fromAmount,
      toCurrencyId,
      toAmount,
      exchangeRate,
      notes: body.notes !== undefined ? body.notes || null : undefined,
    },
  });

  await journalIntermediaryExchange({
    id: updated.id,
    intermediaryId: updated.intermediaryId,
    exchangeDate: updated.exchangeDate,
    fromCurrencyCode: fromCurrency.code,
    fromAmount: Number(updated.fromAmount),
    toCurrencyCode: toCurrency.code,
    toAmount: Number(updated.toAmount),
    createdBy: user.userId,
  });

  return successResponse(updated, "Exchange updated");
});

export const DELETE = withSuperAdmin(async (_request: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  if (!Number.isFinite(id)) return errorResponse("VALIDATION", "Invalid exchange ID", 400);

  const existing = await prisma.intermediaryExchange.findUnique({ where: { id } });
  if (!existing || !existing.isActive) return errorResponse("NOT_FOUND", "Exchange not found", 404);

  await reverseJournalEntries(`INTFX-OUT-${id}`, user.userId);
  await reverseJournalEntries(`INTFX-IN-${id}`, user.userId);

  await prisma.intermediaryExchange.update({
    where: { id },
    data: {
      isActive: false,
      deletedAt: new Date(),
      deletedBy: user.userId,
    },
  });

  return successResponse({ id }, "Exchange deleted");
});
