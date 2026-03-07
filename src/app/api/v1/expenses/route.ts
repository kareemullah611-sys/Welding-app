import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalExpenseCreated } from "@/lib/accounting";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createExpenseSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;

    const where: any = {
      deletedAt: null, // exclude soft-deleted expenses
    };
    if (cityId) where.cityId = cityId;
    if (lotId) where.lotId = lotId;
    if (dateFrom || dateTo) {
      where.expenseDate = {};
      if (dateFrom) where.expenseDate.gte = dateFrom;
      if (dateTo) where.expenseDate.lte = dateTo;
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: {
          lot: { select: { id: true, lotNumber: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
          attachments: { select: { id: true, fileName: true, filePath: true, fileType: true } },
        },
        orderBy: { expenseDate: "desc" },
        skip, take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return paginatedResponse(
      expenses.map((e) => ({
        id: e.id, cityId: e.cityId, lotId: e.lotId,
        lotNumber: e.lot.lotNumber,
        expenseDate: e.expenseDate.toISOString().split("T")[0],
        amount: Number(e.amount), detail: e.detail, notes: e.notes,
        currency: { id: e.currency.id, code: e.currency.code, symbol: e.currency.symbol },
        createdBy: e.creator,
        attachments: (e as any).attachments || [],
      })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can create expenses", 403);
    const body = await request.json();
    const parsed = createExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid expense data", parsed.error.errors);

    const cityId = user.cityId!;
    const { lotId, expenseDate, amount, currencyId, detail, notes } = parsed.data;

    const lot = await prisma.lot.findFirst({
      where: { id: lotId ?? undefined, status: "ongoing", lotCityDistributions: { some: { cityId } } },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "Lot not found, completed, or not distributed to your city");

    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: currencyId ?? undefined } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");

    const expense = await prisma.expense.create({
      data: { cityId, lotId: lotId as number, expenseDate: new Date(expenseDate), amount, currencyId: currencyId as number, detail, notes, createdBy: user.userId },
      include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
    }) as any;

    await createAuditLog(user.userId, cityId, "expenses", expense.id, "create", undefined, {
      date: expenseDate,
      lot: `Lot ${expense.lot.lotNumber}`,
      detail,
      amount: `${expense.currency.symbol || expense.currency.code} ${Number(amount).toLocaleString()}`,
      ...(notes ? { notes } : {}),
    }, getClientIP(request));

    try {
      await journalExpenseCreated({ id: expense.id, cityId, lotId: lotId!, amount, currencyCode: expense.currency.code, detail, expenseDate: expense.expenseDate, createdBy: user.userId });
    } catch (je) { console.error("Journal (expense):", je); }

    return successResponse({
      id: expense.id, lotNumber: expense.lot.lotNumber,
      expenseDate: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount), detail: expense.detail,
      currency: { id: expense.currency.id, code: expense.currency.code, symbol: expense.currency.symbol },
      createdBy: expense.creator,
    }, "Expense recorded", 201);
  } catch (error) {
    return serverError();
  }
});
