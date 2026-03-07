import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const existing = await prisma.lotCost.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Lot cost not found", 404);

    const updated = await prisma.lotCost.update({
      where: { id },
      data: {
        description: body.description ?? existing.description,
        amount: body.amount ?? existing.amount,
        exchangeRate: body.exchangeRate ?? existing.exchangeRate,
        notes: body.notes ?? existing.notes,
      },
    });
    await createAuditLog(user.userId, null, "lot_costs", id, "update",
      { amount: Number(existing.amount), description: existing.description },
      { amount: Number(updated.amount), description: updated.description }, getClientIP(request));
    return successResponse({ id }, "Cost updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const existing = await prisma.lotCost.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Lot cost not found", 404);

    await prisma.lotCost.delete({ where: { id } });
    await createAuditLog(user.userId, null, "lot_costs", id, "delete",
      { amount: Number(existing.amount), costType: existing.costType, lotId: existing.lotId },
      undefined, getClientIP(request));
    return successResponse({ id }, "Cost deleted");
  } catch (error) { return serverError(); }
});
