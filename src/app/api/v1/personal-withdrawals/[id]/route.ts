import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const w = await prisma.personalWithdrawal.findUnique({ where: { id } });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    await prisma.personalWithdrawal.update({ where: { id }, data: { amount: body.amount || w.amount, detail: body.detail || w.detail, notes: body.notes !== undefined ? body.notes : w.notes, updatedAt: new Date() } });
    await createAuditLog(user.userId, w.cityId, "personal_withdrawals", id, "update", { amount: Number(w.amount) }, { amount: body.amount }, getClientIP(request));
    return successResponse({ id }, "Updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const w = await prisma.personalWithdrawal.findUnique({ where: { id } });
    if (!w) return errorResponse("NOT_FOUND", "Not found", 404);
    if (user.role === "city_admin" && w.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    await prisma.personalWithdrawal.delete({ where: { id } });
    await createAuditLog(user.userId, w.cityId, "personal_withdrawals", id, "delete", undefined, undefined, getClientIP(request));
    return successResponse({ id }, "Deleted");
  } catch (error) { return serverError(); }
});
