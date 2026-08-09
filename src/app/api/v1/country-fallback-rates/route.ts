import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

function parsePositive(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function dateOnly(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET = withSuperAdmin(async () => {
  try {
    const rates = await prisma.countryFallbackExchangeRate.findMany({
      include: {
        country: { select: { id: true, name: true, code: true } },
        fromCurrency: { select: { id: true, code: true, symbol: true } },
        toCurrency: { select: { id: true, code: true, symbol: true } },
      },
      orderBy: [{ country: { name: "asc" } }, { fromCurrency: { code: "asc" } }, { effectiveFrom: "desc" }],
    });

    return successResponse(rates.map((rate) => ({
      id: rate.id,
      countryId: rate.countryId,
      countryName: rate.country.name,
      countryCode: rate.country.code,
      fromCurrencyId: rate.fromCurrencyId,
      fromCurrencyCode: rate.fromCurrency.code,
      toCurrencyId: rate.toCurrencyId,
      toCurrencyCode: rate.toCurrency.code,
      rate: Number(rate.rate),
      effectiveFrom: rate.effectiveFrom.toISOString().split("T")[0],
      isActive: rate.isActive,
      notes: rate.notes,
    })));
  } catch (error) {
    console.error("List fallback rates error:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const countryId = Number(body.countryId || 0);
    const fromCurrencyCode = String(body.fromCurrencyCode || "USD").toUpperCase();
    const toCurrencyCode = String(body.toCurrencyCode || "PKR").toUpperCase();
    const rate = parsePositive(body.rate);
    const effectiveFrom = dateOnly(body.effectiveFrom) || new Date();

    if (!countryId) return validationError("Country is required");
    if (!rate) return validationError("Rate must be greater than 0");
    if (fromCurrencyCode === toCurrencyCode) return validationError("From and to currencies must be different");

    const [country, fromCurrency, toCurrency] = await Promise.all([
      prisma.country.findUnique({ where: { id: countryId } }),
      prisma.currency.findUnique({ where: { code: fromCurrencyCode } }),
      prisma.currency.findUnique({ where: { code: toCurrencyCode } }),
    ]);
    if (!country) return errorResponse("NOT_FOUND", "Country not found", 404);
    if (!fromCurrency || !toCurrency) return validationError("Invalid currency code");

    const saved = await prisma.countryFallbackExchangeRate.upsert({
      where: {
        countryId_fromCurrencyId_toCurrencyId_effectiveFrom: {
          countryId,
          fromCurrencyId: fromCurrency.id,
          toCurrencyId: toCurrency.id,
          effectiveFrom,
        },
      },
      update: {
        rate,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
        notes: body.notes || null,
      },
      create: {
        countryId,
        fromCurrencyId: fromCurrency.id,
        toCurrencyId: toCurrency.id,
        rate,
        effectiveFrom,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
        notes: body.notes || null,
        createdBy: user.userId,
      },
    });

    return successResponse({ id: saved.id }, "Fallback rate saved", 201);
  } catch (error) {
    console.error("Save fallback rate error:", error);
    return serverError();
  }
});
