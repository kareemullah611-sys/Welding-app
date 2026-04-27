import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const INVESTOR_TXN_SYNC_MODULE = "investor_transactions";
const SUPERADMIN_SYNC_CITY_ID = 0;

// ─── POST /api/v1/investors/[id]/transactions ──────────────────────────────
// Body: { type: "deposit"|"withdrawal"|"profit", accountId, amount, date, notes, periodStart?, periodEnd? }
export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  const syncMeta = getSyncRequestMeta(request);
  try {
    const investorId = parseInt(context.params.id);
    const body = await request.json();
    const { type, accountId, amount, date, notes, periodStart, periodEnd } = body;

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INVESTOR_TXN_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        if (existingSync.entityType === "investor_deposit") {
          const existing = await prisma.investorDeposit.findUnique({ where: { id: existingSync.entityId } });
          if (existing) return successResponse(existing, "Deposit already synced");
        }
        if (existingSync.entityType === "investor_withdrawal") {
          const existing = await prisma.investorWithdrawal.findUnique({ where: { id: existingSync.entityId } });
          if (existing) return successResponse(existing, "Withdrawal already synced");
        }
        if (existingSync.entityType === "profit_allocation") {
          const existing = await prisma.profitAllocation.findUnique({ where: { id: existingSync.entityId } });
          if (existing) return successResponse(existing, "Profit allocation already synced");
        }
      }
    }

    if (!type || !accountId || !amount || !date) return errorResponse("VALIDATION", "type, accountId, amount, date are required", 400);
    if (parseFloat(amount) <= 0) return errorResponse("VALIDATION", "Amount must be greater than 0", 400);

    // Verify account belongs to this investor
    const account = await prisma.investorAccount.findFirst({ where: { id: parseInt(accountId), investorId } });
    if (!account) return errorResponse("NOT_FOUND", "Account not found", 404);

    if (type === "deposit") {
      const record = await prisma.$transaction(async (tx) => {
        const created = await tx.investorDeposit.create({
          data: {
            accountId: parseInt(accountId),
            amount: parseFloat(amount),
            depositDate: new Date(date),
            notes: notes?.trim() || null,
            createdBy: user.userId,
          },
        });
        if (syncMeta) {
          await tx.syncRequest.create({
            data: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: INVESTOR_TXN_SYNC_MODULE,
              requestId: syncMeta.requestId,
              deviceId: syncMeta.deviceId,
              entityType: "investor_deposit",
              entityId: created.id,
              createdBy: user.userId,
            },
          });
        }
        return created;
      });
      return successResponse(record, "Deposit recorded", 201);
    }

    if (type === "withdrawal") {
      // Validate capital won't go negative
      const [deposits, withdrawals] = await Promise.all([
        prisma.investorDeposit.aggregate({ where: { accountId: parseInt(accountId) }, _sum: { amount: true } }),
        prisma.investorWithdrawal.aggregate({ where: { accountId: parseInt(accountId) }, _sum: { amount: true } }),
      ]);
      const capital = Number(deposits._sum.amount ?? 0) - Number(withdrawals._sum.amount ?? 0);
      if (parseFloat(amount) > capital) {
        return errorResponse("VALIDATION", `Withdrawal amount (${amount}) exceeds available capital (${capital})`, 400);
      }
      const record = await prisma.$transaction(async (tx) => {
        const created = await tx.investorWithdrawal.create({
          data: {
            accountId: parseInt(accountId),
            amount: parseFloat(amount),
            withdrawalDate: new Date(date),
            notes: notes?.trim() || null,
            createdBy: user.userId,
          },
        });
        if (syncMeta) {
          await tx.syncRequest.create({
            data: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: INVESTOR_TXN_SYNC_MODULE,
              requestId: syncMeta.requestId,
              deviceId: syncMeta.deviceId,
              entityType: "investor_withdrawal",
              entityId: created.id,
              createdBy: user.userId,
            },
          });
        }
        return created;
      });
      return successResponse(record, "Withdrawal recorded", 201);
    }

    if (type === "profit") {
      if (!periodStart || !periodEnd) return errorResponse("VALIDATION", "periodStart and periodEnd are required for profit allocation", 400);
      const record = await prisma.$transaction(async (tx) => {
        const created = await tx.profitAllocation.create({
          data: {
            accountId: parseInt(accountId),
            amount: parseFloat(amount),
            allocationDate: new Date(date),
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            notes: notes?.trim() || null,
            createdBy: user.userId,
          },
        });
        if (syncMeta) {
          await tx.syncRequest.create({
            data: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: INVESTOR_TXN_SYNC_MODULE,
              requestId: syncMeta.requestId,
              deviceId: syncMeta.deviceId,
              entityType: "profit_allocation",
              entityId: created.id,
              createdBy: user.userId,
            },
          });
        }
        return created;
      });
      return successResponse(record, "Profit allocated", 201);
    }

    return errorResponse("VALIDATION", "type must be deposit, withdrawal, or profit", 400);
  } catch (e) {
    if (syncMeta && isSyncRequestDuplicateError(e)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INVESTOR_TXN_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        if (existingSync.entityType === "investor_deposit") {
          const existing = await prisma.investorDeposit.findUnique({ where: { id: existingSync.entityId } });
          if (existing) return successResponse(existing, "Deposit already synced");
        }
        if (existingSync.entityType === "investor_withdrawal") {
          const existing = await prisma.investorWithdrawal.findUnique({ where: { id: existingSync.entityId } });
          if (existing) return successResponse(existing, "Withdrawal already synced");
        }
        if (existingSync.entityType === "profit_allocation") {
          const existing = await prisma.profitAllocation.findUnique({ where: { id: existingSync.entityId } });
          if (existing) return successResponse(existing, "Profit allocation already synced");
        }
      }
    }
    console.error(e);
    return serverError();
  }
});

// ─── PATCH /api/v1/investors/[id]/transactions — edit amount/date/notes ───────
export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const { type, transactionId, amount, date, notes } = body;

    if (!transactionId || !type) return errorResponse("VALIDATION", "type and transactionId are required", 400);
    if (amount !== undefined && parseFloat(amount) <= 0) return errorResponse("VALIDATION", "Amount must be > 0", 400);

    const id = parseInt(transactionId);

    if (type === "deposit") {
      const record = await prisma.investorDeposit.update({
        where: { id },
        data: {
          ...(amount !== undefined && { amount: parseFloat(amount) }),
          ...(date !== undefined && { depositDate: new Date(date) }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
        },
      });
      return successResponse(record, "Deposit updated");
    }

    if (type === "withdrawal") {
      // If updating amount, verify new amount won't exceed available capital
      if (amount !== undefined) {
        const existing = await prisma.investorWithdrawal.findUnique({ where: { id }, select: { accountId: true } });
        if (existing) {
          const [deposits, otherWithdrawals] = await Promise.all([
            prisma.investorDeposit.aggregate({ where: { accountId: existing.accountId }, _sum: { amount: true } }),
            prisma.investorWithdrawal.aggregate({ where: { accountId: existing.accountId, id: { not: id } }, _sum: { amount: true } }),
          ]);
          const capital = Number(deposits._sum.amount ?? 0) - Number(otherWithdrawals._sum.amount ?? 0);
          if (parseFloat(amount) > capital) {
            return errorResponse("VALIDATION", `Withdrawal amount (${amount}) exceeds available capital (${capital})`, 400);
          }
        }
      }
      const record = await prisma.investorWithdrawal.update({
        where: { id },
        data: {
          ...(amount !== undefined && { amount: parseFloat(amount) }),
          ...(date !== undefined && { withdrawalDate: new Date(date) }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
        },
      });
      return successResponse(record, "Withdrawal updated");
    }

    if (type === "profit") {
      const record = await prisma.profitAllocation.update({
        where: { id },
        data: {
          ...(amount !== undefined && { amount: parseFloat(amount) }),
          ...(date !== undefined && { allocationDate: new Date(date) }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
        },
      });
      return successResponse(record, "Profit updated");
    }

    return errorResponse("VALIDATION", "type must be deposit, withdrawal, or profit", 400);
  } catch (e) {
    console.error(e);
    return serverError();
  }
});

// ─── DELETE /api/v1/investors/[id]/transactions ────────────────────────────
// Body: { type, transactionId }
export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const { type, transactionId } = body;

    if (type === "deposit") {
      await prisma.investorDeposit.delete({ where: { id: parseInt(transactionId) } });
    } else if (type === "withdrawal") {
      await prisma.investorWithdrawal.delete({ where: { id: parseInt(transactionId) } });
    } else if (type === "profit") {
      await prisma.profitAllocation.delete({ where: { id: parseInt(transactionId) } });
    } else {
      return errorResponse("VALIDATION", "Invalid type", 400);
    }

    return successResponse(null, "Transaction deleted");
  } catch (e) {
    console.error(e);
    return serverError();
  }
});
