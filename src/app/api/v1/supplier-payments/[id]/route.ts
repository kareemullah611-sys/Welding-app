import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalSupplierPaid } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const existing = await prisma.supplierPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Supplier payment not found", 404);

    try { await reverseJournalEntries(`SUPPPAY-${id}`, user.userId); } catch (je) { console.error("Reverse journal (supplier payment):", je); }

    const updated = await prisma.supplierPayment.update({
      where: { id },
      data: {
        amountUsd: body.amountUsd ?? existing.amountUsd,
        exchangeRate: body.exchangeRate ?? existing.exchangeRate,
        amountLocal: body.amountLocal ?? existing.amountLocal,
        reference: body.reference ?? existing.reference,
        notes: body.notes ?? existing.notes,
      },
    });
    try {
      await journalSupplierPaid({
        id, supplierId: existing.supplierId, amountUsd: Number(updated.amountUsd),
        paymentDate: updated.paymentDate, createdBy: user.userId,
        bankAccountId: (existing as any).bankAccountId || null,
        intermediaryId: (existing as any).intermediaryId || null,
      });
    } catch (je) { console.error("Re-journal (supplier payment):", je); }

    await createAuditLog(user.userId, null, "supplier_payments", id, "update",
      { amountUsd: Number(existing.amountUsd) }, { amountUsd: Number(updated.amountUsd) }, getClientIP(request));
    return successResponse({ id }, "Payment updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.supplierPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Supplier payment not found", 404);

    try { await reverseJournalEntries(`SUPPPAY-${id}`, user.userId); } catch (je) { console.error("Reverse journal (supplier payment delete):", je); }

    await prisma.supplierPayment.delete({ where: { id } });
    await createAuditLog(user.userId, null, "supplier_payments", id, "delete",
      { amountUsd: Number(existing.amountUsd), supplierId: existing.supplierId }, undefined, getClientIP(request));
    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
