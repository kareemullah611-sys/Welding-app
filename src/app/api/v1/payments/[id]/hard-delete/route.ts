import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, comparePassword } from "@/lib/auth";
import { paymentHistoryJournalWhere } from "@/lib/hard-delete-history";

// DELETE /api/v1/payments/:id/hard-delete
// Super admin only — permanently removes a payment record from the database.
// Requires the super admin to supply their current password as 2FA confirmation.
export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can permanently delete records", 403);

    const id = parseInt(context.params.id);
    const body = await request.json();
    if (!body.password) return validationError("Password confirmation is required");

    // 2FA: verify super admin password
    const admin = await prisma.user.findUnique({ where: { id: user.userId } });
    if (!admin) return errorResponse("NOT_FOUND", "Admin user not found", 404);
    const valid = await comparePassword(body.password, admin.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Incorrect password", 401);

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { customer: { select: { name: true } }, currency: { select: { code: true, symbol: true } } },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (String(payment.currency.code).toUpperCase() !== "PKR") {
      return errorResponse("FOREIGN_CARRYING_LAYER_REQUIRED", "Foreign-currency payments cannot be permanently deleted because their immutable carrying history must be preserved; use audited cancellation.", 409);
    }

    await prisma.$transaction(async (tx) => {
      // H2: a cancelled payment carries REV-PAY/REV-ADJPAY reversal rows that are
      // immutable audit history (C1 parity) — block instead of orphaning them.
      if (payment.status === "cancelled") {
        throw new Error("PAYMENT_CANCELLED_HISTORY");
      }
      // H2: a cheque inside a bank deposit must be removed from the deposit first —
      // deleting it here would leave the deposit total and its DEP-* journals orphaned.
      if ((payment as any).bankDepositId != null || (payment as any).chequeStatus === "deposited_to_bank") {
        throw new Error("PAYMENT_IN_DEPOSIT");
      }
      // H2: referenced cheques are SetNull-linked — deleting would silently detach them.
      const [expenseRefs, withdrawalRefs, liabilityRefs] = await Promise.all([
        tx.expense.count({ where: { chequePaymentId: id } }),
        tx.personalWithdrawal.count({ where: { chequePaymentId: id } }),
        tx.cityLiabilityEntry.count({ where: { chequePaymentId: id } }),
      ]);
      if (expenseRefs + withdrawalRefs + liabilityRefs > 0) {
        throw new Error("PAYMENT_IN_USE");
      }
      // H2: refuse once the payment has accounting history (PAY/ADJPAY journals,
      // or HAJI/REV-HAJI journals of a linked transfer) — only journal-less rows
      // may be erased; journals are immutable.
      const linkedHajiTransfers = await tx.hajiTransfer.findMany({
        where: { OR: [{ paymentId: id }, { chequePaymentId: id }] },
        select: { id: true },
      });
      const hajiTransactionIds = linkedHajiTransfers.flatMap((transfer) => [
        `HAJI-${transfer.id}`,
        `REV-HAJI-${transfer.id}`,
      ]);
      const historyCount = await tx.journalEntry.count({
        where: { OR: [paymentHistoryJournalWhere([id]), { transactionId: { in: hajiTransactionIds } }] },
      });
      if (historyCount > 0) {
        throw Object.assign(new Error("Payment has accounting history"), { code: "PAYMENT_HAS_ACCOUNTING_HISTORY" });
      }
      if (linkedHajiTransfers.length > 0) {
        await tx.hajiTransfer.deleteMany({ where: { id: { in: linkedHajiTransfers.map((transfer) => transfer.id) } } });
      }
      await (tx as any).paymentLotTransfer.deleteMany({ where: { paymentId: id } });
      await tx.payment.delete({ where: { id } });
      await createAuditLog(user.userId, payment.cityId, "payments", id, "hard_delete", {
        date: payment.paymentDate.toISOString().split("T")[0],
        customer: payment.customer.name,
        detail: payment.detail,
        amount: `${payment.currency.symbol || payment.currency.code} ${Number(payment.amount).toLocaleString("en-US")}`,
        ...(payment.destination ? { destination: payment.destination } : {}),
        ...(payment.notes ? { notes: payment.notes } : {}),
      }, undefined, getClientIP(request), tx);
    });
    return successResponse({ id }, "Payment permanently deleted");
  } catch (error) {
    if ((error as any)?.code === "PAYMENT_HAS_ACCOUNTING_HISTORY") {
      return errorResponse("PAYMENT_HAS_ACCOUNTING_HISTORY", "Payments with accounting history cannot be permanently deleted. Cancel the payment instead.", 409);
    }
    if ((error as any)?.message === "PAYMENT_CANCELLED_HISTORY") {
      return errorResponse("CONFLICT", "Cancelled payments cannot be permanently deleted: their reversal journals are audit history. Keep the cancelled record.", 409);
    }
    if ((error as any)?.message === "PAYMENT_IN_DEPOSIT") {
      return errorResponse("CONFLICT", "Cannot permanently delete a cheque that belongs to a bank deposit — remove it from the deposit first.", 409);
    }
    if ((error as any)?.message === "PAYMENT_IN_USE") {
      return errorResponse("CONFLICT", "Cannot permanently delete a cheque that is still referenced by an expense, withdrawal, or liability entry — detach it there first.", 409);
    }
    console.error("Hard delete payment error:", error);
    return serverError();
  }
});
