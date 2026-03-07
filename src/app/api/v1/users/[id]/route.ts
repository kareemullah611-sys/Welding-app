import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, fullName: true, role: true, isActive: true, city: { select: { id: true, name: true } } } });
    if (!u) return errorResponse("NOT_FOUND", "User not found", 404);
    return successResponse(u);
  } catch (error) { return serverError(); }
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "User not found", 404);

    const data: any = { updatedAt: new Date() };
    if (body.fullName) data.fullName = body.fullName;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated = await prisma.user.update({ where: { id }, data });
    await createAuditLog(user.userId, null, "users", id, "update", { fullName: existing.fullName, isActive: existing.isActive }, { fullName: updated.fullName, isActive: updated.isActive }, getClientIP(request));
    return successResponse({ id: updated.id, fullName: updated.fullName, isActive: updated.isActive }, "User updated");
  } catch (error) { return serverError(); }
});
