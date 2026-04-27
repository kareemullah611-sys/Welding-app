import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalIntermediaryDeposit } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const INTERMEDIARY_DEPOSIT_SYNC_MODULE = "intermediary_deposits";
const SUPERADMIN_SYNC_CITY_ID = 0;

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
  const syncMeta = getSyncRequestMeta(request);

  if (!body.depositDate) return errorResponse("VALIDATION", "depositDate required", 400);
  const amount = parsePositiveAmount(body.amount);
  if (!amount) return errorResponse("VALIDATION", "amount must be > 0", 400);
  if (!body.currencyId) return errorResponse("VALIDATION", "currencyId required", 400);

  const currency = await prisma.currency.findUnique({ where: { id: Number(body.currencyId) } });
  if (!currency) return errorResponse("VALIDATION", "Invalid currency", 400);

  // Super admin can debit only super-admin owned bank accounts (not city cash/banks).
  if (body.cityId || body.bankAccountId || body.sourceType === "city_cash" || body.sourceType === "bank_account") {
    return errorResponse("VALIDATION", "Use only super admin bank accounts for intermediary deposits", 400);
  }
  const superAdminBankAccountId = Number(body.superAdminBankAccountId || 0);
  if (!superAdminBankAccountId) {
    return errorResponse("VALIDATION", "Super admin bank account is required", 400);
  }
  const superAdminBankAccount = await prisma.superAdminBankAccount.findUnique({
    where: { id: superAdminBankAccountId },
    select: { id: true, isActive: true, currencyId: true },
  });
  if (!superAdminBankAccount) return errorResponse("NOT_FOUND", "Super admin bank account not found", 404);
  if (!superAdminBankAccount.isActive) return errorResponse("VALIDATION", "Selected super admin bank account is inactive", 400);
  if (superAdminBankAccount.currencyId !== Number(body.currencyId)) {
    return errorResponse("VALIDATION", "Deposit currency must match selected super admin bank account currency", 400);
  }

  const sourceType: string = "super_admin_bank_account";
  const cityId: number | null = null;
  const bankAccountId: number | null = null;
  try {
    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_DEPOSIT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingDeposit = await prisma.intermediaryDeposit.findUnique({ where: { id: existingSync.entityId } });
        if (existingDeposit) return successResponse(existingDeposit, "Deposit already synced");
      }
    }

    const deposit = await prisma.$transaction(async (tx) => {
      const created = await tx.intermediaryDeposit.create({
        data: {
          intermediaryId,
          depositDate: new Date(body.depositDate),
          amount,
          currencyId: Number(body.currencyId),
          sourceType: sourceType as any,
          cityId,
          bankAccountId,
          superAdminBankAccountId,
          notes: body.notes || null,
          createdBy: user.userId,
        },
      });

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_DEPOSIT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "intermediary_deposits",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    await journalIntermediaryDeposit({
      id: deposit.id, intermediaryId,
      amount: Number(deposit.amount), currencyCode: currency.code,
      depositDate: deposit.depositDate, createdBy: user.userId,
      sourceType, cityId, bankAccountId, superAdminBankAccountId,
    });

    return successResponse(deposit, "Deposit recorded", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_DEPOSIT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingDeposit = await prisma.intermediaryDeposit.findUnique({ where: { id: existingSync.entityId } });
        if (existingDeposit) return successResponse(existingDeposit, "Deposit already synced");
      }
    }
    throw error;
  }
});
