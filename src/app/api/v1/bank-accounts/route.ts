import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const scope = searchParams.get("scope");

    if (scope === "super_admin") {
      const [incomingHajiPayments, expenses] = await Promise.all([
        prisma.payment.groupBy({
          by: ["superAdminBankAccountId", "currencyId"],
          where: {
            superAdminBankAccountId: { not: null },
            destination: "haji",
            status: "active",
          },
          _sum: { amount: true },
        }),
        prisma.superAdminPersonalExpense.groupBy({
          by: ["bankAccountId"],
          where: { deletedAt: null },
          _sum: { amount: true },
        }),
      ]);
      const incomingMap = new Map<string, number>();
      for (const row of incomingHajiPayments) incomingMap.set(`${row.superAdminBankAccountId}:${row.currencyId}`, Number(row._sum.amount || 0));
      const expenseMap = new Map<number, number>();
      for (const row of expenses) expenseMap.set(row.bankAccountId, Number(row._sum.amount || 0));

      const accounts = await prisma.superAdminBankAccount.findMany({
        where: { isActive: true },
        include: {
          currency: true,
          _count: {
            select: {
              expenses: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      });

      return successResponse(
        accounts.map((a) => ({
          id: a.id,
          cityId: null,
          cityName: "Super Admin",
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          currencyId: a.currencyId,
          currency: a.currency,
          isActive: a.isActive,
          createdAt: a.createdAt.toISOString(),
          _count: {
            deposits: 0,
            hajiTransfers: 0,
            expenses: a._count.expenses,
          },
          runningBalance: Math.round((((incomingMap.get(`${a.id}:${a.currencyId}`) || 0) - (expenseMap.get(a.id) || 0)) * 100)) / 100,
          accountScope: "super_admin",
        }))
      );
    }

    const requestedCityId = searchParams.get("cityId") ? parseInt(searchParams.get("cityId")!) : undefined;
    const cityId = getCityScope(user, requestedCityId);

    const where: any = {};
    if (cityId) where.cityId = cityId;

    const scopedBankAccounts = await prisma.bankAccount.findMany({
      where,
      select: { id: true },
    });
    const scopedBankAccountIds = scopedBankAccounts.map((account) => account.id);

    const currencies = await prisma.currency.findMany({ select: { id: true, code: true } });
    const currencyCodeById = Object.fromEntries(currencies.map((currency) => [currency.id, currency.code]));

    const [paymentsIn, deposits, depositedCheques, expenses, hajiTransfers, supplierPayments] = await Promise.all([
      prisma.payment.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: {
          bankAccountId: { not: null },
          destination: "our_account",
          status: "active",
          ...(cityId ? { cityId } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.bankDeposit.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: cityId ? { cityId } : {},
        _sum: { cashAmount: true },
      }),
      prisma.payment.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: {
          bankDepositId: { not: null },
          bankAccountId: { not: null },
          status: "active",
          ...(cityId ? { cityId } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: { bankAccountId: { not: null }, deletedAt: null, ...(cityId ? { cityId } : {}) },
        _sum: { amount: true },
      }),
      prisma.hajiTransfer.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: { bankAccountId: { not: null }, sourceType: "bank_transfer", ...(cityId ? { cityId } : {}) } as any,
        _sum: { amount: true },
      }),
      prisma.supplierPayment.findMany({
        where: {
          bankAccountId: cityId
            ? { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] }
            : { not: null },
        },
        select: {
          bankAccountId: true,
          amountLocal: true,
          amountUsd: true,
          exchangeRate: true,
        },
      }),
    ]);
    const balanceByAccount = new Map<number, Record<string, number>>();
    const addBalance = (accountId: number | null, currencyId: number, amount: number) => {
      if (!accountId || !amount) return;
      const key = currencyCodeById[currencyId] || String(currencyId);
      const pot = balanceByAccount.get(accountId) || {};
      pot[key] = Math.round(((pot[key] || 0) + amount) * 100) / 100;
      balanceByAccount.set(accountId, pot);
    };
    const addBalanceByCode = (accountId: number | null, currencyCode: string, amount: number) => {
      if (!accountId || !amount) return;
      const key = String(currencyCode || "").toUpperCase() || "PKR";
      const pot = balanceByAccount.get(accountId) || {};
      pot[key] = Math.round(((pot[key] || 0) + amount) * 100) / 100;
      balanceByAccount.set(accountId, pot);
    };
    for (const row of paymentsIn) addBalance(row.bankAccountId, row.currencyId, Number(row._sum.amount || 0));
    for (const row of deposits) addBalance(row.bankAccountId, row.currencyId, Number(row._sum.cashAmount || 0));
    for (const row of depositedCheques) addBalance(row.bankAccountId, row.currencyId, Number(row._sum.amount || 0));
    for (const row of expenses) addBalance(row.bankAccountId, row.currencyId, -Number(row._sum.amount || 0));
    for (const row of hajiTransfers) addBalance(row.bankAccountId, row.currencyId, -Number(row._sum.amount || 0));
    for (const row of supplierPayments) {
      const amountLocal = Number(row.amountLocal || 0);
      const amountUsd = Number(row.amountUsd || 0);
      const exchangeRate = Number(row.exchangeRate || 0);
      const amountPkr = amountLocal > 0
        ? amountLocal
        : (exchangeRate > 0 ? amountUsd * exchangeRate : 0);
      if (amountPkr > 0) {
        addBalanceByCode(row.bankAccountId, "PKR", -amountPkr);
      } else if (amountUsd > 0) {
        // Legacy fallback where local conversion was not stored.
        addBalanceByCode(row.bankAccountId, "USD", -amountUsd);
      }
    }

    const accounts = await prisma.bankAccount.findMany({
      where,
      include: {
        city: { select: { id: true, name: true } },
        _count: {
          select: {
            deposits: true,
            hajiTransfers: true,
            expenses: true,
          },
        },
      },
      orderBy: [{ cityId: "asc" }, { createdAt: "desc" }],
    });

    return successResponse(
      accounts.map((a) => ({
        id: a.id,
        cityId: a.cityId,
        cityName: a.city.name,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
        runningBalanceByCurrency: balanceByAccount.get(a.id) || {},
        _count: {
          deposits: a._count.deposits,
          hajiTransfers: a._count.hajiTransfers,
          expenses: a._count.expenses,
        },
      }))
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role === "super_admin") {
      const body = await request.json();
      const bankName: string = (body.bankName || "").trim();
      if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName is required");
      if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");

      const accountNumber: string | null = body.accountNumber ? String(body.accountNumber).trim() : null;
      const currencyId = Number(body.currencyId);
      if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "currencyId is required");

      const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);

      const account = await prisma.superAdminBankAccount.create({
        data: {
          bankName,
          accountNumber,
          currencyId,
          isActive: true,
          createdBy: user.userId,
        },
        include: { currency: true },
      });

      await createAuditLog(
        user.userId,
        null,
        "super_admin_bank_accounts",
        account.id,
        "create",
        undefined,
        { bankName, accountNumber, currencyId },
        getClientIP(request)
      );

      return successResponse(
        {
          id: account.id,
          cityId: null,
          cityName: "Super Admin",
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          currencyId: account.currencyId,
          currency: account.currency,
          isActive: account.isActive,
          createdAt: account.createdAt.toISOString(),
          accountScope: "super_admin",
        },
        "Bank account created",
        201
      );
    }
    const body = await request.json();
    const cityId = user.cityId!;

    // Validate bankName
    const bankName: string = (body.bankName || "").trim();
    if (!bankName) {
      return errorResponse("VALIDATION_ERROR", "bankName is required");
    }
    if (bankName.length > 100) {
      return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
    }

    const accountNumber: string | null = body.accountNumber ? String(body.accountNumber).trim() : null;

    const account = await prisma.bankAccount.create({
      data: {
        cityId,
        bankName,
        accountNumber,
        isActive: true,
      },
      include: {
        city: { select: { id: true, name: true } },
      },
    });

    await createAuditLog(
      user.userId,
      cityId,
      "bank_accounts",
      account.id,
      "create",
      undefined,
      { bankName, accountNumber, cityId },
      getClientIP(request)
    );

    return successResponse(
      {
        id: account.id,
        cityId: account.cityId,
        cityName: account.city.name,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        isActive: account.isActive,
        createdAt: account.createdAt.toISOString(),
      },
      "Bank account created",
      201
    );
  } catch (error) {
    return serverError();
  }
});
