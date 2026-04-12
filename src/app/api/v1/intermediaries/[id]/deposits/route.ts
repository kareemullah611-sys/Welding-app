import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryDeposit } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

function parsePositiveAmount(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const intermediaryId = parseInt(context.params.id);
  const body = await request.json();

  if (!body.depositDate) return errorResponse("VALIDATION", "depositDate required", 400);
  const amount = parsePositiveAmount(body.amount);
  if (!amount) return errorResponse("VALIDATION", "amount must be > 0", 400);
  if (!body.currencyId) return errorResponse("VALIDATION", "currencyId required", 400);

  const currency = await prisma.currency.findUnique({ where: { id: Number(body.currencyId) } });
  if (!currency) return errorResponse("VALIDATION", "Invalid currency", 400);

  // Super admin chooses source: bank account or any city's cash
  let sourceType: string = body.sourceType || "bank_account";
  let cityId: number | null = null;
  let bankAccountId: number | null = null;
  if (sourceType === "city_cash" && body.cityId) {
    const city = await prisma.city.findUnique({ where: { id: Number(body.cityId) }, select: { id: true, isActive: true } });
    if (!city || !city.isActive) return errorResponse("VALIDATION", "Invalid or inactive city", 400);
    cityId = city.id;
  }
  if (sourceType === "bank_account" && body.bankAccountId) {
    const ba = await prisma.bankAccount.findUnique({ where: { id: Number(body.bankAccountId) }, select: { id: true, isActive: true } });
    if (!ba) return errorResponse("NOT_FOUND", "Bank account not found", 404);
    if (!ba.isActive) return errorResponse("VALIDATION", "Selected bank account is inactive", 400);
    bankAccountId = ba.id;
  }
  if (sourceType === "bank_account" && !bankAccountId) return errorResponse("VALIDATION", "Bank account is required", 400);
  if (sourceType === "city_cash" && !cityId) return errorResponse("VALIDATION", "City is required", 400);

  const deposit = await prisma.intermediaryDeposit.create({
    data: {
      intermediaryId,
      depositDate: new Date(body.depositDate),
      amount,
      currencyId: Number(body.currencyId),
      sourceType: sourceType as any,
      cityId,
      bankAccountId,
      notes: body.notes || null,
      createdBy: user.userId,
    },
  });

  await journalIntermediaryDeposit({
    id: deposit.id, intermediaryId,
    amount: Number(deposit.amount), currencyCode: currency.code,
    depositDate: deposit.depositDate, createdBy: user.userId,
    sourceType, cityId, bankAccountId,
  });

  return successResponse(deposit, "Deposit recorded", 201);
});
