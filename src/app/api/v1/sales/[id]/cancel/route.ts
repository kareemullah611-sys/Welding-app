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

    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (sale.status === "cancelled") return errorResponse("VALIDATION_ERROR", "Sale already cancelled");
    if (user.role === "city_admin" && sale.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const updated = await prisma.sale.update({
      where: { id },
      data: { status: "cancelled", cancellationReason: body.reason, cancelledAt: new Date(), cancelledBy: user.userId, updatedAt: new Date() },
    });

    await createAuditLog(user.userId, sale.cityId, "sales", id, "cancel", { status: "active" }, { status: "cancelled", reason: body.reason }, getClientIP(request));

    // Reverse journal entries so accounting books stay balanced
    try { await reverseJournalEntries(`SALE-${id}`, user.userId); } catch (je) { console.error("Journal reversal error (sale cancel):", je); }

    return successResponse({ id, status: "cancelled" }, "Sale cancelled");
  } catch (error) {
    return serverError();
  }
});
