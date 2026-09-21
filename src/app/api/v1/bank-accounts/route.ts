import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { getSuperAdminCashAccountBalance } from "@/lib/haji-cash-balance";
import { getSuperAdminBankBalance } from "@/lib/settlement-validation";

const BANK_ACCOUNT_SYNC_MODULE = "bank_accounts";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const scope = searchParams.get("scope");

    if (scope === "super_admin") {
      const [openingBalances, incomingHajiPayments, expenses, intermediaryDeposits, lotCosts, supplierPayments, hajiCashReceipts, settlementPayments] = await Promise.all([
        prisma.openingSuperAdminAccountBalance.findMany({ select: { accountId: true, currencyId: true, amount: true } }),
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
        prisma.intermediaryDeposit.groupBy({
          by: ["superAdminBankAccountId", "currencyId"],
          where: { superAdminBankAccountId: { not: null }, deletedAt: null },
          _sum: { amount: true },
        }),
        prisma.lotCost.findMany({
          where: { superAdminBankAccountId: { not: null } },
          select: {
            superAdminBankAccountId: true,
            currencyCode: true,
            amount: true,
          },
        }),
        prisma.supplierPayment.findMany({
          where: { superAdminBankAccountId: { not: null } },
          select: {
            superAdminBankAccountId: true,
            amountLocal: true,
            amountUsd: true,
            exchangeRate: true,
          },
        }),
        prisma.hajiTransfer.groupBy({
          by: ["superAdminCashAccountId", "currencyId"],
          where: {
            superAdminCashAccountId: { not: null },
            settlementDestination: "super_admin_cash",
          },
          _sum: { amount: true },
        }),
        (prisma as any).investmentParticipantSettlementPayment.groupBy({
          by: ["superAdminBankAccountId", "currencyId"],
          where: { status: "settled" },
          _sum: { paymentAmount: true },
        }),
      ]);
      let incomingHajiBankRows: { superAdminBankAccountId: number; currencyId: number; amount: unknown }[] = [];
      try {
        const rows = await prisma.hajiTransfer.findMany({
          where: { superAdminBankAccountId: { not: null } },
          select: { superAdminBankAccountId: true, currencyId: true, amount: true },
        });
        incomingHajiBankRows = rows.flatMap((row) =>
          row.superAdminBankAccountId
            ? [{ superAdminBankAccountId: row.superAdminBankAccountId, currencyId: row.currencyId, amount: row.amount }]
            : []
        );
      } catch (hajiBankAggError) {
        console.error("Haji transfer bank account aggregation failed (run db bootstrap):", hajiBankAggError);
      }
      const incomingMap = new Map<string, number>();
      const openingMap = new Map<string, number>();
      for (const row of openingBalances) openingMap.set(`${row.accountId}:${row.currencyId}`, Number(row.amount || 0));
      for (const row of incomingHajiPayments) incomingMap.set(`${row.superAdminBankAccountId}:${row.currencyId}`, Number(row._sum.amount || 0));
      for (const row of incomingHajiBankRows) {
        const key = `${row.superAdminBankAccountId}:${row.currencyId}`;
        incomingMap.set(key, (incomingMap.get(key) || 0) + Number(row.amount || 0));
      }
      const expenseMap = new Map<number, number>();
      for (const row of expenses) expenseMap.set(row.bankAccountId, Number(row._sum.amount || 0));
      const intermediaryMap = new Map<string, number>();
      for (const row of intermediaryDeposits) intermediaryMap.set(`${row.superAdminBankAccountId}:${row.currencyId}`, Number(row._sum.amount || 0));
      const hajiCashMap = new Map<string, number>();
      for (const row of hajiCashReceipts) {
        if (!row.superAdminCashAccountId) continue;
        hajiCashMap.set(`${row.superAdminCashAccountId}:${row.currencyId}`, Number(row._sum.amount || 0));
      }
      const investorSettlementPaymentMap = new Map<string, number>();
      for (const row of settlementPayments) {
        investorSettlementPaymentMap.set(`${row.superAdminBankAccountId}:${row.currencyId}`, Number(row._sum.paymentAmount || 0));
      }

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

      const lotCostDebitMap = new Map<string, number>();
      for (const row of lotCosts) {
        if (!row.superAdminBankAccountId) continue;
        const account = accounts.find((a) => a.id === row.superAdminBankAccountId);
        if (!account) continue;
        const rowCurrency = String(row.currencyCode || "").toUpperCase();
        if (rowCurrency !== String(account.currency.code || "").toUpperCase()) continue;
        const key = `${row.superAdminBankAccountId}:${account.currencyId}`;
        lotCostDebitMap.set(key, (lotCostDebitMap.get(key) || 0) + Number(row.amount || 0));
      }

      const supplierPaymentDebitMap = new Map<number, number>();
      for (const row of supplierPayments) {
        if (!row.superAdminBankAccountId) continue;
        const local = Number(row.amountLocal || 0);
        if (local > 0) {
          supplierPaymentDebitMap.set(row.superAdminBankAccountId, (supplierPaymentDebitMap.get(row.superAdminBankAccountId) || 0) + local);
        }
      }

      return successResponse(
        await Promise.all(accounts.map(async (a) => {
          const isCash = a.accountKind === "cash";
          const incoming = isCash
            ? 0
            : (incomingMap.get(`${a.id}:${a.currencyId}`) || 0);
          const authoritativeBalance = await getSuperAdminBankBalance(a.id);
          const runningBalance = authoritativeBalance?.balance ?? (isCash
            ? await getSuperAdminCashAccountBalance(a.id).catch(() => 0)
            : Math.round((((openingMap.get(`${a.id}:${a.currencyId}`) || 0) + incoming - (expenseMap.get(a.id) || 0) - (intermediaryMap.get(`${a.id}:${a.currencyId}`) || 0) - (lotCostDebitMap.get(`${a.id}:${a.currencyId}`) || 0) - (supplierPaymentDebitMap.get(a.id) || 0) - (investorSettlementPaymentMap.get(`${a.id}:${a.currencyId}`) || 0)) * 100)) / 100);
          return {
          id: a.id,
          cityId: null,
          cityName: "Super Admin",
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          currencyId: a.currencyId,
          currency: a.currency,
          accountKind: a.accountKind,
          isActive: a.isActive,
          createdAt: a.createdAt.toISOString(),
          _count: {
            deposits: 0,
            hajiTransfers: 0,
            expenses: a._count.expenses,
          },
          runningBalance,
          isNegative: runningBalance < 0,
          accountScope: "super_admin",
        };
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

    const [openingBalances, paymentsIn, deposits, depositedCheques, expenses, hajiTransfers, supplierPayments, shippingLinePayments, agentPayments, lotCosts, intermediaryDeposits, personalWithdrawals] = await Promise.all([
      prisma.openingBankBalance.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: cityId
          ? { bankAccountId: { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] } }
          : {},
        _sum: { amount: true },
      }),
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
      prisma.payment.findMany({
        where: {
          bankDepositId: { not: null },
          paymentMethod: "cheque",
          status: "active",
          ...(cityId ? { cityId } : {}),
        },
        select: {
          bankAccountId: true,
          bankDepositId: true,
          currencyId: true,
          amount: true,
          bankDeposit: {
            select: {
              bankAccountId: true,
            },
          },
        },
      }),
      prisma.expense.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: { bankAccountId: { not: null }, deletedAt: null, ...(cityId ? { cityId } : {}) },
        _sum: { amount: true },
      }),
      prisma.hajiTransfer.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: {
          bankAccountId: { not: null },
          sourceType: "bank_transfer",
          withdrawalSource: null,
          ...(cityId ? { cityId } : {}),
        } as any,
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
      prisma.shippingLinePayment.findMany({
        where: {
          bankAccountId: cityId
            ? { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] }
            : { not: null },
        },
        select: {
          bankAccountId: true,
          amountPkr: true,
          amountUsd: true,
          exchangeRate: true,
        },
      }),
      prisma.agentPayment.findMany({
        where: {
          bankAccountId: cityId
            ? { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] }
            : { not: null },
        },
        select: {
          bankAccountId: true,
          amount: true,
          currencyCode: true,
        },
      }),
      prisma.lotCost.findMany({
        where: {
          bankAccountId: cityId
            ? { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] }
            : { not: null },
        },
        select: {
          bankAccountId: true,
          amount: true,
          currencyCode: true,
        },
      }),
      prisma.intermediaryDeposit.findMany({
        where: {
          deletedAt: null,
          bankAccountId: cityId
            ? { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] }
            : { not: null },
        },
        select: {
          bankAccountId: true,
          amount: true,
          currencyId: true,
        },
      }),
      prisma.personalWithdrawal.groupBy({
        by: ["bankAccountId", "currencyId"],
        where: {
          bankAccountId: cityId
            ? { in: scopedBankAccountIds.length > 0 ? scopedBankAccountIds : [-1] }
            : { not: null },
          sourceType: "bank_account",
        } as any,
        _sum: { amount: true },
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
    for (const row of openingBalances) addBalance(row.bankAccountId, row.currencyId, Number(row._sum.amount || 0));
    for (const row of paymentsIn) addBalance(row.bankAccountId, row.currencyId, Number(row._sum.amount || 0));
    for (const row of deposits) addBalance(row.bankAccountId, row.currencyId, Number(row._sum.cashAmount || 0));
    const depositedChequeTotals = new Map<string, number>();
    for (const row of depositedCheques) {
      const effectiveBankAccountId = row.bankAccountId ?? row.bankDeposit?.bankAccountId ?? null;
      if (!effectiveBankAccountId) continue;
      const key = `${effectiveBankAccountId}:${row.currencyId}`;
      depositedChequeTotals.set(key, (depositedChequeTotals.get(key) || 0) + Number(row.amount || 0));
    }
    for (const [key, total] of depositedChequeTotals.entries()) {
      const [accountIdStr, currencyIdStr] = key.split(":");
      addBalance(Number(accountIdStr), Number(currencyIdStr), total);
    }
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
    for (const row of shippingLinePayments) {
      const amountPkr = Number(row.amountPkr || 0) > 0
        ? Number(row.amountPkr || 0)
        : (Number(row.exchangeRate || 0) > 0 ? Number(row.amountUsd || 0) * Number(row.exchangeRate || 0) : 0);
      if (amountPkr > 0) addBalanceByCode(row.bankAccountId, "PKR", -amountPkr);
      else if (Number(row.amountUsd || 0) > 0) addBalanceByCode(row.bankAccountId, "USD", -Number(row.amountUsd || 0));
    }
    for (const row of agentPayments) addBalanceByCode(row.bankAccountId, row.currencyCode, -Number(row.amount || 0));
    for (const row of lotCosts) addBalanceByCode(row.bankAccountId, row.currencyCode, -Number(row.amount || 0));
    for (const row of intermediaryDeposits) addBalance(row.bankAccountId, row.currencyId, -Number(row.amount || 0));
    for (const row of personalWithdrawals) addBalance(row.bankAccountId, row.currencyId, -Number(row._sum.amount || 0));

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
    console.error("List bank accounts:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    if (user.role === "super_admin") {
      const body = await request.json();
      const bankName: string = (body.bankName || "").trim();
      if (!bankName) return errorResponse("VALIDATION_ERROR", "bankName is required");
      if (bankName.length > 100) return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");

      const accountNumber: string | null = body.accountNumber ? String(body.accountNumber).trim() : null;
      const currencyId = Number(body.currencyId);
      const accountKind = body.accountKind === "cash" ? "cash" : "bank";
      if (!currencyId || Number.isNaN(currencyId)) return errorResponse("VALIDATION_ERROR", "currencyId is required");

      const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found", 404);

      if (syncMeta) {
        const existingSync = await prisma.syncRequest.findUnique({
          where: {
            unique_sync_request_per_city_module: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: BANK_ACCOUNT_SYNC_MODULE,
              requestId: syncMeta.requestId,
            },
          },
        });
        if (existingSync?.entityId) {
          const existingAccount = await prisma.superAdminBankAccount.findUnique({
            where: { id: existingSync.entityId },
            include: { currency: true },
          });
          if (existingAccount) {
            return successResponse(
              {
                id: existingAccount.id,
                cityId: null,
                cityName: "Super Admin",
                bankName: existingAccount.bankName,
                accountNumber: existingAccount.accountNumber,
                currencyId: existingAccount.currencyId,
                currency: existingAccount.currency,
                isActive: existingAccount.isActive,
                createdAt: existingAccount.createdAt.toISOString(),
                accountScope: "super_admin",
              },
              "Bank account already synced"
            );
          }
        }
      }

      const account = await prisma.$transaction(async (tx) => {
        const created = await tx.superAdminBankAccount.create({
          data: {
            bankName,
            accountNumber,
            currencyId,
            accountKind,
            isActive: true,
            createdBy: user.userId,
          },
          include: { currency: true },
        });

        await createAuditLog(
          user.userId,
          null,
          "super_admin_bank_accounts",
          created.id,
          "create",
          undefined,
          { bankName, accountNumber, currencyId },
          getClientIP(request),
          tx
        );

        if (syncMeta) {
          await tx.syncRequest.create({
            data: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: BANK_ACCOUNT_SYNC_MODULE,
              requestId: syncMeta.requestId,
              deviceId: syncMeta.deviceId,
              entityType: "super_admin_bank_accounts",
              entityId: created.id,
              createdBy: user.userId,
            },
          });
        }
        return created;
      });

      return successResponse(
        {
          id: account.id,
          cityId: null,
          cityName: "Super Admin",
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          currencyId: account.currencyId,
          currency: account.currency,
          accountKind: account.accountKind,
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

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: BANK_ACCOUNT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingAccount = await prisma.bankAccount.findUnique({
          where: { id: existingSync.entityId },
          include: { city: { select: { id: true, name: true } } },
        });
        if (existingAccount) {
          return successResponse(
            {
              id: existingAccount.id,
              cityId: existingAccount.cityId,
              cityName: existingAccount.city.name,
              bankName: existingAccount.bankName,
              accountNumber: existingAccount.accountNumber,
              isActive: existingAccount.isActive,
              createdAt: existingAccount.createdAt.toISOString(),
            },
            "Bank account already synced"
          );
        }
      }
    }

    // Validate bankName
    const bankName: string = (body.bankName || "").trim();
    if (!bankName) {
      return errorResponse("VALIDATION_ERROR", "bankName is required");
    }
    if (bankName.length > 100) {
      return errorResponse("VALIDATION_ERROR", "bankName must be at most 100 characters");
    }

    const accountNumber: string | null = body.accountNumber ? String(body.accountNumber).trim() : null;

    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.bankAccount.create({
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
        created.id,
        "create",
        undefined,
        { bankName, accountNumber, cityId },
        getClientIP(request),
        tx
      );

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: BANK_ACCOUNT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "bank_accounts",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

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
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const fallbackCityId = user.role === "super_admin" ? SUPERADMIN_SYNC_CITY_ID : (user.cityId || 0);
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: fallbackCityId,
            module: BANK_ACCOUNT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        if (user.role === "super_admin") {
          const existingAccount = await prisma.superAdminBankAccount.findUnique({
            where: { id: existingSync.entityId },
            include: { currency: true },
          });
          if (existingAccount) {
            return successResponse({
              id: existingAccount.id,
              cityId: null,
              cityName: "Super Admin",
              bankName: existingAccount.bankName,
              accountNumber: existingAccount.accountNumber,
              currencyId: existingAccount.currencyId,
              currency: existingAccount.currency,
              isActive: existingAccount.isActive,
              createdAt: existingAccount.createdAt.toISOString(),
              accountScope: "super_admin",
            }, "Bank account already synced");
          }
        } else {
          const existingAccount = await prisma.bankAccount.findUnique({
            where: { id: existingSync.entityId },
            include: { city: { select: { id: true, name: true } } },
          });
          if (existingAccount) {
            return successResponse({
              id: existingAccount.id,
              cityId: existingAccount.cityId,
              cityName: existingAccount.city.name,
              bankName: existingAccount.bankName,
              accountNumber: existingAccount.accountNumber,
              isActive: existingAccount.isActive,
              createdAt: existingAccount.createdAt.toISOString(),
            }, "Bank account already synced");
          }
        }
      }
    }
    console.error("Create bank account:", error);
    return serverError();
  }
});
