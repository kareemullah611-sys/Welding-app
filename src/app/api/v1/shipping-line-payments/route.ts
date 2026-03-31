import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { journalShippingLinePayment } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  try {
    const body = await request.json();
    const { shippingLineId, lotId, paymentDate, amountUsd, exchangeRate, reference, notes, bankAccountId, intermediaryId } = body;

    if (!shippingLineId || !paymentDate || !amountUsd) return validationError("shippingLineId, paymentDate, and amountUsd are required");
    if (Number(amountUsd) <= 0) return validationError("Amount must be greater than 0");

    const sl = await prisma.shippingLine.findUnique({ where: { id: shippingLineId } });
    if (!sl) return errorResponse("NOT_FOUND", "Shipping line not found", 404);

    const amountPkr = exchangeRate ? Math.round(Number(amountUsd) * Number(exchangeRate) * 100) / 100 : null;

    const payment = await prisma.shippingLinePayment.create({
      data: {
        shippingLineId,
        lotId: lotId || null,
        bankAccountId: bankAccountId || null,
        intermediaryId: intermediaryId || null,
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
      { shippingLineId, amountUsd, bankAccountId, intermediaryId }, getClientIP(request));

    try {
      await journalShippingLinePayment({ id: payment.id, shippingLineId, amountUsd: Number(amountUsd), paymentDate: new Date(paymentDate), createdBy: user.userId, bankAccountId: bankAccountId || null, intermediaryId: intermediaryId || null });
    } catch (je) { console.error("Journal (shipping line payment):", je); }

    return successResponse({ id: payment.id, amountUsd: Number(payment.amountUsd), amountPkr }, "Payment recorded", 201);
  } catch (error) { console.error("Create shipping line payment:", error); return serverError(); }
});
