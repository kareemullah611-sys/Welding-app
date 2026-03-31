import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    const existing = await prisma.shippingLinePayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    try { await reverseJournalEntries(`SLPAY-${id}`, user.userId); } catch (je) { console.error("Reverse journal (SL payment):", je); }

    const bankAccountId = body.bankAccountId !== undefined ? (body.bankAccountId || null) : existing.bankAccountId;
    const amountUsd = body.amountUsd ? Number(body.amountUsd) : Number(existing.amountUsd);
    const exchangeRate = body.exchangeRate ? Number(body.exchangeRate) : (existing.exchangeRate ? Number(existing.exchangeRate) : null);

    const updated = await prisma.shippingLinePayment.update({
      where: { id },
      data: {
        amountUsd,
        exchangeRate,
        amountPkr: exchangeRate ? Math.round(amountUsd * exchangeRate * 100) / 100 : null,
        bankAccountId,
        reference: body.reference !== undefined ? body.reference || null : existing.reference,
        notes: body.notes !== undefined ? body.notes || null : existing.notes,
      },
    });

    try {
      await journalShippingLinePayment({ id, shippingLineId: existing.shippingLineId, amountUsd: Number(updated.amountUsd), paymentDate: updated.paymentDate, createdBy: user.userId, bankAccountId });
    } catch (je) { console.error("Re-journal (SL payment):", je); }

    await createAuditLog(user.userId, null, "shipping_line_payments", id, "update",
      { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(updated.amountUsd) }, getClientIP(request));

    return successResponse({ id }, "Payment updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.shippingLinePayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    try { await reverseJournalEntries(`SLPAY-${id}`, user.userId); } catch (je) { console.error("Reverse journal (SL payment delete):", je); }

    await prisma.shippingLinePayment.delete({ where: { id } });

    await createAuditLog(user.userId, null, "shipping_line_payments", id, "delete",
      { amountUsd: Number(existing.amountUsd), shippingLineId: existing.shippingLineId }, undefined, getClientIP(request as any));

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
