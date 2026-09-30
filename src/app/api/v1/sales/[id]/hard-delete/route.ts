import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, comparePassword } from "@/lib/auth";
import { saleHistoryJournalWhere } from "@/lib/hard-delete-history";

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
        currency: { select: { code: true } },
        items: { include: { product: { select: { name: true } } }, take: 5 },
      },
    });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (sale.status === "cancelled") {
      return errorResponse(
        "CONFLICT",
        "Cancelled sales cannot be permanently deleted: their reversal journals are audit history. Keep the cancelled record.",
        409
      );
    }
    if (String(sale.currency.code).toUpperCase() !== "PKR") {
      return errorResponse("FOREIGN_CARRYING_LAYER_REQUIRED", "Foreign-currency sales cannot be permanently deleted because their immutable carrying history must be preserved; use audited cancellation.", 409);
    }

    await prisma.$transaction(async (tx) => {
      // C1: a cancelled walk-in payment carries REV-PAY/REV-ADJPAY reversal rows
      // that are immutable audit history — block instead of orphaning them.
      const walkinPayment =
        sale.customer.name === "Walk-in Customer"
          ? await tx.payment.findFirst({ where: { saleId: sale.id }, select: { id: true, status: true } })
          : null;
      if (walkinPayment?.status === "cancelled") {
        throw new Error("WALKIN_PAYMENT_CANCELLED");
      }
      // C1: refuse once the sale has accounting history (SALE/COGS/DISCOUNT or
      // walk-in PAY/ADJPAY journals) — only journal-less rows may be erased.
      const discountIds = await tx.saleDiscount.findMany({ where: { saleId: id }, select: { id: true } });
      const historyCount = await tx.journalEntry.count({
        where: saleHistoryJournalWhere(id, discountIds.map((d) => d.id), walkinPayment ? [walkinPayment.id] : []),
      });
      if (historyCount > 0) {
        throw Object.assign(new Error("Sale has accounting history"), { code: "SALE_HAS_ACCOUNTING_HISTORY" });
      }

      await tx.saleDiscount.deleteMany({ where: { saleId: id } });
      await tx.saleItem.deleteMany({ where: { saleId: id } });

      // Journal-less walk-in sale: remove the auto-payment row too (no journals exist).
      if (walkinPayment) {
        await (tx as any).paymentLotTransfer.deleteMany({ where: { paymentId: walkinPayment.id } });
        await tx.payment.delete({ where: { id: walkinPayment.id } });
      }

      await tx.sale.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: user.userId,
          cityId: sale.cityId,
          entityType: "sales",
          entityId: id,
          action: "hard_delete",
          newValues: {
            voucher: `#${sale.voucherNo}`,
            date: sale.saleDate.toISOString().split("T")[0],
            customer: sale.customer.name,
            total: `${Number(sale.totalAmount).toLocaleString("en-US")}`,
            items: sale.items.map((i: any) => `${i.product.name} ×${Number(i.qty)}`).join(", ") || undefined,
            ...(sale.notes ? { notes: sale.notes } : {}),
          },
          ipAddress: getClientIP(request),
        },
      });
    });
    return successResponse({ id }, "Sale permanently deleted");
  } catch (error) {
    if ((error as any)?.code === "SALE_HAS_ACCOUNTING_HISTORY") {
      return errorResponse(
        "SALE_HAS_ACCOUNTING_HISTORY",
        "Sales with accounting history cannot be permanently deleted. Cancel the sale instead.",
        409
      );
    }
    if ((error as any)?.message === "WALKIN_PAYMENT_CANCELLED") {
      return errorResponse(
        "CONFLICT",
        "The walk-in payment for this sale is cancelled: its reversal journals are audit history. Keep the cancelled record before permanently deleting the sale.",
        409
      );
    }
    console.error("Hard delete sale error:", error);
    return serverError();
  }
});
