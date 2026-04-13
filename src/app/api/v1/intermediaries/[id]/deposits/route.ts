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

  // Super admin must not debit city cash/bank through intermediary deposits.
  if (body.cityId || body.bankAccountId || body.sourceType === "city_cash") {
    return errorResponse("VALIDATION", "Super admin cannot debit city cash or city bank accounts from intermediary deposits", 400);
  }
  const sourceType: string = "bank_account";
  const cityId: number | null = null;
  const bankAccountId: number | null = null;

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
