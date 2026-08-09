import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { reverseJournalEntries, journalAgentPaid } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    const existing = await prisma.agentPayment.findUnique({
      where: { id },
      include: { agent: { select: { cityId: true, isActive: true } } },
    });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    if (!existing.agent.isActive) return errorResponse("VALIDATION_ERROR", "Cannot update payments for an inactive agent");

    const amount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
    if (!Number.isFinite(amount) || amount <= 0) return errorResponse("VALIDATION_ERROR", "Amount must be greater than 0");

    const source = await validatePaymentSource({
      bankAccountId: body.bankAccountId !== undefined ? body.bankAccountId : existing.bankAccountId,
      intermediaryId: body.intermediaryId !== undefined ? body.intermediaryId : existing.intermediaryId,
      cityId: existing.cityId,
    });
    if (!source.ok) return errorResponse(source.code, source.message, source.status);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`AGENTPAY-${id}`, user.userId, tx);
      const updated = await tx.agentPayment.update({
        where: { id },
        data: {
          amount,
          bankAccountId: source.bankAccountId,
          intermediaryId: source.intermediaryId,
          reference: body.reference !== undefined ? body.reference || null : undefined,
          notes: body.notes !== undefined ? body.notes || null : undefined,
        },
      });
      await journalAgentPaid({
        id,
        agentId: existing.agentId,
        cityId: existing.cityId,
        amount: Number(updated.amount),
        currencyCode: existing.currencyCode,
        paymentDate: existing.paymentDate,
        createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
      }, tx);
      await createAuditLog(user.userId, existing.cityId, "agent_payments", id, "update",
        { amount: Number(existing.amount) }, { amount: Number(updated.amount) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.agentPayment.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await reverseJournalEntries(`AGENTPAY-${id}`, user.userId, tx);
      await tx.agentPayment.delete({ where: { id } });
      await createAuditLog(user.userId, existing.cityId, "agent_payments", id, "delete",
        { amount: Number(existing.amount), agentId: existing.agentId }, undefined, getClientIP(request as any), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
