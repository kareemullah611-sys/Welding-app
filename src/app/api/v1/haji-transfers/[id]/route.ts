import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const h = await prisma.hajiTransfer.findUnique({ where: { id } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    await prisma.hajiTransfer.update({ where: { id }, data: { amount: body.amount || h.amount, detail: body.detail || h.detail, notes: body.notes !== undefined ? body.notes : h.notes, updatedAt: new Date() } });
    await createAuditLog(user.userId, h.cityId, "haji_transfers", id, "update", { amount: Number(h.amount) }, { amount: body.amount }, getClientIP(request));
    return successResponse({ id }, "Updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const h = await prisma.hajiTransfer.findUnique({ where: { id } });
    if (!h) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && h.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    await prisma.hajiTransfer.delete({ where: { id } });
    await createAuditLog(user.userId, h.cityId, "haji_transfers", id, "delete", undefined, undefined, getClientIP(request));
    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
