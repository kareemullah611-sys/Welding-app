import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  try {
    const body = await request.json();
    const { shippingLineId, lotId, paymentDate, amountUsd, exchangeRate, reference, notes, bankAccountId, intermediaryId } = body;
    const parsedShippingLineId = Number(shippingLineId);
    const parsedLotId = lotId ? Number(lotId) : null;

    if (!parsedShippingLineId || !paymentDate || !amountUsd) return validationError("shippingLineId, paymentDate, and amountUsd are required");
    if (Number(amountUsd) <= 0) return validationError("Amount must be greater than 0");

    const [sl, lot, source] = await Promise.all([
      prisma.shippingLine.findUnique({ where: { id: parsedShippingLineId }, select: { id: true } }),
      parsedLotId ? prisma.lot.findUnique({ where: { id: parsedLotId }, select: { id: true } }) : Promise.resolve(null),
      validatePaymentSource({ bankAccountId, intermediaryId, requireSelection: true }),
    ]);
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    if (parsedLotId && !lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (!source.ok) return errorResponse(source.code, source.message, source.status);

    const amountPkr = exchangeRate ? Math.round(Number(amountUsd) * Number(exchangeRate) * 100) / 100 : null;

    const payment = await prisma.shippingLinePayment.create({
      data: {
        shippingLineId: parsedShippingLineId,
        lotId: parsedLotId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
        paymentDate: new Date(paymentDate),
        amountUsd: Number(amountUsd),
        exchangeRate: exchangeRate ? Number(exchangeRate) : null,
        amountPkr,
        reference: reference || null,
        notes: notes || null,
        createdBy: user.userId,
      },
    });

    await createAuditLog(user.userId, null, "shipping_line_payments", payment.id, "create", undefined,
      { shippingLineId: parsedShippingLineId, amountUsd, bankAccountId: source.bankAccountId, intermediaryId: source.intermediaryId }, getClientIP(request));

    try {
      await journalShippingLinePayment({
        id: payment.id,
        shippingLineId: parsedShippingLineId,
        amountUsd: Number(amountUsd),
        paymentDate: new Date(paymentDate),
        createdBy: user.userId,
        bankAccountId: source.bankAccountId,
        intermediaryId: source.intermediaryId,
      });
    } catch (je) { console.error("Journal (shipping line payment):", je); }

    return successResponse({ id: payment.id, amountUsd: Number(payment.amountUsd), amountPkr }, "Payment recorded", 201);
  } catch (error) { console.error("Create shipping line payment:", error); return serverError(); }
});
