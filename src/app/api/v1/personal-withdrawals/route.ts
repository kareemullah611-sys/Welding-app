import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalWithdrawal } from "@/lib/accounting";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createWithdrawalSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const approvalStatus = searchParams.get("approval_status");
    const query = (searchParams.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);
    const queryWantsPending = shouldApplySearch && normalizedQuery === "pending";
    const queryWantsApproved = shouldApplySearch && normalizedQuery === "approved";
    const sourceTypeQuery = ["cash_office", "cheque"].includes(normalizedQuery) ? normalizedQuery : null;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (approvalStatus === "pending") where.approvedAt = null;
    if (approvalStatus === "approved") where.approvedAt = { not: null };
    if (dateFrom || dateTo) {
      where.withdrawalDate = {};
      if (dateFrom) where.withdrawalDate.gte = dateFrom;
      if (dateTo) where.withdrawalDate.lte = dateTo;
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
        ...(hasNumericQuery ? [{ amount: numericQuery }, { id: Math.trunc(numericQuery) }] : []),
      ];
    }

    const [withdrawals, total] = await Promise.all([
      prisma.personalWithdrawal.findMany({
        where,
        include: {
          currency: true,
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
    const body = await request.json();
    const parsed = createWithdrawalSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    const cityId = user.cityId!;
    const city = await prisma.city.findUnique({ where: { id: cityId }, include: { country: true } });
    const { withdrawalDate, amount, currencyId, detail, withdrawnBy, notes } = parsed.data;
    const sourceType: "cash_office" | "cheque" = body.sourceType ?? "cash_office";
    const chequePaymentId: number | undefined = body.chequePaymentId ? parseInt(body.chequePaymentId) : undefined;

    if (city?.country?.name === "Afghanistan" && sourceType !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city withdrawals can only use office cash");
    }

    if (sourceType === "cheque" && !chequePaymentId) {
      return errorResponse("VALIDATION_ERROR", "Cheque is required when source is cheque");
    }

    const withdrawal = await prisma.$transaction(async (tx) => {
      let chequePayment: any = null;
      if (sourceType === "cheque" && chequePaymentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${32001}, ${chequePaymentId})`;
        chequePayment = await tx.payment.findUnique({ where: { id: chequePaymentId } });
        if (!chequePayment) throw new Error("CHEQUE_NOT_FOUND");
        if (chequePayment.cityId !== cityId) throw new Error("CHEQUE_FORBIDDEN");
        if ((chequePayment as any).paymentMethod !== "cheque") throw new Error("CHEQUE_NOT_CHEQUE");
        if (chequePayment.destination !== "our_account") throw new Error("CHEQUE_NOT_OUR_ACCOUNT");
        if ((chequePayment as any).chequeStatus !== "in_hand") throw new Error("CHEQUE_NOT_IN_HAND");
        if (Number(chequePayment.amount) !== Number(amount)) throw new Error(`CHEQUE_AMOUNT_MISMATCH:${Number(chequePayment.amount)}`);
      }

      const resolvedCurrencyId = chequePayment?.currencyId ?? currencyId;
      const cityCurrency = await tx.cityCurrency.findFirst({ where: { cityId, currencyId: resolvedCurrencyId } });
      if (!cityCurrency) throw new Error("CURRENCY_NOT_SUPPORTED");

      if (sourceType === "cheque" && chequePaymentId) {
        const claimed = await tx.payment.updateMany({
          where: { id: chequePaymentId, chequeStatus: "in_hand" as any },
          data: { chequeStatus: "used_for_withdrawal" } as any,
        });
        if (claimed.count !== 1) throw new Error("CHEQUE_ALREADY_USED");
      }

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
          ...(chequePaymentId !== undefined ? { chequePaymentId } : {}),
          createdBy: user.userId,
        } as any,
        include: {
          currency: true,
          creator: { select: { id: true, fullName: true } },
        },
      }) as any;

      await createAuditLog(user.userId, cityId, "personal_withdrawals", createdWithdrawal.id, "create", undefined, { amount, detail, withdrawnBy, sourceType }, getClientIP(request), tx);
      await journalWithdrawal({ id: createdWithdrawal.id, cityId, amount: Number(createdWithdrawal.amount), currencyCode: createdWithdrawal.currency.code, date: createdWithdrawal.withdrawalDate, createdBy: user.userId, sourceType }, tx);
      return createdWithdrawal;
    });

    return successResponse({
      id: withdrawal.id,
      withdrawalDate: withdrawal.withdrawalDate.toISOString().split("T")[0],
      amount: Number(withdrawal.amount),
      detail: withdrawal.detail,
      withdrawnBy: withdrawal.withdrawnBy,
      sourceType: (withdrawal as any).sourceType ?? "cash_office",
      chequePaymentId: (withdrawal as any).chequePaymentId ?? null,
      approvedBy: null,
      approvedAt: null,
      hajiTransferId: null,
      currency: { id: withdrawal.currency.id, code: withdrawal.currency.code, symbol: withdrawal.currency.symbol },
      createdBy: withdrawal.creator,
    }, "Withdrawal recorded", 201);
  } catch (error: any) {
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
    if (error?.message === "CHEQUE_NOT_OUR_ACCOUNT") return errorResponse("VALIDATION_ERROR", "Only in-hand company cheques can fund a withdrawal");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return errorResponse("CONFLICT", "Cheque is no longer available for withdrawal", 409);
    if (typeof error?.message === "string" && error.message.startsWith("CHEQUE_AMOUNT_MISMATCH:")) {
      const chequeAmount = Number(error.message.split(":")[1] || 0);
      return errorResponse("VALIDATION_ERROR", `Withdrawal amount must match the selected cheque amount of ${chequeAmount}`);
    }
    if (error?.message === "CURRENCY_NOT_SUPPORTED") return errorResponse("VALIDATION_ERROR", "Currency not supported");
    return serverError();
  }
});
