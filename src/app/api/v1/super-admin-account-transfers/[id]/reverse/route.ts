import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries } from "@/lib/accounting";
import { reverseForeignCurrencyMovements } from "@/lib/foreign-currency-carrying-db";

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (!reason) return validationError("Reversal reason is required");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `superadmin-transfer-record:${id}`);
      const row = await tx.superAdminAccountTransfer.findUnique({ where: { id } });
      if (!row) throw Object.assign(new Error("Transfer not found"), { code: "NOT_FOUND" });
      if (row.reversedAt) throw Object.assign(new Error("Transfer is already reversed"), { code: "ALREADY_REVERSED" });
      await reverseForeignCurrencyMovements(tx, {
        sourceType: "super_admin_account_transfer",
        sourceId: id,
        reversalDate: new Date(),
        createdBy: user.userId,
      });
      if (row.transferType === "same_currency") {
        await reverseJournalEntries(`SATRANS-${id}`, user.userId, tx);
      } else {
        await reverseJournalEntries(`SATRANS-OUT-${id}`, user.userId, tx);
        await reverseJournalEntries(`SATRANS-IN-${id}`, user.userId, tx);
      }
      await tx.superAdminAccountTransfer.update({ where: { id }, data: { reversedAt: new Date(), reversedBy: user.userId, notes: [row.notes, `Reversal: ${reason}`].filter(Boolean).join(" — ") } });
      await createAuditLog(user.userId, null, "super_admin_account_transfers", id, "cancel", row, { reason }, getClientIP(request), tx);
    });
    return successResponse({ id }, "Account transfer reversed");
  } catch (error: any) {
    if (error?.code === "NOT_FOUND") return errorResponse("NOT_FOUND", error.message, 404);
    if (error?.code === "ALREADY_REVERSED") return errorResponse("ALREADY_REVERSED", error.message, 409);
    console.error("Reverse superadmin transfer:", error);
    return serverError();
  }
});
