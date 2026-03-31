import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryDeposit } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  const intermediaryId = parseInt(context.params.id);
  const body = await request.json();

  if (!body.depositDate) return errorResponse("VALIDATION", "depositDate required", 400);
  if (!body.amount || Number(body.amount) <= 0) return errorResponse("VALIDATION", "amount must be > 0", 400);
  if (!body.currencyId) return errorResponse("VALIDATION", "currencyId required", 400);

  const currency = await prisma.currency.findUnique({ where: { id: Number(body.currencyId) } });
  if (!currency) return errorResponse("VALIDATION", "Invalid currency", 400);

  // City admins can only deposit from their own city cash
  let sourceType: string;
  let cityId: number | null = null;
  let bankAccountId: number | null = null;

  if (user.role === "city_admin") {
    sourceType = "city_cash";
    cityId = user.cityId!;
  } else {
    // super_admin can choose source
    sourceType = body.sourceType || "bank_account";
    if (sourceType === "city_cash" && body.cityId) cityId = Number(body.cityId);
    if (sourceType === "bank_account" && body.bankAccountId) bankAccountId = Number(body.bankAccountId);
  }

  const deposit = await prisma.intermediaryDeposit.create({
    data: {
      intermediaryId,
      depositDate: new Date(body.depositDate),
      amount: Number(body.amount),
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
