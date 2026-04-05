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
    const { withdrawalDate, amount, currencyId, detail, withdrawnBy, notes } = parsed.data;

    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported");

    const withdrawal = await prisma.personalWithdrawal.create({
      data: { cityId, withdrawalDate: new Date(withdrawalDate), amount, currencyId, detail, withdrawnBy, notes, createdBy: user.userId },
      include: {
        currency: true,
        creator: { select: { id: true, fullName: true } },
      },
    });

    await createAuditLog(user.userId, cityId, "personal_withdrawals", withdrawal.id, "create", undefined, { amount, detail, withdrawnBy }, getClientIP(request));

    try {
      await journalWithdrawal({ id: withdrawal.id, cityId, amount, currencyCode: withdrawal.currency.code, date: withdrawal.withdrawalDate, createdBy: user.userId });
    } catch (je) { console.error("Journal (withdrawal):", je); }

    return successResponse({
      id: withdrawal.id,
      withdrawalDate: withdrawal.withdrawalDate.toISOString().split("T")[0],
      amount: Number(withdrawal.amount),
      detail: withdrawal.detail,
      withdrawnBy: withdrawal.withdrawnBy,
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
