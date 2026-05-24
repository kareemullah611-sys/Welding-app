import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { getTokenFromRequest, comparePassword, hashPassword, verifyToken } from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validations";
import { successResponse, unauthorizedResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { isCsrfSafe } from "@/lib/middleware";
import { isSessionActive } from "@/lib/session";

export async function PUT(request: NextRequest) {
  try {
    if (!isCsrfSafe(request)) {
      return new Response(
        JSON.stringify({ success: false, error: "CSRF_ERROR", message: "Cross-site request blocked" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const token = getTokenFromRequest(request);
    if (!token) return unauthorizedResponse();
    const payload = verifyToken(token);
    if (!payload) return unauthorizedResponse();
    if (!(await isSessionActive(token))) {
      return unauthorizedResponse("Session expired or revoked");
    }

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
      data: {
        passwordHash: newHash,
        ...(user.role === "city_admin" ? { passwordPlain: parsed.data.newPassword } : {}),
      },
    });

    return successResponse({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return serverError();
  }
}
