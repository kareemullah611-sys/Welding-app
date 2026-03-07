import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true, lot: { select: { id: true, lotNumber: true, status: true } },
        godown: { select: { id: true, name: true } }, currency: true,
        creator: { select: { id: true, fullName: true } },
        canceller: { select: { id: true, fullName: true } },  // was: cancelledByUser (wrong)
        items: { include: { product: true } },                 // was: saleItems (wrong)
        discounts: { include: { currency: true, appliedToLot: { select: { lotNumber: true } } } }, // was: saleDiscounts (wrong)
      },
    });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (user.role === "city_admin" && sale.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    return successResponse({
      id: sale.id, voucherNo: sale.voucherNo, saleDate: sale.saleDate.toISOString().split("T")[0],
      status: sale.status, stockShortFlag: sale.stockShortFlag, notes: sale.notes,
      totalAmount: Number(sale.totalAmount),
      customer: { id: sale.customer.id, name: sale.customer.name, phone: sale.customer.phone },
      lot: sale.lot, godown: sale.godown,
      currency: { id: sale.currency.id, code: sale.currency.code, symbol: sale.currency.symbol },
      items: sale.items.map((i) => ({
        id: i.id, productId: i.productId, productName: i.product.name,
        qty: Number(i.qty), ratePerCarton: Number(i.ratePerCarton), amount: Number(i.amount),
      })),
      discounts: sale.discounts.map((d) => ({
        id: d.id, amount: Number(d.discountAmount), date: d.discountDate.toISOString().split("T")[0],
        notes: d.notes, appliedToLot: d.appliedToLot?.lotNumber || null,
      })),
      createdBy: sale.creator,
      cancellation: sale.status === "cancelled"
        ? { reason: sale.cancellationReason, at: sale.cancelledAt?.toISOString(), by: sale.canceller }
        : null,
    });
  } catch (error) {
    return serverError();
  }
});
