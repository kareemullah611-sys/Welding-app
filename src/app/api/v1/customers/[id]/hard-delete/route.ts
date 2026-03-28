import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, comparePassword } from "@/lib/auth";

// DELETE /api/v1/customers/:id/hard-delete
// Super admin only — permanently removes customer and all associated records.
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

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found", 404);

    // Hard delete — permanently removes customer and all their sales, payments, and journal entries
    await prisma.$transaction(async (tx) => {
      // Remove journal entries and child rows for all sales
      const sales = await tx.sale.findMany({ where: { customerId: id }, select: { id: true } });
      for (const sale of sales) {
        await tx.journalEntry.deleteMany({ where: { transactionId: `SALE-${sale.id}` } });
        await tx.saleDiscount.deleteMany({ where: { saleId: sale.id } });
        await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
      }
      await tx.sale.deleteMany({ where: { customerId: id } });

      // Remove journal entries for all payments
      const payments = await tx.payment.findMany({ where: { customerId: id }, select: { id: true } });
      const paymentIds = payments.map((p) => p.id);
      for (const payment of payments) {
        await tx.journalEntry.deleteMany({ where: { transactionId: `PAY-${payment.id}` } });
      }
      // Null out chequePaymentId on any haji transfers referencing these payments
      // (avoids FK constraint violation when deleting payments)
      if (paymentIds.length > 0) {
        await (tx as any).hajiTransfer.updateMany({
          where: { chequePaymentId: { in: paymentIds } },
          data: { chequePaymentId: null },
        });
        // Delete PaymentLotTransfer records referencing these payments
        await (tx as any).paymentLotTransfer.deleteMany({ where: { paymentId: { in: paymentIds } } });
      }
      await tx.payment.deleteMany({ where: { customerId: id } });

      await tx.customer.delete({ where: { id } });
    });

    await createAuditLog(user.userId, customer.cityId, "customers", id, "hard_delete", { name: customer.name }, undefined, getClientIP(request));
    return successResponse({ id }, "Customer permanently deleted");
  } catch (error) {
    console.error("Hard delete customer error:", error);
    return serverError();
  }
});
