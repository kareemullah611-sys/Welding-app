import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { reverseJournalEntries } from "@/lib/accounting";
import { errorResponse, successResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { createAuditLog, getClientIP, withSuperAdmin } from "@/lib/middleware";
import { reverseForeignCurrencyMovements } from "@/lib/foreign-currency-carrying-db";

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("VALIDATION", "Invalid receipt ID", 400);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `haji-cash-receipt:${id}`);
    const existing = await tx.hajiCashReceipt.findUnique({ where: { id } });
    if (!existing) return { error: "NOT_FOUND" as const };
    if (existing.reversedAt) return { error: "ALREADY_REVERSED" as const };

    await reverseForeignCurrencyMovements(tx, { sourceType: "haji_cash_receipt", sourceId: id, reversalDate: new Date(), createdBy: user.userId });
    await reverseJournalEntries(`HAJIREC-${id}`, user.userId, tx);
    const reversed = await tx.hajiCashReceipt.update({
      where: { id },
      data: { reversedAt: new Date(), reversedBy: user.userId },
    });
    await createAuditLog(
      user.userId,
      null,
      "haji_cash_receipts",
      id,
      "update",
      existing,
      reversed,
      getClientIP(request),
      tx,
    );
    return { row: reversed };
  });

  if ("error" in result && result.error === "NOT_FOUND") return errorResponse("NOT_FOUND", "Receipt not found", 404);
  if ("error" in result && result.error === "ALREADY_REVERSED") return errorResponse("VALIDATION", "Receipt is already reversed", 400);
  if (!("row" in result)) return errorResponse("VALIDATION", "Receipt could not be reversed", 400);
  return successResponse(result.row, "Receipt reversed");
});
