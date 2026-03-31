import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalAgentPaid } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    const existing = await prisma.agentPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    try { await reverseJournalEntries(`AGENTPAY-${id}`, user.userId); } catch (je) { console.error("Reverse journal (agent payment):", je); }

    const bankAccountId = body.bankAccountId !== undefined ? (body.bankAccountId || null) : (existing as any).bankAccountId;
    const intermediaryId = body.intermediaryId !== undefined ? (body.intermediaryId || null) : (existing as any).intermediaryId;

    const updated = await prisma.agentPayment.update({
      where: { id },
      data: {
        amount: body.amount ? Number(body.amount) : undefined,
        bankAccountId,
        intermediaryId,
        reference: body.reference !== undefined ? body.reference || null : undefined,
        notes: body.notes !== undefined ? body.notes || null : undefined,
      },
    });

    try {
      await journalAgentPaid({ id, agentId: existing.agentId, cityId: existing.cityId, amount: Number(updated.amount), currencyCode: existing.currencyCode, paymentDate: existing.paymentDate, createdBy: user.userId, bankAccountId, intermediaryId });
    } catch (je) { console.error("Re-journal (agent payment):", je); }

    await createAuditLog(user.userId, existing.cityId, "agent_payments", id, "update",
      { amount: Number(existing.amount) }, { amount: Number(updated.amount) }, getClientIP(request));

    return successResponse({ id }, "Payment updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.agentPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    try { await reverseJournalEntries(`AGENTPAY-${id}`, user.userId); } catch (je) { console.error("Reverse journal (agent payment delete):", je); }

    await prisma.agentPayment.delete({ where: { id } });

    await createAuditLog(user.userId, existing.cityId, "agent_payments", id, "delete",
      { amount: Number(existing.amount), agentId: existing.agentId }, undefined, getClientIP(request as any));

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
