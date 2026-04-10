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
        chequePaymentId: (e as any).chequePaymentId ?? null,
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
    const city = await prisma.city.findUnique({ where: { id: cityId }, include: { country: true } });
    const { lotId, expenseDate, amount, currencyId, detail, notes } = parsed.data;

    // New payment source fields
    const paidFrom: "cash_office" | "bank_account" | "cheque" = body.paidFrom ?? "cash_office";
    const bankAccountId: number | undefined = body.bankAccountId ? parseInt(body.bankAccountId) : undefined;
    const chequePaymentId: number | undefined = body.chequePaymentId ? parseInt(body.chequePaymentId) : undefined;

    if (city?.country?.name === "Afghanistan" && paidFrom !== "cash_office") {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city expenses can only be paid from office cash");
    }

    if (paidFrom === "bank_account" && !bankAccountId) {
      return errorResponse("VALIDATION_ERROR", "Bank account is required when paidFrom is bank_account");
    }
    if (paidFrom === "cheque" && !chequePaymentId) {
      return errorResponse("VALIDATION_ERROR", "Cheque is required when paidFrom is cheque");
    }

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
    const expense = await prisma.$transaction(async (tx) => {
      let chequePayment: any = null;
      if (paidFrom === "cheque" && chequePaymentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${32002}, ${chequePaymentId})`;
        chequePayment = await tx.payment.findUnique({ where: { id: chequePaymentId } });
        if (!chequePayment) throw new Error("CHEQUE_NOT_FOUND");
        if (chequePayment.cityId !== cityId) throw new Error("CHEQUE_FORBIDDEN");
        if ((chequePayment as any).paymentMethod !== "cheque") throw new Error("CHEQUE_NOT_CHEQUE");
        if (chequePayment.destination !== "our_account") throw new Error("CHEQUE_NOT_OUR_ACCOUNT");
        if ((chequePayment as any).chequeStatus !== "in_hand") throw new Error("CHEQUE_NOT_IN_HAND");
      }

      const resolvedCurrencyId = chequePayment?.currencyId ?? currencyId;
      const resolvedAmount = chequePayment ? Number(chequePayment.amount) : amount;
      const cityCurrency = await tx.cityCurrency.findFirst({ where: { cityId, currencyId: resolvedCurrencyId ?? undefined } });
      if (!cityCurrency) throw new Error("CURRENCY_NOT_SUPPORTED");

      if (paidFrom === "cheque" && chequePaymentId) {
        const claimed = await tx.payment.updateMany({
          where: { id: chequePaymentId, chequeStatus: "in_hand" as any },
          data: { chequeStatus: "used_for_expense" } as any,
        });
        if (claimed.count !== 1) throw new Error("CHEQUE_ALREADY_USED");
      }

      const createdExpense = await tx.expense.create({
        data: {
          cityId, lotId: lot.id, expenseDate: new Date(expenseDate), amount: resolvedAmount,
          currencyId: (resolvedCurrencyId ?? cityCurrency.currencyId) as number, detail, notes, createdBy: user.userId,
          ...(paidFrom !== "cash_office" ? { paidFrom } : {}),
          ...(bankAccountId !== undefined ? { bankAccountId } : {}),
          ...(chequePaymentId !== undefined ? { chequePaymentId } : {}),
        } as any,
        include: { lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
      }) as any;

      await createAuditLog(user.userId, cityId, "expenses", createdExpense.id, "create", undefined, {
        date: expenseDate,
        lot: `Lot ${createdExpense.lot.lotNumber}`,
        detail,
        amount: `${createdExpense.currency.symbol || createdExpense.currency.code} ${Number(resolvedAmount).toLocaleString("en-US")}`,
        ...(notes ? { notes } : {}),
      }, getClientIP(request), tx);

      await journalExpenseCreated({ id: createdExpense.id, cityId, lotId: lot.id, amount: Number(createdExpense.amount), currencyCode: createdExpense.currency.code, detail, expenseDate: createdExpense.expenseDate, createdBy: user.userId, paidFrom: paidFrom ?? "cash_office", bankAccountId: bankAccountId ?? null }, tx);
      return createdExpense;
    });

    return successResponse({
      id: expense.id, lotNumber: expense.lot.lotNumber,
      expenseDate: expense.expenseDate.toISOString().split("T")[0],
      amount: Number(expense.amount), detail: expense.detail,
      paidFrom: expense.paidFrom ?? "cash_office",
      bankAccountId: expense.bankAccountId ?? null,
      chequePaymentId: (expense as any).chequePaymentId ?? null,
      currency: { id: expense.currency.id, code: expense.currency.code, symbol: expense.currency.symbol },
      createdBy: expense.creator,
    }, "Expense recorded", 201);
  } catch (error: any) {
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
    if (error?.message === "CHEQUE_NOT_OUR_ACCOUNT") return errorResponse("VALIDATION_ERROR", "Only in-hand company cheques can fund an expense");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return errorResponse("CONFLICT", "Cheque is no longer available for expense use", 409);
    if (error?.message === "CURRENCY_NOT_SUPPORTED") return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");
    return serverError();
  }
});
