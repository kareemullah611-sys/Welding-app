import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { customer: true, lot: { select: { id: true, lotNumber: true } }, currency: true, creator: { select: { id: true, fullName: true } } },
    });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    return successResponse({
      id: payment.id, paymentDate: payment.paymentDate.toISOString().split("T")[0],
      amount: Number(payment.amount), detail: payment.detail, notes: payment.notes,
      manualVoucherNo: payment.manualVoucherNo, paymentMethod: payment.paymentMethod,
      destination: payment.destination, status: payment.status,
      customer: { id: payment.customer.id, name: payment.customer.name },
      lot: payment.lot, currency: { id: payment.currency.id, code: payment.currency.code, symbol: payment.currency.symbol },
      createdBy: payment.creator,
    });
  } catch (error) {
    return serverError();
  }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) return errorResponse("NOT_FOUND", "Payment not found", 404);
    if (payment.status !== "active") return errorResponse("VALIDATION_ERROR", "Cannot edit cancelled payment");
    if (user.role === "city_admin" && payment.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const old = { amount: Number(payment.amount), detail: payment.detail };
    const updated = await prisma.payment.update({
      where: { id },
      data: {
        detail: body.detail || payment.detail,
        amount: body.amount || payment.amount,
        notes: body.notes !== undefined ? body.notes : payment.notes,
        updatedAt: new Date(),
      },
    });

    await createAuditLog(user.userId, payment.cityId, "payments", id, "update", old, { amount: Number(updated.amount), detail: updated.detail }, getClientIP(request));
    return successResponse({ id }, "Payment updated");
  } catch (error) {
    return serverError();
  }
});
