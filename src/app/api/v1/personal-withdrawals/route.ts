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

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (approvalStatus === "pending") where.approvedAt = null;
    if (approvalStatus === "approved") where.approvedAt = { not: null };
    if (dateFrom || dateTo) {
      where.withdrawalDate = {};
      if (dateFrom) where.withdrawalDate.gte = dateFrom;
      if (dateTo) where.withdrawalDate.lte = dateTo;
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

    let chequePayment: any = null;
    if (sourceType === "cheque" && chequePaymentId) {
      chequePayment = await prisma.payment.findUnique({ where: { id: chequePaymentId } });
      if (!chequePayment) return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
      if (chequePayment.cityId !== cityId) return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
      if ((chequePayment as any).paymentMethod !== "cheque") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
      if (chequePayment.destination !== "our_account") return errorResponse("VALIDATION_ERROR", "Only in-hand company cheques can fund a withdrawal");
      if ((chequePayment as any).chequeStatus !== "in_hand") return errorResponse("VALIDATION_ERROR", "Cheque is not in-hand status");
      const existingWithdrawal = await prisma.personalWithdrawal.findFirst({ where: { chequePaymentId } as any });
      if (existingWithdrawal) return errorResponse("CONFLICT", "This cheque has already been used for a withdrawal", 409);
    }

    const resolvedCurrencyId = chequePayment?.currencyId ?? currencyId;
    const resolvedAmount = chequePayment ? Number(chequePayment.amount) : amount;
    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: resolvedCurrencyId } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");

    const withdrawal = await prisma.personalWithdrawal.create({
      data: {
        cityId,
        withdrawalDate: new Date(withdrawalDate),
        amount: resolvedAmount,
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

    if (sourceType === "cheque" && chequePaymentId) {
      await prisma.payment.update({
        where: { id: chequePaymentId },
        data: { chequeStatus: "used_for_withdrawal" } as any,
      });
    }

    await createAuditLog(user.userId, cityId, "personal_withdrawals", withdrawal.id, "create", undefined, { amount: resolvedAmount, detail, withdrawnBy, sourceType }, getClientIP(request));

    try {
      await journalWithdrawal({ id: withdrawal.id, cityId, amount: Number(withdrawal.amount), currencyCode: withdrawal.currency.code, date: withdrawal.withdrawalDate, createdBy: user.userId, sourceType });
    } catch (je) { console.error("Journal (withdrawal):", je); }

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
  } catch (error) {
    return serverError();
  }
});
