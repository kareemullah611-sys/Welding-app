import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryDeposit, reverseJournalEntries } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

function parsePositiveAmount(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const body = await request.json();

  const existing = await prisma.intermediaryDeposit.findUnique({
    where: { id }, include: { currency: true },
  });
  if (!existing) return errorResponse("NOT_FOUND", "Not found", 404);

  const currencyId = body.currencyId ? Number(body.currencyId) : existing.currencyId;
  const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
  if (!currency) return errorResponse("VALIDATION", "Invalid currency", 400);

  let nextAmount: number | undefined;
  if (body.amount !== undefined) {
    const parsedAmount = parsePositiveAmount(body.amount);
    if (!parsedAmount) return errorResponse("VALIDATION", "amount must be > 0", 400);
    nextAmount = parsedAmount;
  }

  if (body.cityId !== undefined || body.bankAccountId !== undefined || body.sourceType === "city_cash" || body.sourceType === "bank_account") {
    return errorResponse("VALIDATION", "Use only super admin bank accounts for intermediary deposits", 400);
  }

  const nextSuperAdminBankAccountId = body.superAdminBankAccountId !== undefined
    ? Number(body.superAdminBankAccountId || 0)
    : Number(existing.superAdminBankAccountId || 0);
  if (!nextSuperAdminBankAccountId) return errorResponse("VALIDATION", "Super admin bank account is required", 400);
  const superAdminBankAccount = await prisma.superAdminBankAccount.findUnique({
    where: { id: nextSuperAdminBankAccountId },
    select: { id: true, isActive: true, currencyId: true },
  });
  if (!superAdminBankAccount) return errorResponse("NOT_FOUND", "Super admin bank account not found", 404);
  if (!superAdminBankAccount.isActive) return errorResponse("VALIDATION", "Selected super admin bank account is inactive", 400);
  if (superAdminBankAccount.currencyId !== currencyId) {
    return errorResponse("VALIDATION", "Deposit currency must match selected super admin bank account currency", 400);
  }

  await reverseJournalEntries(`INTDEP-${id}`, user.userId);

  const updated = await prisma.intermediaryDeposit.update({
    where: { id },
    data: {
      depositDate: body.depositDate ? new Date(body.depositDate) : undefined,
      amount: nextAmount,
      currencyId,
      sourceType: "super_admin_bank_account",
      cityId: null,
      bankAccountId: null,
      superAdminBankAccountId: nextSuperAdminBankAccountId,
      notes: body.notes !== undefined ? body.notes || null : undefined,
    },
  });

  await journalIntermediaryDeposit({
    id, intermediaryId: updated.intermediaryId,
    amount: Number(updated.amount), currencyCode: currency.code,
    depositDate: updated.depositDate, createdBy: user.userId,
    sourceType: updated.sourceType,
    cityId: updated.cityId, bankAccountId: updated.bankAccountId, superAdminBankAccountId: updated.superAdminBankAccountId,
  });

  return successResponse(updated, "Updated");
});

export const DELETE = withSuperAdmin(async (_req: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const existing = await prisma.intermediaryDeposit.findUnique({ where: { id } });
  if (!existing) return errorResponse("NOT_FOUND", "Not found", 404);

  await reverseJournalEntries(`INTDEP-${id}`, user.userId);
  await prisma.intermediaryDeposit.delete({ where: { id } });

  return successResponse({ id }, "Deleted");
});
