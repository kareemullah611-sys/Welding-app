import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import {
  comparePassword,
  generateToken,
  getJwtExpiryMs,
  getJwtExpirySeconds,
  getTokenFromRequest,
  hashPassword,
  shouldUseSecureAuthCookie,
  verifyToken,
} from "@/lib/auth";
import { changePasswordSchema } from "@/lib/validations";
import { successResponse, unauthorizedResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDatabaseUserForToken, isCsrfSafe } from "@/lib/middleware";
import { isSessionActive, hashToken } from "@/lib/session";

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
    const currentClaims = await getDatabaseUserForToken(payload);
    if (!currentClaims) return unauthorizedResponse("Invalid or expired token");

    // Rate limit: 5 password-change attempts per user per 15 minutes
    const limited = await checkRateLimit(`chpwd:${currentClaims.userId}`, 5, 15 * 60 * 1000);
    if (limited) return limited;

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid input", parsed.error.errors);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { city: { select: { countryId: true } } },
    });
    if (!user) return unauthorizedResponse("User not found");

    const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Current password is incorrect", 400);

    const newHash = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: payload.userId },
      data: { passwordHash: newHash },
    });

    await prisma.userSession.updateMany({
      where: {
        userId: payload.userId,
        isActive: true,
      },
      data: { isActive: false },
    });

    const newToken = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      cityId: user.cityId,
      countryId: user.city?.countryId ?? null,
    });

    await prisma.userSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(newToken),
        expiresAt: new Date(Date.now() + getJwtExpiryMs()),
      },
    });

    const response = successResponse({ message: "Password changed successfully" });
    response.cookies.set("token", newToken, {
      httpOnly: true,
      secure: shouldUseSecureAuthCookie(request),
      sameSite: "lax",
      maxAge: getJwtExpirySeconds(),
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Change password error:", error);
    return serverError();
  }
}
