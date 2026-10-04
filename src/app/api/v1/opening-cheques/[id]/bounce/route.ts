import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { journalOpeningChequeBounced } from "@/lib/accounting";
import { foreignCurrencyOwnerKey, transferForeignCurrencyLayers } from "@/lib/foreign-currency-carrying-db";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" && user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only city or super admins can bounce opening cheques", 403);
    const id = Number(context.params?.id);
    const body = await request.json();
    const reason = String(body.reason || "").trim();
    if (!reason) return errorResponse("VALIDATION_ERROR", "Bounce reason is required", 400);
    const existing = await prisma.openingCheque.findUnique({ where: { id }, include: { currency: true } });
    if (!existing || (user.role === "city_admin" && existing.cityId !== user.cityId)) return errorResponse("NOT_FOUND", "Opening cheque not found", 404);
    if (existing.chequeStatus !== "in_hand") return errorResponse("CONFLICT", "Only an in-hand opening cheque can be bounced", 409);
    const bouncedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const updated = await tx.openingCheque.updateMany({ where: { id, chequeStatus: "in_hand" }, data: { chequeStatus: "bounced", bouncedAt, bouncedBy: user.userId, notes: [existing.notes, `Bounce: ${reason}`].filter(Boolean).join("\n") } });
      if (updated.count !== 1) throw new Error("OPENING_CHEQUE_ALREADY_MOVED");
      await journalOpeningChequeBounced({ id, customerId: existing.customerId, cityId: existing.cityId, carryingAmountPkr: Number(existing.carryingAmountPkr ?? existing.amount), bounceDate: bouncedAt, createdBy: user.userId }, tx);
      if (isSupportedForeignCurrency(existing.currency.code)) await transferForeignCurrencyLayers(tx, { sourceOwnerKey: foreignCurrencyOwnerKey.cityCheque(existing.cityId), targetOwnerKey: foreignCurrencyOwnerKey.customerReceivable(existing.customerId), targetPositionType: "other_receivable", currencyCode: existing.currency.code, amount: Number(existing.amount), sourceType: "opening_cheque_bounce", sourceId: id, movementDate: bouncedAt, createdBy: user.userId });
    });
    await createAuditLog(user.userId, existing.cityId, "opening_cheques", id, "update", { chequeStatus: "in_hand" }, { chequeStatus: "bounced", reason }, getClientIP(request));
    return successResponse({ id, chequeStatus: "bounced" }, "Opening cheque marked as bounced");
  } catch (error) {
    console.error("Opening cheque bounce error:", error);
    return serverError();
  }
});
