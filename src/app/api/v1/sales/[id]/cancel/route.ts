import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { reverseJournalEntries } from "@/lib/accounting";

// PUT /api/v1/sales/:id/cancel
export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    if (!body.reason) return validationError("Cancellation reason is required");

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true } },
        items: { include: { product: { select: { name: true } } }, take: 5 },
      },
    });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (sale.status === "cancelled") return errorResponse("VALIDATION_ERROR", "Sale already cancelled");
    if (user.role === "city_admin" && sale.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    await prisma.$transaction(async (tx) => {
      await tx.sale.update({
        where: { id },
        data: { status: "cancelled", cancellationReason: body.reason, cancelledAt: new Date(), cancelledBy: user.userId, updatedAt: new Date() },
      });

      await createAuditLog(user.userId, sale.cityId, "sales", id, "cancel", {
        voucher: `#${sale.voucherNo}`,
        date: sale.saleDate.toISOString().split("T")[0],
        customer: sale.customer.name,
        total: `${Number(sale.totalAmount).toLocaleString("en-US")}`,
        items: sale.items.map((i: any) => `${i.product.name} ×${Number(i.qty)}`).join(", ") || undefined,
        ...(sale.notes ? { notes: sale.notes } : {}),
      }, { reason: body.reason }, getClientIP(request), tx);

      await reverseJournalEntries(`SALE-${id}`, user.userId, tx);
      await reverseJournalEntries(`COGS-${id}`, user.userId, tx);

      // If walk-in sale, cancel the auto-created payment and reverse its journal.
      if (sale.customer.name === "Walk-in Customer") {
        const walkinPayment = await tx.payment.findFirst({
          where: {
            OR: [
              { saleId: sale.id },
              {
                manualVoucherNo: String(sale.voucherNo),
                customerId: sale.customerId,
                cityId: sale.cityId,
              },
            ],
            status: "active",
          },
        });
        if (walkinPayment) {
          await tx.payment.update({
            where: { id: walkinPayment.id },
            data: { status: "cancelled", notes: `${walkinPayment.notes || ""}\n[Auto-cancelled: linked sale #${sale.voucherNo} was cancelled. Reason: ${body.reason}]`.trim() },
          });
          await reverseJournalEntries(`PAY-${walkinPayment.id}`, user.userId, tx);
        }
      }
    });

    return successResponse({ id, status: "cancelled" }, "Sale cancelled");
  } catch (error) {
    return serverError();
  }
});
