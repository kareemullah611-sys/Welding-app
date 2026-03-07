import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getUserFromRequest, comparePassword, hashPassword } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validations";
import { successResponse, unauthorizedResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";

export async function PUT(request: NextRequest) {
  try {
    const payload = getUserFromRequest(request);
    if (!payload) return unauthorizedResponse();

    // Rate limit: 5 password-change attempts per user per 15 minutes
    const limited = checkRateLimit(`chpwd:${payload.userId}`, 5, 15 * 60 * 1000);
    if (limited) return limited;

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid input", parsed.error.errors);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return unauthorizedResponse("User not found");

    const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Current password is incorrect", 400);

    const newHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: payload.userId },
      data: { passwordHash: newHash },
    });

    return successResponse({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return serverError();
  }
}
