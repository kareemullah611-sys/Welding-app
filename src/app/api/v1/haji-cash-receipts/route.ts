import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { journalHajiCashReceipt } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { assertSuperAdminCashAccount } from "@/lib/haji-cash-balance";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";

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
  const intermediaryId = Number(body.intermediaryId || 0);
  const amount = parsePositiveAmount(body.amount);

  if (!cashAccountId || !intermediaryId) {
    return errorResponse("VALIDATION", "Haji cash account and intermediary are required", 400);
  }
  if (!body.receiptDate) return errorResponse("VALIDATION", "receiptDate required", 400);
  if (!amount) return errorResponse("VALIDATION", "amount must be > 0", 400);

  const cashCheck = await assertSuperAdminCashAccount(cashAccountId);
  if (!cashCheck.ok) return errorResponse("VALIDATION", cashCheck.message, 400);

  const intermediary = await prisma.intermediary.findUnique({
    where: { id: intermediaryId },
    select: { id: true, name: true, isActive: true },
  });
  if (!intermediary || !intermediary.isActive) {
    return errorResponse("NOT_FOUND", "Intermediary not found", 404);
  }

  const currencyCode = String(cashCheck.account.currency.code || "").toUpperCase();
  const balances = await getIntermediaryBalances(intermediaryId);
  const available = Number(balances[currencyCode] || 0);
  if (amount > available + 0.0001) {
    return errorResponse(
      "VALIDATION",
      `Intermediary has insufficient ${currencyCode} balance (${available.toLocaleString("en-US")} available)`,
      400,
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.hajiCashReceipt.create({
      data: {
        superAdminCashAccountId: cashAccountId,
        intermediaryId,
        receiptDate: new Date(body.receiptDate),
        amount,
        currencyId: cashCheck.account.currencyId,
        notes: body.notes || null,
        createdBy: user.userId,
      },
    });

    await journalHajiCashReceipt(
      {
        id: row.id,
        superAdminCashAccountId: cashAccountId,
        intermediaryId,
        amount,
        currencyCode,
        receiptDate: row.receiptDate,
        createdBy: user.userId,
      },
      tx,
    );

    await createAuditLog(
      user.userId,
      null,
      "haji_cash_receipts",
      row.id,
      "create",
      undefined,
      { superAdminCashAccountId: cashAccountId, intermediaryId, amount, currencyCode },
      getClientIP(request),
      tx,
    );

    return row;
  });

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
