import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalSaleDiscount } from "@/lib/accounting";

// POST /api/v1/sales/:id/discount
export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const saleId = parseInt(context.params.id);
    const body = await request.json();
    const { discountAmount, notes, discountDate } = body;

    if (!discountAmount || discountAmount <= 0) return validationError("Discount amount must be positive");

    const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { lot: true } });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (sale.status !== "active") return errorResponse("VALIDATION_ERROR", "Can only discount active sales");
    if (user.role === "city_admin" && sale.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    // Always apply discount to the current ongoing FIFO lot for that city/country.
    const fifoLot = await prisma.lot.findFirst({
      where: { countryId: sale.lot.countryId, status: "ongoing", lotCityDistributions: { some: { cityId: sale.cityId } } },
      orderBy: [{ lotDate: "asc" }, { id: "asc" }],
    });
    if (!fifoLot) return errorResponse("VALIDATION_ERROR", "No ongoing lot available to apply discount");
    const appliedToLotId = fifoLot.id;

    const appliedDate = discountDate ? new Date(discountDate) : new Date();
    if (Number.isNaN(appliedDate.getTime())) return validationError("Invalid discount date");
    const discount = await prisma.$transaction(async (tx) => {
      const created = await tx.saleDiscount.create({
        data: {
          saleId, discountAmount, currencyId: sale.currencyId, appliedToLotId,
          notes: notes || null, discountDate: appliedDate, createdBy: user.userId,
        },
      });
      await tx.sale.update({
        where: { id: saleId },
        data: { totalAmount: { decrement: discountAmount }, updatedAt: new Date() },
      });
      const currency = await tx.currency.findUnique({ where: { id: sale.currencyId }, select: { code: true } });
      if (!currency) throw new Error("Sale currency not found");
      await journalSaleDiscount({
        id: created.id,
        saleId,
        customerId: sale.customerId,
        cityId: sale.cityId,
        lotId: appliedToLotId,
        amount: Number(discountAmount),
        currencyCode: currency.code,
        discountDate: appliedDate,
        createdBy: user.userId,
      }, tx);
      await createAuditLog(user.userId, sale.cityId, "sale_discounts", created.id, "create", undefined, { saleId, discountAmount, appliedToLotId }, getClientIP(request), tx);
      return created;
    });

    return successResponse({
      id: discount.id, saleId, discountAmount: Number(discount.discountAmount),
      appliedToLotId, originalLotCompleted: sale.lot.status === "completed",
    }, "Discount applied");
  } catch (error) {
    return serverError();
  }
});
