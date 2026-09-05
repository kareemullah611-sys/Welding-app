import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries } from "@/lib/accounting";

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (!reason) return validationError("Reversal reason is required");
    const reversal = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `superadmin-liability-entry:${id}`);
      const original = await tx.superAdminLiabilityEntry.findUnique({ where: { id } });
      if (!original) throw Object.assign(new Error("Entry not found"), { code: "NOT_FOUND" });
      if (original.entryType === "reversal" || original.reversedAt) throw Object.assign(new Error("Entry is already reversed"), { code: "ALREADY_REVERSED" });
      const row = await tx.superAdminLiabilityEntry.create({
        data: {
          accountId: original.accountId,
          entryType: "reversal",
          entryDate: new Date(),
          currencyId: original.currencyId,
          amount: original.amount,
          liabilityEffect: Number(original.liabilityEffect) * -1,
          exchangeRateToPkr: original.exchangeRateToPkr,
          pkrAmount: original.pkrAmount,
          pkrLiabilityEffect: Number(original.pkrLiabilityEffect) * -1,
          carryingRatePkr: original.carryingRatePkr,
          carryingAmountPkr: original.carryingAmountPkr,
          realizedFxPkr: original.realizedFxPkr == null ? null : Number(original.realizedFxPkr) * -1,
          rateSource: original.rateSource,
          sourceType: original.sourceType,
          superAdminBankAccountId: original.superAdminBankAccountId,
          superAdminCashAccountId: original.superAdminCashAccountId,
          intermediaryId: original.intermediaryId,
          bankAccountId: original.bankAccountId,
          cityId: original.cityId,
          counterAccountId: original.counterAccountId,
          reversedEntryId: original.id,
          reference: original.reference,
          remarks: reason,
          createdBy: user.userId,
        },
      });
      await reverseJournalEntries(`SALIAB-${original.id}`, user.userId, tx, row.entryDate);
      await tx.superAdminLiabilityEntry.update({ where: { id }, data: { reversedAt: row.entryDate, reversedBy: user.userId } });
      await createAuditLog(user.userId, null, "super_admin_liability_entries", id, "cancel", original, { reversalEntryId: row.id, reason }, getClientIP(request), tx);
      return row;
    });
    return successResponse({ id: reversal.id }, "Liability entry reversed");
  } catch (error: any) {
    if (error?.code === "NOT_FOUND") return errorResponse("NOT_FOUND", error.message, 404);
    if (error?.code === "ALREADY_REVERSED" || error?.code === "P2002") return errorResponse("ALREADY_REVERSED", "Entry is already reversed", 409);
    console.error("Reverse superadmin liability entry:", error);
    return serverError();
  }
});
