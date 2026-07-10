import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, comparePassword } from "@/lib/auth";

// DELETE /api/v1/sales/:id/hard-delete
// Super admin only — permanently removes a sale record from the database.
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

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true } },
        items: { include: { product: { select: { name: true } } }, take: 5 },
      },
    });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);

    await prisma.$transaction(async (tx) => {
      // Fix: also remove COGS-* entries — sale creation posts SALE-* AND COGS-* journals
      await tx.journalEntry.deleteMany({ where: { transactionId: `SALE-${id}` } });
      await tx.journalEntry.deleteMany({ where: { transactionId: `COGS-${id}` } });
      await tx.saleDiscount.deleteMany({ where: { saleId: id } });
      await tx.saleItem.deleteMany({ where: { saleId: id } });

      // Fix: for walk-in sales, auto-payment was created at sale time — remove it too.
      // Fix C1: drop manualVoucherNo fallback — saleId is the only reliable link.
      if (sale.customer.name === "Walk-in Customer") {
        const walkinPayment = await tx.payment.findFirst({
          where: {
            saleId: sale.id,
          },
          select: { id: true },
        });
        if (walkinPayment) {
          await tx.journalEntry.deleteMany({ where: { transactionId: `PAY-${walkinPayment.id}` } });
          await (tx as any).paymentLotTransfer.deleteMany({ where: { paymentId: walkinPayment.id } });
          await tx.payment.delete({ where: { id: walkinPayment.id } });
        }
      }

      await tx.sale.delete({ where: { id } });
    });

    await createAuditLog(user.userId, sale.cityId, "sales", id, "hard_delete", {
      voucher: `#${sale.voucherNo}`,
      date: sale.saleDate.toISOString().split("T")[0],
      customer: sale.customer.name,
      total: `${Number(sale.totalAmount).toLocaleString("en-US")}`,
      items: sale.items.map((i: any) => `${i.product.name} ×${Number(i.qty)}`).join(", ") || undefined,
      ...(sale.notes ? { notes: sale.notes } : {}),
    }, undefined, getClientIP(request));
    return successResponse({ id }, "Sale permanently deleted");
  } catch (error) {
    console.error("Hard delete sale error:", error);
    return serverError();
  }
});
