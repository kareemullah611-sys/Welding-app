import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalHajiCashReceipt } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import { foreignCurrencyOwnerKey, transferForeignCurrencyLayers } from "@/lib/foreign-currency-carrying-db";

function parsePositiveAmount(value: unknown): number | null {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const body = await request.json();
  const cashAccountId = Number(body.superAdminCashAccountId || 0);
  const bankAccountId = Number(body.superAdminBankAccountId || 0);
  const intermediaryId = Number(body.intermediaryId || 0);
  const amount = parsePositiveAmount(body.amount);

  if (Number(Boolean(cashAccountId)) + Number(Boolean(bankAccountId)) !== 1) {
    return errorResponse("VALIDATION", "Choose exactly one destination: superadmin bank or cash account", 400);
  }
  if (!intermediaryId) {
    return errorResponse("VALIDATION", "Intermediary is required", 400);
  }
  if (!body.receiptDate) return errorResponse("VALIDATION", "receiptDate required", 400);
  if (!amount) return errorResponse("VALIDATION", "amount must be > 0", 400);

  const destinationAccountId = cashAccountId || bankAccountId;
  const destinationAccount = await prisma.superAdminBankAccount.findUnique({
    where: { id: destinationAccountId },
    include: { currency: true },
  });
  if (!destinationAccount || !destinationAccount.isActive) {
    return errorResponse("NOT_FOUND", "Active superadmin destination account not found", 404);
  }
  const expectedKind = cashAccountId ? "cash" : "bank";
  if (destinationAccount.accountKind !== expectedKind) {
    return errorResponse("VALIDATION", `Selected destination must be a superadmin ${expectedKind} account`, 400);
  }

  const intermediary = await prisma.intermediary.findUnique({
    where: { id: intermediaryId },
    select: { id: true, name: true, isActive: true },
  });
  if (!intermediary || !intermediary.isActive) {
    return errorResponse("NOT_FOUND", "Intermediary not found", 404);
  }

  const currencyCode = String(destinationAccount.currency.code || "").toUpperCase();

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `intermediary-return:${intermediaryId}:${currencyCode}`);
    const balances = await getIntermediaryBalances(intermediaryId, undefined, tx);
    const available = Number(balances[currencyCode] || 0);
    if (amount > available + 0.0001) {
      throw new Error(`INTERMEDIARY_BALANCE:${available}`);
    }
    const row = await tx.hajiCashReceipt.create({
      data: {
        superAdminCashAccountId: destinationAccountId,
        intermediaryId,
        receiptDate: new Date(body.receiptDate),
        amount,
        currencyId: destinationAccount.currencyId,
        notes: body.notes || null,
        createdBy: user.userId,
      },
    });

    await journalHajiCashReceipt(
      {
        id: row.id,
        superAdminCashAccountId: destinationAccountId,
        accountKind: destinationAccount.accountKind,
        intermediaryId,
        amount,
        currencyCode,
        receiptDate: row.receiptDate,
        createdBy: user.userId,
      },
      tx,
    );
    if (isSupportedForeignCurrency(currencyCode)) {
      await transferForeignCurrencyLayers(tx, {
        sourceOwnerKey: foreignCurrencyOwnerKey.intermediary(intermediaryId),
        targetOwnerKey: destinationAccount.accountKind === "cash"
          ? foreignCurrencyOwnerKey.superAdminCash(destinationAccountId)
          : foreignCurrencyOwnerKey.superAdminBank(destinationAccountId),
        targetPositionType: destinationAccount.accountKind === "cash" ? "super_admin_cash" : "super_admin_bank",
        currencyCode,
        amount,
        sourceType: "haji_cash_receipt",
        sourceId: row.id,
        movementDate: row.receiptDate,
        createdBy: user.userId,
      });
    }

    await createAuditLog(
      user.userId,
      null,
      "haji_cash_receipts",
      row.id,
      "create",
      undefined,
      { destinationAccountId, destinationAccountKind: destinationAccount.accountKind, intermediaryId, amount, currencyCode },
      getClientIP(request),
      tx,
    );

    return row;
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("INTERMEDIARY_BALANCE:")) {
      const available = Number(message.split(":")[1] || 0);
      return { balanceError: available } as const;
    }
    throw error;
  });

  if ("balanceError" in created) {
    return errorResponse(
      "VALIDATION",
      `Intermediary has insufficient ${currencyCode} balance (${created.balanceError.toLocaleString("en-US")} available)`,
      400,
    );
  }

  return successResponse(
    {
      id: created.id,
      receiptDate: created.receiptDate.toISOString().split("T")[0],
      amount: Number(created.amount),
      intermediaryName: intermediary.name,
    },
    "Receipt recorded",
  );
});
