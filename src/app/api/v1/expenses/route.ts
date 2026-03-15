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
          bankAccount: { select: { id: true, bankName: true } },
        } as any,
        orderBy: { expenseDate: "desc" },
        skip, take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return paginatedResponse(
      expenses.map((e: any) => ({
        id: e.id, cityId: e.cityId, lotId: e.lotId,
        lotNumber: e.lot.lotNumber,
        expenseDate: e.expenseDate.toISOString().split("T")[0],
        amount: Number(e.amount), detail: e.detail, notes: e.notes,
        paidFrom: e.paidFrom ?? "cash_office",
        bankAccountId: e.bankAccountId ?? null,
        bankAccount: e.bankAccount ? { id: e.bankAccount.id, bankName: e.bankAccount.bankName } : null,
        currency: { id: e.currency.id, code: e.currency.code, symbol: e.currency.symbol },
        createdBy: e.creator,
        attachments: (e.attachments || []).map((a: any) => ({
          ...a,
          filePath: a.filePath.split("|||")[0],
        })),
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

    // New payment source fields
    const paidFrom: "cash_office" | "bank_account" = body.paidFrom ?? "cash_office";
    const bankAccountId: number | undefined = body.bankAccountId ? parseInt(body.bankAccountId) : undefined;

    // Validate bank account if paidFrom is bank_account
    if (paidFrom === "bank_account" && bankAccountId) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      if (!bankAccount) return errorResponse("NOT_FOUND", "Bank account not found", 404);
      if ((bankAccount as any).cityId !== cityId) return errorResponse("FORBIDDEN", "Bank account does not belong to your city", 403);
    }

    const lot = await prisma.lot.findFirst({
      where: { id: lotId ?? undefined, status: "ongoing", lotCityDistributions: { some: { cityId } } },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "Lot not found, completed, or not distributed to your city");

    const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId: currencyId ?? undefined } });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");

    const expense = await prisma.expense.create({
      data: {
        cityId, lotId: lot.id, expenseDate: new Date(expenseDate), amount,
        currencyId: currencyId as number, detail, notes, createdBy: user.userId,
        ...(paidFrom !== "cash_office" ? { paidFrom } : {}),
        ...(bankAccountId !== undefined ? { bankAccountId } : {}),
      } as any,
      include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
    }) as any;

    await createAuditLog(user.userId, cityId, "expenses", expense.id, "create", undefined, {
      date: expenseDate,
      lot: `Lot ${expense.lot.lotNumber}`,
      detail,
      amount: `${expense.currency.symbol || expense.currency.code} ${Number(amount).toLocaleString("en-US")}`,
      ...(notes ? { notes } : {}),
    }, getClientIP(request));

    try {
      await journalExpenseCreated({ id: expense.id, cityId, lotId: lot.id, amount, currencyCode: expense.currency.code, detail, expenseDate: expense.expenseDate, createdBy: user.userId });
    } catch (je) { console.error("Journal (expense):", je); }

    return successResponse({
      id: expense.id, lotNumber: expense.lot.lotNumber,
      expenseDate: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount), detail: expense.detail,
      paidFrom: expense.paidFrom ?? "cash_office",
      bankAccountId: expense.bankAccountId ?? null,
      currency: { id: expense.currency.id, code: expense.currency.code, symbol: expense.currency.symbol },
      createdBy: expense.creator,
    }, "Expense recorded", 201);
  } catch (error) {
    return serverError();
  }
});
