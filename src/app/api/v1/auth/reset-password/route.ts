import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, hashPassword } from "@/lib/auth";
import { z } from "zod";

// Enforce the same strong-password rule used everywhere else in the app
const resetPasswordSchema = z.object({
  userId: z.number().int().positive(),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

// PUT /api/v1/auth/reset-password
// Body: { userId, newPassword }
export const PUT = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid input", parsed.error.errors);

    const { userId, newPassword } = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return errorResponse("NOT_FOUND", "User not found", 404);

    const hash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        passwordPlain: target.role === "city_admin" ? newPassword : null,
        updatedAt: new Date(),
      },
    });

    await createAuditLog(user.userId, null, "users", userId, "update", { action: "password_reset" }, undefined, getClientIP(request));
    return successResponse({ userId }, "Password reset successfully");
  } catch (error) {
    return serverError();
  }
});
