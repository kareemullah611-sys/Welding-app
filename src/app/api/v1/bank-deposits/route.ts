import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import {
  successResponse,
  paginatedResponse,
  errorResponse,
  serverError,
  getPaginationParams,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalBankDeposit } from "@/lib/accounting";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);

    const requestedCityId = searchParams.get("cityId")
      ? parseInt(searchParams.get("cityId")!)
      : undefined;
    const cityId = getCityScope(user, requestedCityId);

    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const query = (searchParams.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (from || to) {
      where.depositDate = {};
      if (from) where.depositDate.gte = new Date(from);
      if (to) where.depositDate.lte = new Date(to + "T23:59:59.999Z");
    }
    if (shouldApplySearch) {
      where.OR = [
        { slipNumber: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        { bankAccount: { bankName: { contains: query, mode: "insensitive" } } },
        { bankAccount: { accountNumber: { contains: query, mode: "insensitive" } } },
        { currency: { code: { contains: query, mode: "insensitive" } } },
        { cheques: { some: { chequeNumber: { contains: query, mode: "insensitive" } } } },
        { cheques: { some: { chequeBank: { contains: query, mode: "insensitive" } } } },
        { cheques: { some: { customer: { name: { contains: query, mode: "insensitive" } } } } },
        ...(hasNumericQuery ? [{ cashAmount: numericQuery }, { id: Math.trunc(numericQuery) }] : []),
      ];
    }

    const [deposits, total] = await Promise.all([
      prisma.bankDeposit.findMany({
        where,
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          cheques: {
            select: {
              id: true,
              amount: true,
              chequeNumber: true,
              chequeBank: true,
              customer: { select: { name: true } },
            },
          },
        },
        orderBy: { depositDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.bankDeposit.count({ where }),
    ]);

    // Batch-load creators
    const creatorIds = Array.from(new Set(deposits.map((d) => d.createdBy)));
    const creators =
      creatorIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, fullName: true },
          })
        : [];
    const creatorById: Record<number, string> = {};
    for (const c of creators) creatorById[c.id] = c.fullName;

    return paginatedResponse(
      deposits.map((d) => {
        const chequeTotal = d.cheques.reduce(
          (sum: number, c: any) => sum + Number(c.amount),
          0
        );
        return {
          id: d.id,
          depositDate: d.depositDate.toISOString().split("T")[0],
          slipNumber: d.slipNumber,
          cashAmount: Number(d.cashAmount),
          currencyId: d.currencyId,
          currency: d.currency,
          bankAccount: d.bankAccount,
          cheques: d.cheques.map((c: any) => ({
            id: c.id,
            amount: Number(c.amount),
            chequeNumber: c.chequeNumber,
            chequeBank: c.chequeBank,
            customer: c.customer,
          })),
          totalAmount: Number(d.cashAmount) + chequeTotal,
          createdAt: d.createdAt.toISOString(),
          creator: { fullName: creatorById[d.createdBy] ?? null },
        };
      }),
      total,
      page,
      limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();

    // Determine the city for this deposit
    const cityId =
      user.role === "city_admin"
        ? user.cityId!
        : body.cityId
        ? parseInt(body.cityId)
        : undefined;

    if (!cityId) {
      return errorResponse("VALIDATION_ERROR", "cityId is required for super_admin");
    }

    // Required fields
    const { bankAccountId, depositDate, currencyId } = body;

    if (!bankAccountId) return errorResponse("VALIDATION_ERROR", "bankAccountId is required");
    if (!depositDate) return errorResponse("VALIDATION_ERROR", "depositDate is required");
    if (!currencyId) return errorResponse("VALIDATION_ERROR", "currencyId is required");

    const parsedBankAccountId = parseInt(bankAccountId);
    const parsedCurrencyId = parseInt(currencyId);

    if (isNaN(parsedBankAccountId))
      return errorResponse("VALIDATION_ERROR", "bankAccountId must be a valid number");
    if (isNaN(parsedCurrencyId))
      return errorResponse("VALIDATION_ERROR", "currencyId must be a valid number");

    // Validate depositDate
    const parsedDepositDate = new Date(depositDate);
    if (isNaN(parsedDepositDate.getTime())) {
      return errorResponse("VALIDATION_ERROR", "depositDate is not a valid date");
    }

    // Validate cashAmount
    const cashAmount = body.cashAmount !== undefined ? Number(body.cashAmount) : 0;
    if (isNaN(cashAmount) || cashAmount < 0) {
      return errorResponse("VALIDATION_ERROR", "cashAmount must be a non-negative number");
    }

    const chequePaymentIds: number[] = Array.isArray(body.chequePaymentIds)
      ? body.chequePaymentIds
          .map((id: any) => parseInt(id))
          .filter((id: number) => !isNaN(id))
      : [];

    // Require at least some value
    if (cashAmount === 0 && chequePaymentIds.length === 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "At least cashAmount > 0 or one chequePaymentId must be provided"
      );
    }

    // Verify bankAccount belongs to user's city
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: parsedBankAccountId },
    });
    if (!bankAccount) {
      return errorResponse("VALIDATION_ERROR", "Bank account not found", 404);
    }
    if (bankAccount.cityId !== cityId) {
      return errorResponse("FORBIDDEN", "Bank account does not belong to your city", 403);
    }

    // Validate cheque payments
    let cheques: any[] = [];
    if (chequePaymentIds.length > 0) {
      cheques = await prisma.payment.findMany({
        where: {
          id: { in: chequePaymentIds },
        },
        select: {
          id: true,
          cityId: true,
          currencyId: true,
          paymentMethod: true,
          destination: true,
          status: true,
          chequeStatus: true,
          amount: true,
        },
      });

      if (cheques.length !== chequePaymentIds.length) {
        return errorResponse("VALIDATION_ERROR", "One or more cheque payment IDs not found");
      }

      for (const cheque of cheques) {
        if (cheque.paymentMethod !== "cheque") {
          return errorResponse(
            "VALIDATION_ERROR",
            `Payment ${cheque.id} is not a cheque payment`
          );
        }
        if (cheque.destination !== "our_account") {
          return errorResponse(
            "VALIDATION_ERROR",
            `Payment ${cheque.id} destination is not our_account`
          );
        }
        if (cheque.status !== "active") {
          return errorResponse("VALIDATION_ERROR", `Payment ${cheque.id} is not active`);
        }
        if (cheque.chequeStatus !== "in_hand") {
          return errorResponse(
            "VALIDATION_ERROR",
            `Payment ${cheque.id} cheque status must be in_hand`
          );
        }
        if (cheque.cityId !== cityId) {
          return errorResponse(
            "FORBIDDEN",
            `Payment ${cheque.id} does not belong to your city`
          );
        }
        if (cheque.currencyId !== parsedCurrencyId) {
          return errorResponse(
            "VALIDATION_ERROR",
            `Payment ${cheque.id} currency does not match deposit currency — all cheques must be in the same currency as the deposit`
          );
        }
      }
    }

    // Transactionally create deposit and update cheque statuses
    const newDeposit = await prisma.$transaction(async (tx) => {
      const deposit = await tx.bankDeposit.create({
        data: {
          cityId,
          bankAccountId: parsedBankAccountId,
          depositDate: parsedDepositDate,
          slipNumber: body.slipNumber ? String(body.slipNumber).trim() : null,
          cashAmount,
          currencyId: parsedCurrencyId,
          notes: body.notes ? String(body.notes).trim() : null,
          createdBy: user.userId,
        },
      });

      if (chequePaymentIds.length > 0) {
        // Fix P2 race condition: add chequeStatus predicate inside the transaction so that
        // if two concurrent requests pass the pre-transaction validation for the same cheque,
        // only the first one that acquires the row lock will match — the second updateMany
        // will update 0 rows, which we detect and roll back.
        const result = await tx.payment.updateMany({
          where: { id: { in: chequePaymentIds }, chequeStatus: "in_hand", status: "active" },
          data: {
            chequeStatus: "deposited_to_bank",
            bankDepositId: deposit.id,
            bankAccountId: parsedBankAccountId,
          },
        });
        if (result.count !== chequePaymentIds.length) {
          throw new Error("One or more cheques were already deposited by a concurrent request. Please refresh and try again.");
        }
      }

      return deposit;
    });

    // Create journal entries for the deposit (outside transaction — avoids timeout)
    try {
      const depositCurrency = await prisma.currency.findUnique({ where: { id: parsedCurrencyId }, select: { code: true } });
      const chequeAmounts = cheques.map((c: any) => ({ paymentId: c.id, amount: Number(c.amount) }));
      await journalBankDeposit({
        id: newDeposit.id, bankAccountId: parsedBankAccountId, cityId,
        cashAmount, currencyCode: depositCurrency?.code || "PKR",
        depositDate: parsedDepositDate, createdBy: user.userId, cheques: chequeAmounts,
      });
    } catch (je) { console.error("Journal error (bank deposit):", je); }

    // Fetch full details after transaction
    const fullDeposit = await prisma.bankDeposit.findUnique({
      where: { id: newDeposit.id },
      include: {
        currency: { select: { id: true, code: true, symbol: true } },
        bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
        cheques: {
          select: {
            id: true,
            amount: true,
            chequeNumber: true,
            chequeBank: true,
            customer: { select: { name: true } },
          },
        },
      },
    });

    if (!fullDeposit) return serverError("Failed to retrieve created deposit");

    const creator = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { fullName: true },
    });

    const chequeTotal = fullDeposit.cheques.reduce(
      (sum: number, c: any) => sum + Number(c.amount),
      0
    );

    await createAuditLog(
      user.userId,
      cityId,
      "bank_deposits",
      fullDeposit.id,
      "create",
      undefined,
      {
        bankAccountId: parsedBankAccountId,
        depositDate,
        cashAmount,
        chequeCount: chequePaymentIds.length,
        totalAmount: cashAmount + chequeTotal,
      },
      getClientIP(request)
    );

    return successResponse(
      {
        id: fullDeposit.id,
        depositDate: fullDeposit.depositDate.toISOString().split("T")[0],
        slipNumber: fullDeposit.slipNumber,
        cashAmount: Number(fullDeposit.cashAmount),
        currencyId: fullDeposit.currencyId,
        currency: fullDeposit.currency,
        bankAccount: fullDeposit.bankAccount,
        cheques: fullDeposit.cheques.map((c: any) => ({
          id: c.id,
          amount: Number(c.amount),
          chequeNumber: c.chequeNumber,
          chequeBank: c.chequeBank,
          customer: c.customer,
        })),
        totalAmount: Number(fullDeposit.cashAmount) + chequeTotal,
        createdAt: fullDeposit.createdAt.toISOString(),
        creator: { fullName: creator?.fullName ?? null },
      },
      "Bank deposit created",
      201
    );
  } catch (error) {
    return serverError();
  }
});
