import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

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

    // If original lot is completed, apply discount to current FIFO lot
    let appliedToLotId = sale.lotId;
    if (sale.lot.status === "completed") {
      const fifoLot = await prisma.lot.findFirst({
        where: { countryId: sale.lot.countryId, status: "ongoing", lotCityDistributions: { some: { cityId: sale.cityId } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      });
      if (fifoLot) appliedToLotId = fifoLot.id;
    }

    const discount = await prisma.saleDiscount.create({
      data: {
        saleId, discountAmount, currencyId: sale.currencyId, appliedToLotId,
        notes: notes || null, discountDate: discountDate ? new Date(discountDate) : new Date(), createdBy: user.userId,
      },
    });

    // Update sale total
    await prisma.sale.update({
      where: { id: saleId },
      data: { totalAmount: { decrement: discountAmount }, updatedAt: new Date() },
    });

    await createAuditLog(user.userId, sale.cityId, "sale_discounts", discount.id, "create", undefined, { saleId, discountAmount, appliedToLotId }, getClientIP(request));

    return successResponse({
      id: discount.id, saleId, discountAmount: Number(discount.discountAmount),
      appliedToLotId, originalLotCompleted: sale.lot.status === "completed",
    }, "Discount applied");
  } catch (error) {
    return serverError();
  }
});
