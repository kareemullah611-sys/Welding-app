import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const SUPER_ADMIN_EXPENSE_SYNC_MODULE = "super_admin_personal_expenses";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can access these expenses", 403);
    }

    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);
    const bankAccountId = searchParams.get("bank_account_id") ? Number(searchParams.get("bank_account_id")) : undefined;
    const query = (searchParams.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);

    const where: any = { deletedAt: null };
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (dateFrom || dateTo) {
      where.expenseDate = {};
      if (dateFrom) where.expenseDate.gte = dateFrom;
      if (dateTo) where.expenseDate.lte = dateTo;
    }
    if (shouldApplySearch) {
      where.OR = [
        { detail: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
        { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
        { bankAccount: { currency: { code: { contains: query, mode: "insensitive" } } } },
        { creator: { fullName: { contains: query, mode: "insensitive" } } },
        ...(hasNumericQuery ? [{ amount: numericQuery }, { id: Math.trunc(numericQuery) }] : []),
      ];
    }

    const [expenses, total] = await Promise.all([
      prisma.superAdminPersonalExpense.findMany({
        where,
        include: {
          creator: { select: { id: true, fullName: true } },
          bankAccount: { include: { currency: true } },
        },
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
        skip,
        take: limit,
      }),
      prisma.superAdminPersonalExpense.count({ where }),
    ]);

    return paginatedResponse(expenses.map((e: any) => ({
      id: e.id,
      expenseDate: e.expenseDate.toISOString().split("T")[0],
      amount: Number(e.amount),
      detail: e.detail,
      notes: e.notes,
      bankAccountId: e.bankAccountId,
      bankAccount: {
        id: e.bankAccount.id,
        bankName: e.bankAccount.bankName,
        accountNumber: e.bankAccount.accountNumber,
        currency: e.bankAccount.currency,
      },
      createdBy: e.creator,
      createdAt: e.createdAt.toISOString(),
    })), total, page, limit);
  } catch {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    if (user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only super admin can create these expenses", 403);
    }

    const body = await request.json();
    const expenseDate = String(body.expenseDate || "");
    const amount = Number(body.amount);
    const detail = String(body.detail || "").trim();
    const notes = body.notes ? String(body.notes) : null;
    const bankAccountId = Number(body.bankAccountId);

    if (!expenseDate) return errorResponse("VALIDATION_ERROR", "Date is required");
    if (!amount || Number.isNaN(amount) || amount <= 0) return errorResponse("VALIDATION_ERROR", "Amount must be greater than zero");
    if (!detail) return errorResponse("VALIDATION_ERROR", "Detail is required");
    if (!bankAccountId || Number.isNaN(bankAccountId)) return errorResponse("VALIDATION_ERROR", "Bank account is required");

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPER_ADMIN_EXPENSE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingExpense = await prisma.superAdminPersonalExpense.findUnique({
          where: { id: existingSync.entityId },
          include: { creator: { select: { id: true, fullName: true } }, bankAccount: { include: { currency: true } } },
        });
        if (existingExpense) {
          return successResponse({
            id: existingExpense.id,
            expenseDate: existingExpense.expenseDate.toISOString().split("T")[0],
            amount: Number(existingExpense.amount),
            detail: existingExpense.detail,
            notes: existingExpense.notes,
            bankAccountId: existingExpense.bankAccountId,
            bankAccount: {
              id: existingExpense.bankAccount.id,
              bankName: existingExpense.bankAccount.bankName,
              accountNumber: existingExpense.bankAccount.accountNumber,
              currency: existingExpense.bankAccount.currency,
            },
            createdBy: existingExpense.creator,
            createdAt: existingExpense.createdAt.toISOString(),
          }, "Personal expense already synced");
        }
      }
    }

    const bankAccount = await prisma.superAdminBankAccount.findUnique({
      where: { id: bankAccountId },
      include: { currency: true },
    });
    if (!bankAccount || !bankAccount.isActive) {
      return errorResponse("NOT_FOUND", "Active super admin bank account not found", 404);
    }

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.superAdminPersonalExpense.create({
        data: {
          expenseDate: new Date(expenseDate),
          amount,
          detail,
          notes,
          bankAccountId,
          createdBy: user.userId,
        },
        include: {
          creator: { select: { id: true, fullName: true } },
          bankAccount: { include: { currency: true } },
        },
      });

      await createAuditLog(
        user.userId,
        null,
        "super_admin_personal_expenses",
        created.id,
        "create",
        undefined,
        {
          expenseDate,
          amount,
          detail,
          notes,
          bankAccount: bankAccount.bankName,
          currency: bankAccount.currency.code,
        },
        getClientIP(request),
        tx
      );

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPER_ADMIN_EXPENSE_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "super_admin_personal_expenses",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({
      id: expense.id,
      expenseDate: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount),
      detail: expense.detail,
      notes: expense.notes,
      bankAccountId: expense.bankAccountId,
      bankAccount: {
        id: expense.bankAccount.id,
        bankName: expense.bankAccount.bankName,
        accountNumber: expense.bankAccount.accountNumber,
        currency: expense.bankAccount.currency,
      },
      createdBy: expense.creator,
      createdAt: expense.createdAt.toISOString(),
    }, "Personal expense recorded", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPER_ADMIN_EXPENSE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingExpense = await prisma.superAdminPersonalExpense.findUnique({
          where: { id: existingSync.entityId },
          include: { creator: { select: { id: true, fullName: true } }, bankAccount: { include: { currency: true } } },
        });
        if (existingExpense) {
          return successResponse({
            id: existingExpense.id,
            expenseDate: existingExpense.expenseDate.toISOString().split("T")[0],
            amount: Number(existingExpense.amount),
            detail: existingExpense.detail,
            notes: existingExpense.notes,
            bankAccountId: existingExpense.bankAccountId,
            bankAccount: {
              id: existingExpense.bankAccount.id,
              bankName: existingExpense.bankAccount.bankName,
              accountNumber: existingExpense.bankAccount.accountNumber,
              currency: existingExpense.bankAccount.currency,
            },
            createdBy: existingExpense.creator,
            createdAt: existingExpense.createdAt.toISOString(),
          }, "Personal expense already synced");
        }
      }
    }
    return serverError();
  }
});
