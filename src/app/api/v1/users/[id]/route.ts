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

    if (body.isActive === false && existing.id === user.userId) {
      return errorResponse("VALIDATION_ERROR", "You cannot deactivate your own account");
    }

    if (body.isActive === false && existing.role === "super_admin") {
      const activeSuperAdmins = await prisma.user.count({
        where: { role: "super_admin", isActive: true },
      });
      if (activeSuperAdmins <= 1) {
        return errorResponse("VALIDATION_ERROR", "At least one active super admin is required");
      }
    }

    const data: any = { updatedAt: new Date() };
    if (body.fullName) data.fullName = body.fullName;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    if (body.username !== undefined) {
      const username = String(body.username).trim();
      if (username.length < 3 || username.length > 100) {
        return errorResponse("VALIDATION_ERROR", "Username must be between 3 and 100 characters");
      }
      const existingUsername = await prisma.user.findUnique({ where: { username } });
      if (existingUsername && existingUsername.id !== id) {
        return errorResponse("DUPLICATE", "Username already exists", 409);
      }
      data.username = username;
    }

    const updated = await prisma.user.update({ where: { id }, data });
    await createAuditLog(user.userId, null, "users", id, "update", { fullName: existing.fullName, username: existing.username, isActive: existing.isActive }, { fullName: updated.fullName, username: updated.username, isActive: updated.isActive }, getClientIP(request));
    return successResponse({ id: updated.id, fullName: updated.fullName, username: updated.username, isActive: updated.isActive }, "User updated");
  } catch (error) { return serverError(); }
});
