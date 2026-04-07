import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalHajiTransfer } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

const PAKISTAN_HAJI_TARGET = "Super Admin Account";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const h = await prisma.hajiTransfer.findUnique({ where: { id }, include: { currency: true } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    const city = await prisma.city.findUnique({ where: { id: h.cityId }, include: { country: true } });
    const forcedTransferredTo = city?.country?.name === "Pakistan" ? PAKISTAN_HAJI_TARGET : (body.transferredTo !== undefined ? body.transferredTo : h.transferredTo);

    try { await reverseJournalEntries(`HAJI-${id}`, user.userId); } catch (je) { console.error("Reverse journal (haji):", je); }

    const updated = await prisma.hajiTransfer.update({
      where: { id },
      data: {
        amount: body.amount || h.amount,
        detail: body.detail || h.detail,
        transferredTo: forcedTransferredTo,
        notes: body.notes !== undefined ? body.notes : h.notes,
        updatedAt: new Date(),
      },
    });

    try {
      await journalHajiTransfer({ id, cityId: h.cityId, amount: Number(updated.amount), currencyCode: h.currency.code, date: h.transferDate, createdBy: user.userId, sourceType: (h as any).sourceType ?? null, bankAccountId: (h as any).bankAccountId ?? null });
    } catch (je) { console.error("Re-journal (haji):", je); }

    await createAuditLog(user.userId, h.cityId, "haji_transfers", id, "update", { amount: Number(h.amount) }, { amount: Number(updated.amount) }, getClientIP(request));
    return successResponse({ id }, "Updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const h = await prisma.hajiTransfer.findUnique({ where: { id } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    try { await reverseJournalEntries(`HAJI-${id}`, user.userId); } catch (je) { console.error("Reverse journal (haji delete):", je); }

    // Fix: if this transfer was sourced from a cheque, restore chequeStatus → "in_hand"
    // so the cheque can be deposited or used again. Without this the cheque is permanently
    // stuck in "sent_to_haji" with no transfer to show for it.
    const chequePaymentId = (h as any).chequePaymentId;
    if (chequePaymentId) {
      try {
        await prisma.payment.update({ where: { id: chequePaymentId }, data: { chequeStatus: "in_hand" } as any });
      } catch (je) { console.error("Restore cheque status (haji delete):", je); }
    }

    await prisma.hajiTransfer.delete({ where: { id } });
    await createAuditLog(user.userId, h.cityId, "haji_transfers", id, "delete", undefined, undefined, getClientIP(request));
    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
