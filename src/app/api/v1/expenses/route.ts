import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalExpenseCreated, journalForeignCustomerReceiptMovements, journalForeignExpenseMovements, journalPaymentReceived } from "@/lib/accounting";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createExpenseSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { isAfghanistanCountry } from "@/lib/country-code";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import {
  foreignCurrencyOwnerKey,
  settleForeignCurrencyAsset,
  settleForeignCurrencyOutflow,
} from "@/lib/foreign-currency-carrying-db";
import { resolveAfghanistanFxRateFromDb } from "@/lib/sarafi-af-snapshot-db";

const EXPENSE_SYNC_MODULE = "expenses.create";

function formatExpenseCreateResponse(expense: any) {
  return {
    id: expense.id, lotNumber: expense.lot?.lotNumber ?? null,
    expenseDate: expense.expenseDate.toISOString().split("T")[0],
    amount: Number(expense.amount), detail: expense.detail,
    paidFrom: expense.paidFrom ?? "cash_office",
    bankAccountId: expense.bankAccountId ?? null,
    chequePaymentId: (expense as any).chequePaymentId ?? null,
    customerPaymentId: (expense as any).customerPaymentId ?? null,
    customerPayment: (expense as any).customerPayment ? {
      id: (expense as any).customerPayment.id,
      customerId: (expense as any).customerPayment.customerId,
      customer: (expense as any).customerPayment.customer,
    } : null,
    currency: { id: expense.currency.id, code: expense.currency.code, symbol: expense.currency.symbol },
    createdBy: expense.creator,
  };
}

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateToExclusive } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;
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
    const paidFromQuery = ["cash_office", "bank_account", "cheque", "customer"].includes(normalizedQuery)
      ? normalizedQuery
      : null;

    const where: any = {
      deletedAt: null, // exclude soft-deleted expenses
    };
    if (cityId) where.cityId = cityId;
    if (lotId) where.lotId = lotId;
    if (dateFrom || dateToExclusive) {
      where.expenseDate = {};
      if (dateFrom) where.expenseDate.gte = dateFrom;
      if (dateToExclusive) where.expenseDate.lt = dateToExclusive;
    }
    if (shouldApplySearch) {
      where.OR = [
        { detail: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
        { currency: { code: { contains: query, mode: "insensitive" } } },
        { creator: { fullName: { contains: query, mode: "insensitive" } } },
        { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
        { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
        ...(paidFromQuery ? [{ paidFrom: paidFromQuery }] : []),
        ...(hasNumericQuery
          ? [
              { amount: { gte: numericQuery, lt: numericQueryUpper } },
              { id: Math.trunc(numericQuery) },
            ]
          : []),
      ];
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
          customerPayment: {
            select: {
              id: true,
              customerId: true,
              customer: { select: { id: true, name: true } },
            },
          },
        } as any,
        orderBy: { expenseDate: "desc" },
        skip, take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return paginatedResponse(
      expenses.map((e: any) => ({
        id: e.id, cityId: e.cityId, lotId: e.lotId,
        lotNumber: e.lot?.lotNumber ?? null,
        expenseDate: e.expenseDate.toISOString().split("T")[0],
        amount: Number(e.amount), detail: e.detail, notes: e.notes,
        paidFrom: e.paidFrom ?? "cash_office",
        bankAccountId: e.bankAccountId ?? null,
        bankAccount: e.bankAccount ? { id: e.bankAccount.id, bankName: e.bankAccount.bankName } : null,
        chequePaymentId: (e as any).chequePaymentId ?? null,
        customerPaymentId: (e as any).customerPaymentId ?? null,
        customerPayment: (e as any).customerPayment ?? null,
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
    const syncMeta = getSyncRequestMeta(request);
    const body = await request.json();
    const parsed = createExpenseSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid expense data", parsed.error.errors);

    const cityId = user.cityId!;
    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: EXPENSE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingExpense = await prisma.expense.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: {
            lot: { select: { id: true, lotNumber: true } },
            currency: true,
            creator: { select: { id: true, fullName: true } },
          } as any,
        });
        if (existingExpense) {
          return successResponse(formatExpenseCreateResponse(existingExpense), "Expense already synced");
        }
      }
    }

    const city = await prisma.city.findUnique({ where: { id: cityId }, include: { country: true } });
    const { expenseDate, amount, currencyId, detail, notes, paidFrom, customerId, bankAccountId, chequePaymentId } = parsed.data;
    if (!currencyId) return errorResponse("VALIDATION_ERROR", "Currency is required", 400);
    const expenseCurrency = await prisma.currency.findUnique({ where: { id: currencyId } });
    if (!expenseCurrency) return errorResponse("NOT_FOUND", "Currency not found", 404);
    const foreignExpenseRate = isAfghanistanCountry(city?.country) && isSupportedForeignCurrency(expenseCurrency.code)
      ? await resolveAfghanistanFxRateFromDb({
          currencyCode: expenseCurrency.code,
          transactionDate: new Date(expenseDate),
          purpose: "settlement",
          positionKind: "asset",
        })
      : null;
    if (foreignExpenseRate && !foreignExpenseRate.ok) {
      return errorResponse("FX_RATE_REQUIRED", foreignExpenseRate.missingReason, 400);
    }

    let expensePaymentFifoLotId: number | null = null;
    if (paidFrom === "customer" && city?.country) {
      const fifoLot = await prisma.lot.findFirst({
        where: { status: "ongoing", countryId: city.country.id, lotCityDistributions: { some: { cityId } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      expensePaymentFifoLotId = fifoLot?.id ?? null;
    }

    if (isAfghanistanCountry(city?.country) && !["cash_office", "customer"].includes(paidFrom)) {
      return errorResponse("VALIDATION_ERROR", "Afghanistan city expenses can only be paid from office cash");
    }

    if (paidFrom === "customer" && !customerId) {
      return errorResponse("VALIDATION_ERROR", "Customer is required when expense is paid by customer");
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
    if (paidFrom === "customer" && customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, cityId, isActive: true } });
      if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city", 404);
    }

    const expense = await prisma.$transaction(async (tx) => {
      let chequePayment: any = null;
      if (paidFrom === "cheque" && chequePaymentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${32002}::int, ${chequePaymentId}::int)`;
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

      let customerPaymentId: number | null = null;
      if (paidFrom === "customer" && customerId) {
        const customerPayment = await tx.payment.create({
          data: {
            cityId,
            customerId,
            lotId: expensePaymentFifoLotId,
            paymentDate: new Date(expenseDate),
            amount: resolvedAmount,
            currencyId: (resolvedCurrencyId ?? cityCurrency.currencyId) as number,
            detail: "cash- expense",
            paymentMethod: "cash",
            destination: "our_account",
            notes,
            createdBy: user.userId,
          } as any,
        });
        customerPaymentId = customerPayment.id;
      }

      if (paidFrom === "cheque" && chequePaymentId) {
        const claimed = await tx.payment.updateMany({
          where: { id: chequePaymentId, chequeStatus: "in_hand" as any },
          data: { chequeStatus: "used_for_expense" } as any,
        });
        if (claimed.count !== 1) throw new Error("CHEQUE_ALREADY_USED");
      }

      const createdExpense = await tx.expense.create({
        data: {
          cityId, lotId: null, expenseDate: new Date(expenseDate), amount: resolvedAmount,
          currencyId: (resolvedCurrencyId ?? cityCurrency.currencyId) as number, detail, notes, createdBy: user.userId,
          ...(paidFrom !== "cash_office" ? { paidFrom } : {}),
          ...(bankAccountId != null ? { bankAccountId } : {}),
          ...(chequePaymentId != null ? { chequePaymentId } : {}),
          ...(customerPaymentId != null ? { customerPaymentId } : {}),
        } as any,
        include: {
          lot: { select: { id: true, lotNumber: true } },
          currency: true,
          creator: { select: { id: true, fullName: true } },
          customerPayment: { include: { customer: { select: { id: true, name: true } } } },
        },
      }) as any;

      if (paidFrom === "customer" && customerId && customerPaymentId) {
        if (foreignExpenseRate?.ok) {
          const receipt = await settleForeignCurrencyAsset(tx, {
            sourceOwnerKey: foreignCurrencyOwnerKey.customerReceivable(customerId),
            targetOwnerKey: foreignCurrencyOwnerKey.cityCash(cityId),
            targetPositionType: "city_cash",
            currencyCode: createdExpense.currency.code,
            amount: Number(createdExpense.amount),
            sourceType: "expense_customer_payment",
            sourceId: customerPaymentId,
            settlementDate: createdExpense.expenseDate,
            settlementRate: {
              ratePkr: foreignExpenseRate.rate,
              rateType: foreignExpenseRate.selectedRateType,
              provider: foreignExpenseRate.provider,
              reference: foreignExpenseRate.providerReference,
              conversionPath: foreignExpenseRate.conversionPath,
            },
            createdBy: user.userId,
          });
          await journalForeignCustomerReceiptMovements({
            paymentId: customerPaymentId,
            customerId,
            cityId,
            lotId: expensePaymentFifoLotId,
            paymentDate: createdExpense.expenseDate,
            createdBy: user.userId,
            movements: receipt.movements,
          }, tx);
        } else {
          await journalPaymentReceived({
            id: customerPaymentId,
            customerId,
            cityId,
            lotId: expensePaymentFifoLotId,
            amount: Number(createdExpense.amount),
            currencyCode: createdExpense.currency.code,
            paymentDate: createdExpense.expenseDate,
            createdBy: user.userId,
            destination: "our_account",
            paymentMethod: "cash",
          }, tx);
        }
      }

      await createAuditLog(user.userId, cityId, "expenses", createdExpense.id, "create", undefined, {
        date: expenseDate,
        detail,
        amount: `${createdExpense.currency.symbol || createdExpense.currency.code} ${Number(resolvedAmount).toLocaleString("en-US")}`,
        ...(notes ? { notes } : {}),
      }, getClientIP(request), tx);

      if (foreignExpenseRate?.ok) {
        const outflow = await settleForeignCurrencyOutflow(tx, {
          sourceOwnerKey: foreignCurrencyOwnerKey.cityCash(cityId),
          currencyCode: createdExpense.currency.code,
          amount: Number(createdExpense.amount),
          sourceType: "expense",
          sourceId: createdExpense.id,
          settlementDate: createdExpense.expenseDate,
          settlementRate: {
            ratePkr: foreignExpenseRate.rate,
            rateType: foreignExpenseRate.selectedRateType,
            provider: foreignExpenseRate.provider,
            reference: foreignExpenseRate.providerReference,
            conversionPath: foreignExpenseRate.conversionPath,
          },
          createdBy: user.userId,
        });
        await journalForeignExpenseMovements({
          expenseId: createdExpense.id,
          cityId,
          expenseDate: createdExpense.expenseDate,
          detail,
          createdBy: user.userId,
          paidFrom: "cash_office",
          movements: outflow.movements,
        }, tx);
      } else {
        await journalExpenseCreated({ id: createdExpense.id, cityId, lotId: null, amount: Number(createdExpense.amount), currencyCode: createdExpense.currency.code, detail, expenseDate: createdExpense.expenseDate, createdBy: user.userId, paidFrom: paidFrom ?? "cash_office", bankAccountId: bankAccountId ?? null }, tx);
      }

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: EXPENSE_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "expenses",
            entityId: createdExpense.id,
            createdBy: user.userId,
          },
        });
      }

      return createdExpense;
    });

    return successResponse(formatExpenseCreateResponse(expense), "Expense recorded", 201);
  } catch (error: any) {
    const syncMeta = getSyncRequestMeta(request);
    const cityId = user.role === "city_admin" ? user.cityId! : null;
    if (syncMeta && cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: EXPENSE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingExpense = await prisma.expense.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: {
            lot: { select: { id: true, lotNumber: true } },
            currency: true,
            creator: { select: { id: true, fullName: true } },
          } as any,
        });
        if (existingExpense) {
          return successResponse(formatExpenseCreateResponse(existingExpense), "Expense already synced");
        }
      }
    }
    if (error?.message === "CHEQUE_NOT_FOUND") return errorResponse("NOT_FOUND", "Cheque payment not found", 404);
    if (error?.message === "CHEQUE_FORBIDDEN") return errorResponse("FORBIDDEN", "Cheque payment does not belong to your city", 403);
    if (error?.message === "CHEQUE_NOT_CHEQUE") return errorResponse("VALIDATION_ERROR", "Referenced payment is not a cheque payment");
    if (error?.message === "CHEQUE_NOT_OUR_ACCOUNT") return errorResponse("VALIDATION_ERROR", "Only in-hand company cheques can fund an expense");
    if (error?.message === "CHEQUE_NOT_IN_HAND" || error?.message === "CHEQUE_ALREADY_USED") return errorResponse("CONFLICT", "Cheque is no longer available for expense use", 409);
    if (error?.message === "CURRENCY_NOT_SUPPORTED") return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");
    return serverError();
  }
});
