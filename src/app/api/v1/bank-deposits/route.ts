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
import { getCityBankAccountAvailableBalance } from "@/lib/city-bank-balance";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { buildDateRange } from "@/lib/date-range";

type TreasuryTransferType =
  | "cheque_to_bank"
  | "bank_to_cash"
  | "cheque_to_cash"
  | "bank_to_bank";
const VALID_TRANSFER_TYPES: TreasuryTransferType[] = [
  "cheque_to_bank",
  "bank_to_cash",
  "cheque_to_cash",
  "bank_to_bank",
];
const BANK_DEPOSIT_SYNC_MODULE = "bank_deposits.create";
const requiresSourceBankAccount = (transferType: TreasuryTransferType) => transferType !== "cheque_to_cash";

const deriveTransferType = (row: { cashAmount: number; cheques: Array<{ id: number }>; notes?: string | null }): TreasuryTransferType => {
  const cashAmount = Number(row.cashAmount || 0);
  const hasCheques = (row.cheques || []).length > 0;
  const notes = String(row.notes || "");
  if (notes.includes("[B2B-OUT]") || notes.includes("[B2B-IN]")) return "bank_to_bank";
  if (hasCheques && cashAmount < 0) return "cheque_to_cash";
  if (!hasCheques && cashAmount < 0) return "bank_to_cash";
  return "cheque_to_bank";
};

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
    where.AND = [
      { OR: [{ transferType: { not: "bank_to_bank" } }, { cashAmount: { lt: 0 } }] },
    ];
    if (from || to) {
      where.depositDate = buildDateRange(from, to);
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

    const pairIds = deposits.map((d) => d.transferPairId).filter((id): id is string => !!id);
    const pairDestinations = pairIds.length
      ? await prisma.bankDeposit.findMany({
          where: { transferPairId: { in: pairIds }, cashAmount: { gt: 0 } },
          include: { bankAccount: { select: { id: true, bankName: true, accountNumber: true } } },
        })
      : [];
    const destinationByPair = new Map(pairDestinations.map((row) => [row.transferPairId, row.bankAccount]));
    const legacyDestinations = await Promise.all(
      deposits.filter((row) => row.transferType === "bank_to_bank" && !row.transferPairId).map(async (row) => {
        const matches = await prisma.bankDeposit.findMany({
          where: {
            id: { not: row.id }, cityId: row.cityId, currencyId: row.currencyId,
            transferType: "bank_to_bank", depositDate: row.depositDate, slipNumber: row.slipNumber,
            cashAmount: Math.abs(Number(row.cashAmount)), notes: { contains: "[B2B-IN]" },
          },
          include: { bankAccount: { select: { id: true, bankName: true, accountNumber: true } } },
          take: 2,
        });
        return [row.id, matches.length === 1 ? matches[0].bankAccount : null] as const;
      }),
    );
    const legacyDestinationBySource = new Map(legacyDestinations);

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
          destinationBankAccount: d.transferPairId ? destinationByPair.get(d.transferPairId) || null : legacyDestinationBySource.get(d.id) || null,
          transferPairId: d.transferPairId,
          cheques: d.cheques.map((c: any) => ({
            id: c.id,
            amount: Number(c.amount),
            chequeNumber: c.chequeNumber,
            chequeBank: c.chequeBank,
            customer: c.customer,
          })),
          totalAmount: Number(d.cashAmount) + chequeTotal,
          transferType: d.transferType || deriveTransferType({ cashAmount: Number(d.cashAmount), cheques: d.cheques, notes: d.notes }),
          notes: d.notes || null,
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
  const syncMeta = getSyncRequestMeta(request);
  let resolvedCityId: number | null = user.role === "city_admin" ? user.cityId! : null;
  try {
    const body = await request.json();
    const transferTypeRaw = String(body.transferType || "cheque_to_bank");
    if (!VALID_TRANSFER_TYPES.includes(transferTypeRaw as TreasuryTransferType)) {
      return errorResponse("VALIDATION_ERROR", "transferType is invalid");
    }
    const transferType = transferTypeRaw as TreasuryTransferType;

    // Determine the city for this deposit
    const cityId =
      user.role === "city_admin"
        ? user.cityId!
        : body.cityId
        ? parseInt(body.cityId)
        : undefined;
    resolvedCityId = cityId ?? null;

    if (!cityId) {
      return errorResponse("VALIDATION_ERROR", "cityId is required for super_admin");
    }

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: BANK_DEPOSIT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Bank deposit already synced");
      }
    }

    // Required fields
    const { bankAccountId, depositDate, currencyId } = body;

    if (requiresSourceBankAccount(transferType) && !bankAccountId) return errorResponse("VALIDATION_ERROR", "bankAccountId is required");
    if (!depositDate) return errorResponse("VALIDATION_ERROR", "depositDate is required");
    if (!currencyId) return errorResponse("VALIDATION_ERROR", "currencyId is required");

    const parsedBankAccountId = bankAccountId ? parseInt(bankAccountId) : null;
    const parsedCurrencyId = parseInt(currencyId);

    if (parsedBankAccountId !== null && isNaN(parsedBankAccountId))
      return errorResponse("VALIDATION_ERROR", "bankAccountId must be a valid number");
    if (isNaN(parsedCurrencyId))
      return errorResponse("VALIDATION_ERROR", "currencyId must be a valid number");

    // Validate depositDate
    const parsedDepositDate = new Date(depositDate);
    if (isNaN(parsedDepositDate.getTime())) {
      return errorResponse("VALIDATION_ERROR", "depositDate is not a valid date");
    }

    // Validate transfer amount
    const transferAmount = body.cashAmount !== undefined ? Number(body.cashAmount) : 0;
    if (!Number.isFinite(transferAmount)) {
      return errorResponse("VALIDATION_ERROR", "cashAmount must be a valid number");
    }

    const chequePaymentIds: number[] = Array.isArray(body.chequePaymentIds)
      ? body.chequePaymentIds
          .map((id: any) => parseInt(id))
          .filter((id: number) => !isNaN(id))
      : [];

    if (transferType === "bank_to_cash" || transferType === "bank_to_bank") {
      if (!(transferAmount > 0)) {
        return errorResponse("VALIDATION_ERROR", "Amount must be greater than zero");
      }
      if (chequePaymentIds.length > 0) {
        return errorResponse("VALIDATION_ERROR", "Cheques are not allowed for this transfer type");
      }
    }

    // Verify bankAccount belongs to user's city
    if (parsedBankAccountId !== null) {
      const bankAccount = await prisma.bankAccount.findUnique({ where: { id: parsedBankAccountId } });
      if (!bankAccount) return errorResponse("VALIDATION_ERROR", "Bank account not found", 404);
      if (bankAccount.cityId !== cityId) return errorResponse("FORBIDDEN", "Bank account does not belong to your city", 403);
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

    if (transferType === "cheque_to_bank" && transferAmount <= 0 && chequePaymentIds.length === 0) {
      return errorResponse("VALIDATION_ERROR", "Enter cash amount or select at least one cheque");
    }
    if (transferType === "cheque_to_cash" && chequePaymentIds.length === 0) {
      return errorResponse("VALIDATION_ERROR", "Select at least one cheque for cheque-to-cash transfer");
    }

    const destinationBankAccountId = body.destinationBankAccountId ? parseInt(body.destinationBankAccountId) : undefined;
    if (transferType === "bank_to_bank") {
      if (!destinationBankAccountId || Number.isNaN(destinationBankAccountId)) {
        return errorResponse("VALIDATION_ERROR", "destinationBankAccountId is required for bank-to-bank transfer");
      }
      if (destinationBankAccountId === parsedBankAccountId) {
        return errorResponse("VALIDATION_ERROR", "Source and destination bank accounts must be different");
      }
      const destinationBank = await prisma.bankAccount.findUnique({ where: { id: destinationBankAccountId } });
      if (!destinationBank || destinationBank.cityId !== cityId) {
        return errorResponse("FORBIDDEN", "Destination bank account does not belong to your city", 403);
      }
    }

    if (transferType === "bank_to_cash" || transferType === "bank_to_bank") {
      const available = await getCityBankAccountAvailableBalance(prisma, {
        cityId,
        bankAccountId: parsedBankAccountId!,
        currencyId: parsedCurrencyId,
      });
      if (transferAmount > available + 0.001) {
        const currency = await prisma.currency.findUnique({
          where: { id: parsedCurrencyId },
          select: { code: true },
        });
        return errorResponse(
          "INSUFFICIENT_FUNDS",
          `Insufficient bank balance. Available: ${available.toLocaleString("en-US")} ${currency?.code || ""}`
        );
      }
    }

    const chequeTotal = cheques.reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);
    const signedCashAmount =
      transferType === "bank_to_cash"
        ? -Math.abs(transferAmount)
        : transferType === "cheque_to_cash"
        ? -Math.abs(chequeTotal)
        : Math.abs(transferAmount || 0);

    // Transactionally create deposit + cheque status + journal entries
    const newDeposit = await prisma.$transaction(async (tx) => {
      const depositNotesBase = body.notes ? String(body.notes).trim() : null;
      const transferPairId = transferType === "bank_to_bank" ? crypto.randomUUID() : null;
      const sourceDeposit = await tx.bankDeposit.create({
        data: {
          cityId,
          bankAccountId: transferType === "cheque_to_cash" ? null : parsedBankAccountId,
          transferType,
          transferPairId,
          depositDate: parsedDepositDate,
          slipNumber: body.slipNumber ? String(body.slipNumber).trim() : null,
          cashAmount: transferType === "bank_to_bank" ? -Math.abs(transferAmount) : signedCashAmount,
          currencyId: parsedCurrencyId,
          notes: transferType === "bank_to_bank" ? [depositNotesBase, "[B2B-OUT]"].filter(Boolean).join(" ") : depositNotesBase,
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
            bankDepositId: sourceDeposit.id,
            bankAccountId: parsedBankAccountId,
          },
        });
        if (result.count !== chequePaymentIds.length) {
          throw new Error("One or more cheques were already deposited by a concurrent request. Please refresh and try again.");
        }
      }

      let destinationDepositId: number | null = null;
      if (transferType === "bank_to_bank" && destinationBankAccountId) {
        const destinationDeposit = await tx.bankDeposit.create({
          data: {
            cityId,
            bankAccountId: destinationBankAccountId,
            transferType,
            transferPairId,
            depositDate: parsedDepositDate,
            slipNumber: body.slipNumber ? String(body.slipNumber).trim() : null,
            cashAmount: Math.abs(transferAmount),
            currencyId: parsedCurrencyId,
            notes: [depositNotesBase, "[B2B-IN]"].filter(Boolean).join(" "),
            createdBy: user.userId,
          },
        });
        destinationDepositId = destinationDeposit.id;
      }

      const depositCurrency = await tx.currency.findUnique({
        where: { id: parsedCurrencyId },
        select: { code: true },
      });
      const chequeAmounts = cheques.map((c: any) => ({
        paymentId: c.id,
        amount: Number(c.amount),
      }));
      await journalBankDeposit(
        {
          id: sourceDeposit.id,
          bankAccountId: parsedBankAccountId,
          cityId,
          cashAmount:
            transferType === "bank_to_bank"
              ? -Math.abs(transferAmount)
              : signedCashAmount,
          currencyCode: depositCurrency?.code || "PKR",
          depositDate: parsedDepositDate,
          createdBy: user.userId,
          cheques: chequeAmounts,
          transactionKeySuffix:
            transferType === "bank_to_bank" ? "B2B-OUT" : undefined,
          transferType,
        },
        tx
      );
      if (
        transferType === "bank_to_bank" &&
        destinationBankAccountId &&
        destinationDepositId
      ) {
        await journalBankDeposit(
          {
            id: destinationDepositId,
            bankAccountId: destinationBankAccountId,
            cityId,
            cashAmount: Math.abs(transferAmount),
            currencyCode: depositCurrency?.code || "PKR",
            depositDate: parsedDepositDate,
            createdBy: user.userId,
            cheques: [],
            transactionKeySuffix: "B2B-IN",
          },
          tx
        );
      }

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: BANK_DEPOSIT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "bank_deposits",
            entityId: sourceDeposit.id,
            createdBy: user.userId,
          },
        });
      }

      return { sourceDeposit, destinationDepositId };
    });

    // Fetch full details after transaction
    const fullDeposit = await prisma.bankDeposit.findUnique({
      where: { id: newDeposit.sourceDeposit.id },
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

    const createdChequeTotal = fullDeposit.cheques.reduce((sum: number, c: any) => sum + Number(c.amount), 0);

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
        cashAmount: transferType === "bank_to_bank" ? -Math.abs(transferAmount) : signedCashAmount,
        chequeCount: chequePaymentIds.length,
        transferType,
        totalAmount: (transferType === "bank_to_bank" ? -Math.abs(transferAmount) : signedCashAmount) + createdChequeTotal,
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
        totalAmount: Number(fullDeposit.cashAmount) + createdChequeTotal,
        transferType: fullDeposit.transferType || deriveTransferType({
          cashAmount: Number(fullDeposit.cashAmount),
          cheques: fullDeposit.cheques,
          notes: fullDeposit.notes,
        }),
        notes: fullDeposit.notes || null,
        createdAt: fullDeposit.createdAt.toISOString(),
        creator: { fullName: creator?.fullName ?? null },
      },
      "Bank deposit created",
      201
    );
  } catch (error) {
    if (syncMeta && resolvedCityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: resolvedCityId,
            module: BANK_DEPOSIT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Bank deposit already synced");
      }
    }
    return serverError();
  }
});
