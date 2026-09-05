import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { intermediaryDepositJournalTransactionId, journalIntermediaryDeposit, reverseJournalEntries } from "@/lib/accounting";
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
  const nextSuperAdminCashAccountId = body.superAdminCashAccountId !== undefined
    ? Number(body.superAdminCashAccountId || 0)
    : Number(existing.superAdminCashAccountId || 0);
  if (Number(Boolean(nextSuperAdminBankAccountId)) + Number(Boolean(nextSuperAdminCashAccountId)) !== 1) {
    return errorResponse("VALIDATION", "Choose exactly one source: super admin bank or haji cash account", 400);
  }
  const sourceAccountId = nextSuperAdminCashAccountId || nextSuperAdminBankAccountId;
  const sourceAccount = await prisma.superAdminBankAccount.findUnique({
    where: { id: sourceAccountId },
    select: { id: true, isActive: true, currencyId: true, accountKind: true },
  });
  if (!sourceAccount) return errorResponse("NOT_FOUND", "Super admin source account not found", 404);
  if (!sourceAccount.isActive) return errorResponse("VALIDATION", "Selected super admin source account is inactive", 400);
  if (sourceAccount.currencyId !== currencyId) return errorResponse("VALIDATION", "Deposit currency must match selected source account currency", 400);
  if (nextSuperAdminCashAccountId && sourceAccount.accountKind !== "cash") return errorResponse("VALIDATION", "Selected account is not a haji cash account", 400);
  if (nextSuperAdminBankAccountId && sourceAccount.accountKind !== "bank") return errorResponse("VALIDATION", "Selected account is not a bank account", 400);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `intermediary-deposit:${id}`);
    const locked = await tx.intermediaryDeposit.findUnique({ where: { id } });
    if (!locked || locked.deletedAt) throw Object.assign(new Error("Deposit changed; reload and retry"), { code: "DEPOSIT_CHANGED_RETRY" });
    await reverseJournalEntries(intermediaryDepositJournalTransactionId(id, locked.journalVersion), user.userId, tx);
    const nextVersion = locked.journalVersion + 1;
    const row = await tx.intermediaryDeposit.update({
      where: { id },
      data: {
        depositDate: body.depositDate ? new Date(body.depositDate) : undefined,
        amount: nextAmount,
        currencyId,
        sourceType: nextSuperAdminCashAccountId ? "super_admin_cash" : "super_admin_bank_account",
        cityId: null,
        bankAccountId: null,
        superAdminBankAccountId: nextSuperAdminCashAccountId ? null : nextSuperAdminBankAccountId,
        superAdminCashAccountId: nextSuperAdminCashAccountId || null,
        notes: body.notes !== undefined ? body.notes || null : undefined,
        journalVersion: nextVersion,
      },
    });
    await journalIntermediaryDeposit({
      id, intermediaryId: row.intermediaryId,
      amount: Number(row.amount), currencyCode: currency.code,
      depositDate: row.depositDate, createdBy: user.userId,
      sourceType: row.sourceType, cityId: row.cityId, bankAccountId: row.bankAccountId,
      superAdminBankAccountId: row.superAdminBankAccountId,
      superAdminCashAccountId: row.superAdminCashAccountId,
      journalVersion: row.journalVersion,
    }, tx);
    await createAuditLog(user.userId, null, "intermediary_deposits", id, "update", existing, row, getClientIP(request), tx);
    return row;
  });

  return successResponse(updated, "Updated");
});

export const DELETE = withSuperAdmin(async (_req: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const existing = await prisma.intermediaryDeposit.findUnique({ where: { id } });
  if (!existing) return errorResponse("NOT_FOUND", "Not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `intermediary-deposit:${id}`);
    const locked = await tx.intermediaryDeposit.findUnique({ where: { id } });
    if (!locked || locked.deletedAt) return;
    await reverseJournalEntries(intermediaryDepositJournalTransactionId(id, locked.journalVersion), user.userId, tx);
    await tx.intermediaryDeposit.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.userId } });
    await createAuditLog(user.userId, null, "intermediary_deposits", id, "delete", existing, undefined, getClientIP(_req), tx);
  });

  return successResponse({ id }, "Deleted");
});
