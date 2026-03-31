import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalWithdrawal } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const w = await prisma.personalWithdrawal.findUnique({ where: { id }, include: { currency: true } });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const amountChanged = body.amount !== undefined && Number(body.amount) !== Number(w.amount);

    // Reverse old WDRAW journal when amount changes so the GL stays correct
    if (amountChanged) {
      try { await reverseJournalEntries(`WDRAW-${id}`, user.userId); } catch (je) { console.error("Reverse journal (withdrawal edit):", je); }
    }

    const updated = await prisma.personalWithdrawal.update({
      where: { id },
      data: { amount: body.amount || w.amount, detail: body.detail || w.detail, notes: body.notes !== undefined ? body.notes : w.notes, updatedAt: new Date() },
    });

    // Re-journal with new amount
    if (amountChanged) {
      try {
        await journalWithdrawal({ id, cityId: w.cityId, amount: Number(updated.amount), currencyCode: w.currency.code, date: w.withdrawalDate, createdBy: user.userId });
      } catch (je) { console.error("Re-journal (withdrawal edit):", je); }
    }

    await createAuditLog(user.userId, w.cityId, "personal_withdrawals", id, "update", { amount: Number(w.amount) }, { amount: Number(updated.amount) }, getClientIP(request));
    return successResponse({ id }, "Updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const w = await prisma.personalWithdrawal.findUnique({ where: { id } });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    // Reverse the WDRAW journal (cash was credited on create, must be reversed on delete)
    try { await reverseJournalEntries(`WDRAW-${id}`, user.userId); } catch (je) { console.error("Reverse journal (withdrawal delete):", je); }

    // If this withdrawal was approved and linked to a haji transfer, also reverse that
    // haji transfer's journal and delete the record so no orphan exists.
    // Note: the approve route no longer creates a HAJI journal, so this reversal is
    // a no-op for new records — it only cleans up legacy data where HAJI was journaled.
    const hajiTransferId = (w as any).hajiTransferId;
    if (hajiTransferId) {
      try { await reverseJournalEntries(`HAJI-${hajiTransferId}`, user.userId); } catch (_) {}
      try { await prisma.hajiTransfer.delete({ where: { id: hajiTransferId } }); } catch (je) { console.error("Delete linked haji transfer (withdrawal delete):", je); }
    }

    await prisma.personalWithdrawal.delete({ where: { id } });
    await createAuditLog(user.userId, w.cityId, "personal_withdrawals", id, "delete", undefined, undefined, getClientIP(request));
    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
