import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, getPaginationParams, paginatedResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalSuperAdminAccountTransfer } from "@/lib/accounting";

const round2 = (value: number) => Math.round(value * 100) / 100;

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const where = { reversedAt: null };
    const [rows, total] = await Promise.all([
      prisma.superAdminAccountTransfer.findMany({
        where,
        include: {
          sourceAccount: { include: { currency: true } },
          destinationAccount: { include: { currency: true } },
          creator: { select: { fullName: true } },
        },
        orderBy: [{ transferDate: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      prisma.superAdminAccountTransfer.count({ where }),
    ]);
    return paginatedResponse(rows.map((row) => ({
      ...row,
      fromAmount: Number(row.fromAmount),
      toAmount: Number(row.toAmount),
      exchangeRate: row.exchangeRate ? Number(row.exchangeRate) : null,
    })), total, page, limit);
  } catch (error) {
    console.error("List superadmin transfers:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context: unknown, user: JWTPayload) => {
  try {
    const body = await request.json();
    const sourceAccountId = Number(body.sourceAccountId);
    const destinationAccountId = Number(body.destinationAccountId);
    if (!sourceAccountId || !destinationAccountId) return validationError("Source and destination accounts are required");
    if (sourceAccountId === destinationAccountId) return validationError("Source and destination accounts must be different");
    const fromAmount = Number(body.fromAmount);
    if (!Number.isFinite(fromAmount) || fromAmount <= 0) return validationError("Transfer amount must be greater than zero");
    const [source, destination] = await Promise.all([
      prisma.superAdminBankAccount.findUnique({ where: { id: sourceAccountId }, include: { currency: true } }),
      prisma.superAdminBankAccount.findUnique({ where: { id: destinationAccountId }, include: { currency: true } }),
    ]);
    if (!source?.isActive || !destination?.isActive) return errorResponse("NOT_FOUND", "Active source and destination accounts are required", 404);
    const sameCurrency = source.currencyId === destination.currencyId;
    const transferType = sameCurrency ? "same_currency" : "exchange";
    const exchangeRate = sameCurrency ? null : Number(body.exchangeRate);
    if (!sameCurrency && (!Number.isFinite(exchangeRate) || Number(exchangeRate) <= 0)) return validationError("Exchange rate is required for a cross-currency transfer");
    const rateSource = sameCurrency ? null : String(body.rateSource || "").trim();
    if (!sameCurrency && !rateSource) return validationError("Exchange-rate source is required");
    const expectedToAmount = sameCurrency ? fromAmount : round2(fromAmount * Number(exchangeRate));
    const toAmount = body.toAmount === undefined || body.toAmount === "" ? expectedToAmount : Number(body.toAmount);
    if (!Number.isFinite(toAmount) || toAmount <= 0) return validationError("Destination amount must be greater than zero");
    if (Math.abs(toAmount - expectedToAmount) > 0.01) return validationError(`Destination amount must equal ${expectedToAmount.toLocaleString("en-US")} at the entered rate`);

    const created = await prisma.$transaction(async (tx) => {
      const lockKey = [sourceAccountId, destinationAccountId].sort((a, b) => a - b).join(":");
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `superadmin-transfer:${lockKey}`);
      const row = await tx.superAdminAccountTransfer.create({
        data: {
          transferDate: new Date(body.transferDate || new Date()),
          transferType,
          sourceAccountId,
          destinationAccountId,
          fromCurrencyId: source.currencyId,
          toCurrencyId: destination.currencyId,
          fromAmount,
          toAmount,
          exchangeRate,
          rateSource,
          reference: body.reference ? String(body.reference).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
          createdBy: user.userId,
        },
      });
      await journalSuperAdminAccountTransfer({
        id: row.id,
        transferType,
        sourceAccountId,
        destinationAccountId,
        fromCurrencyCode: source.currency.code,
        toCurrencyCode: destination.currency.code,
        fromAmount,
        toAmount,
        transferDate: row.transferDate,
        createdBy: user.userId,
      }, tx);
      await createAuditLog(user.userId, null, "super_admin_account_transfers", row.id, "create", undefined, { sourceAccountId, destinationAccountId, fromAmount, toAmount, exchangeRate, rateSource }, getClientIP(request), tx);
      return row;
    });
    return successResponse({ id: created.id }, "Account transfer recorded", 201);
  } catch (error) {
    console.error("Create superadmin transfer:", error);
    return serverError();
  }
});
