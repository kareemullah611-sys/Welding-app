import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createWithdrawalSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { isAfghanistanCountry } from "@/lib/country-code";

const WITHDRAWAL_SYNC_MODULE = "personal_withdrawals.create";

function formatWithdrawalCreateResponse(withdrawal: any) {
  return {
    id: withdrawal.id,
    withdrawalDate: withdrawal.withdrawalDate.toISOString().split("T")[0],
    amount: Number(withdrawal.amount),
    detail: withdrawal.detail,
    withdrawnBy: withdrawal.withdrawnBy,
    sourceType: (withdrawal as any).sourceType ?? "cash_office",
    chequePaymentId: (withdrawal as any).chequePaymentId ?? null,
    bankAccountId: (withdrawal as any).bankAccountId ?? null,
    bankAccount: (withdrawal as any).bankAccount ?? null,
    approvedBy: withdrawal.approver ? { id: withdrawal.approver.id, fullName: withdrawal.approver.fullName } : null,
    approvedAt: withdrawal.approvedAt ? withdrawal.approvedAt.toISOString() : null,
    hajiTransferId: withdrawal.hajiTransferId ?? null,
    currency: { id: withdrawal.currency.id, code: withdrawal.currency.code, symbol: withdrawal.currency.symbol },
    createdBy: withdrawal.creator,
  };
}

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateToExclusive } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const approvalStatus = searchParams.get("approval_status");
    const query = (searchParams.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericSearchText = normalizedQuery.replace(/,/g, "");
    const numericQuery = Number(numericSearchText);
    const hasNumericQuery = Number.isFinite(numericQuery);
    const decimalPlaces = numericSearchText.includes(".") ? (numericSearchText.split(".")[1] || "").length : 0;
    const numericQueryUpper = hasNumericQuery
      ? numericQuery + (decimalPlaces > 0 ? Math.pow(10, -decimalPlaces) : 1)
      : NaN;
    const queryWantsPending = shouldApplySearch && normalizedQuery === "pending";
    const queryWantsApproved = shouldApplySearch && normalizedQuery === "approved";
    const sourceTypeQuery = ["cash_office", "cheque", "bank_account"].includes(normalizedQuery) ? normalizedQuery : null;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (approvalStatus === "pending") where.approvedAt = null;
    if (approvalStatus === "approved") where.approvedAt = { not: null };
    if (dateFrom || dateToExclusive) {
      where.withdrawalDate = {};
      if (dateFrom) where.withdrawalDate.gte = dateFrom;
      if (dateToExclusive) where.withdrawalDate.lt = dateToExclusive;
    }
    if (shouldApplySearch) {
      where.OR = [
        { detail: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        { withdrawnBy: { contains: query, mode: "insensitive" } },
        ...(sourceTypeQuery ? [{ sourceType: sourceTypeQuery }] : []),
        { currency: { code: { contains: query, mode: "insensitive" } } },
        { creator: { fullName: { contains: query, mode: "insensitive" } } },
        { approver: { fullName: { contains: query, mode: "insensitive" } } },
        ...(queryWantsPending ? [{ approvedAt: null }] : []),
        ...(queryWantsApproved ? [{ approvedAt: { not: null } }] : []),
        ...(hasNumericQuery
          ? [
              { amount: { gte: numericQuery, lt: numericQueryUpper } },
              { id: Math.trunc(numericQuery) },
            ]
          : []),
      ];
    }

    const [withdrawals, total] = await Promise.all([
      prisma.personalWithdrawal.findMany({
        where,
        include: {
          currency: true,
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          creator: { select: { id: true, fullName: true } },
          approver: { select: { id: true, fullName: true } },
        },
        orderBy: { withdrawalDate: "desc" },
        skip, take: limit,
      }),
      prisma.personalWithdrawal.count({ where }),
    ]);

    return paginatedResponse(
      withdrawals.map((w) => ({
        id: w.id, cityId: w.cityId,
        withdrawalDate: w.withdrawalDate.toISOString().split("T")[0],
        amount: Number(w.amount),
        detail: w.detail,
        withdrawnBy: w.withdrawnBy,
        notes: w.notes,
        sourceType: (w as any).sourceType ?? "cash_office",
        chequePaymentId: (w as any).chequePaymentId ?? null,
        bankAccountId: (w as any).bankAccountId ?? null,
        bankAccount: (w as any).bankAccount ?? null,
        approvedBy: w.approver ? { id: w.approver.id, fullName: w.approver.fullName } : null,
        approvedAt: w.approvedAt ? w.approvedAt.toISOString() : null,
        hajiTransferId: w.hajiTransferId,
        currency: { id: w.currency.id, code: w.currency.code, symbol: w.currency.symbol },
        createdBy: w.creator,
      })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can record withdrawals", 403);
    const syncMeta = getSyncRequestMeta(request);
    const body = await request.json();
    if (body?.sourceType === "cheque" || body?.chequePaymentId) {
      return errorResponse("VALIDATION_ERROR", "Cheque is no longer a valid withdrawal source");
    }
    const parsed = createWithdrawalSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    const cityId = user.cityId!;
    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: WITHDRAWAL_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingWithdrawal = await prisma.personalWithdrawal.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: {
            currency: true,
            bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
            creator: { select: { id: true, fullName: true } },
            approver: { select: { id: true, fullName: true } },
          },
        });
        if (existingWithdrawal) {
          return successResponse(formatWithdrawalCreateResponse(existingWithdrawal), "Withdrawal already synced");
        }
      }
    }

    const city = await prisma.city.findUnique({ where: { id: cityId }, include: { country: true } });
    const { withdrawalDate, amount, currencyId, detail, withdrawnBy, notes } = parsed.data;
    const sourceType: "cash_office" | "bank_account" = parsed.data.sourceType ?? "cash_office";
    const bankAccountId = parsed.data.bankAccountId ?? undefined;

    if (isAfghanistanCountry(city?.country) && sourceType !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city withdrawals can only use office cash");
    }

    if (sourceType === "bank_account" && !bankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Bank account is required when source is bank account");
    }
    if (sourceType !== "bank_account" && bankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Bank account can only be selected when source is bank account");
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      if (sourceType === "bank_account" && bankAccountId) {
        const bankAccount = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
        if (!bankAccount) throw new Error("BANK_NOT_FOUND");
        if (bankAccount.cityId !== cityId) throw new Error("BANK_FORBIDDEN");
        if (!bankAccount.isActive) throw new Error("BANK_INACTIVE");
      }

      const resolvedCurrencyId = currencyId;
      const cityCurrency = await tx.cityCurrency.findFirst({ where: { cityId, currencyId: resolvedCurrencyId } });
      if (!cityCurrency) throw new Error("CURRENCY_NOT_SUPPORTED");

      const createdWithdrawal = await tx.personalWithdrawal.create({
        data: {
          cityId,
          withdrawalDate: new Date(withdrawalDate),
          amount,
          currencyId: resolvedCurrencyId,
          detail,
          withdrawnBy,
          notes,
          sourceType,
          ...(bankAccountId !== undefined ? { bankAccountId } : {}),
          createdBy: user.userId,
        } as any,
        include: {
          currency: true,
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          creator: { select: { id: true, fullName: true } },
        },
      }) as any;

      await createAuditLog(user.userId, cityId, "personal_withdrawals", createdWithdrawal.id, "create", undefined, { amount, detail, withdrawnBy, sourceType, bankAccountId }, getClientIP(request), tx);
      // Fix C7: do NOT post the WDRAW journal at create-time. Posted at approval time.

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: WITHDRAWAL_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "personal_withdrawals",
            entityId: createdWithdrawal.id,
            createdBy: user.userId,
          },
        });
      }

      return createdWithdrawal;
    });

    return successResponse(formatWithdrawalCreateResponse(withdrawal), "Withdrawal recorded", 201);
  } catch (error: any) {
    const syncMeta = getSyncRequestMeta(request);
    const cityId = user.role === "city_admin" ? user.cityId! : null;
    if (syncMeta && cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: WITHDRAWAL_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingWithdrawal = await prisma.personalWithdrawal.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: {
            currency: true,
            bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
            creator: { select: { id: true, fullName: true } },
            approver: { select: { id: true, fullName: true } },
          },
        });
        if (existingWithdrawal) {
          return successResponse(formatWithdrawalCreateResponse(existingWithdrawal), "Withdrawal already synced");
        }
      }
    }
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
    if (error?.message === "CHEQUE_NOT_OUR_ACCOUNT") return errorResponse("VALIDATION_ERROR", "Only in-hand company cheques can fund a withdrawal");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return errorResponse("CONFLICT", "Cheque is no longer available for withdrawal", 409);
    if (error?.message === "BANK_NOT_FOUND") return errorResponse("NOT_FOUND", "Bank account not found", 404);
    if (error?.message === "BANK_FORBIDDEN") return errorResponse("FORBIDDEN", "Bank account does not belong to your city", 403);
    if (error?.message === "BANK_INACTIVE") return errorResponse("VALIDATION_ERROR", "Bank account is inactive");
    if (typeof error?.message === "string" && error.message.startsWith("CHEQUE_AMOUNT_MISMATCH:")) {
      const chequeAmount = Number(error.message.split(":")[1] || 0);
      return errorResponse("VALIDATION_ERROR", `Withdrawal amount must match the selected cheque amount of ${chequeAmount}`);
    }
    if (error?.message === "CURRENCY_NOT_SUPPORTED") return errorResponse("VALIDATION_ERROR", "Currency not supported");
    return serverError();
  }
});
