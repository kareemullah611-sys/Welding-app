import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { agentPaymentJournalTransactionId, reverseJournalEntries, journalAgentPaid } from "@/lib/accounting";
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
    if (!existing || existing.deletedAt) return errorResponse("NOT_FOUND", "Payment not found", 404);

    if (!existing.agent.isActive) return errorResponse("VALIDATION_ERROR", "Cannot update payments for an inactive agent");
    if (String(existing.currencyCode).toUpperCase() !== "PKR") {
      return errorResponse("FOREIGN_CARRYING_LAYER_REQUIRED", "Foreign-currency agent payments cannot be edited until their payable and funding-asset carrying layers are recorded atomically.", 409);
    }

    const amount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
    if (!Number.isFinite(amount) || amount <= 0) return errorResponse("VALIDATION_ERROR", "Amount must be greater than 0");

    const source = await validatePaymentSource({
      bankAccountId: body.bankAccountId !== undefined ? body.bankAccountId : existing.bankAccountId,
      superAdminBankAccountId: body.superAdminBankAccountId !== undefined ? body.superAdminBankAccountId : existing.superAdminBankAccountId,
      superAdminCashAccountId: body.superAdminCashAccountId !== undefined ? body.superAdminCashAccountId : existing.superAdminCashAccountId,
      intermediaryId: body.intermediaryId !== undefined ? body.intermediaryId : existing.intermediaryId,
      cityId: existing.cityId,
      currencyCode: existing.currencyCode,
      requireSelection: true,
    });
    if (!source.ok) return errorResponse(source.code, source.message, source.status);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `agent-payment:${id}`);
      const locked = await tx.agentPayment.findUnique({ where: { id } });
      if (!locked || locked.deletedAt || locked.journalVersion !== existing.journalVersion) throw Object.assign(new Error("Payment changed; reload and retry"), { code: "PAYMENT_CHANGED_RETRY" });
      await reverseJournalEntries(agentPaymentJournalTransactionId(id, locked.journalVersion), user.userId, tx);
      const updated = await tx.agentPayment.update({
        where: { id },
        data: {
          amount,
          bankAccountId: source.bankAccountId,
          superAdminBankAccountId: source.superAdminBankAccountId,
          superAdminCashAccountId: source.superAdminCashAccountId,
          intermediaryId: source.intermediaryId,
          reference: body.reference !== undefined ? body.reference || null : undefined,
          notes: body.notes !== undefined ? body.notes || null : undefined,
          journalVersion: { increment: 1 },
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
        superAdminBankAccountId: source.superAdminBankAccountId,
        superAdminCashAccountId: source.superAdminCashAccountId,
        intermediaryId: source.intermediaryId,
        journalVersion: updated.journalVersion,
      }, tx);
      await createAuditLog(user.userId, existing.cityId, "agent_payments", id, "update",
        { amount: Number(existing.amount) }, { amount: Number(updated.amount) }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Payment updated");
  } catch (error) {
    if ((error as any)?.code === "PAYMENT_CHANGED_RETRY") return errorResponse("PAYMENT_CHANGED_RETRY", error instanceof Error ? error.message : "Payment changed; reload and retry", 409);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.agentPayment.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return errorResponse("NOT_FOUND", "Payment not found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", `agent-payment:${id}`);
      const locked = await tx.agentPayment.findUnique({ where: { id } });
      if (!locked || locked.deletedAt) return;
      await reverseJournalEntries(agentPaymentJournalTransactionId(id, locked.journalVersion), user.userId, tx);
      await tx.agentPayment.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: user.userId } });
      await createAuditLog(user.userId, existing.cityId, "agent_payments", id, "delete",
        { amount: Number(existing.amount), agentId: existing.agentId }, undefined, getClientIP(request as any), tx);
    });

    return successResponse({ id }, "Payment deleted");
  } catch (error) { return serverError(); }
});
