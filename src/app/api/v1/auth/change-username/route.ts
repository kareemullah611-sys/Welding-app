import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import {
  comparePassword,
  generateToken,
  getJwtExpiryMs,
  getJwtExpirySeconds,
  getTokenFromRequest,
  shouldUseSecureAuthCookie,
  verifyToken,
} from "@/lib/auth";
import { changeUsernameSchema } from "@/lib/validations";
import { successResponse, unauthorizedResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDatabaseUserForToken } from "@/lib/middleware";
import { isSessionActive, hashToken } from "@/lib/session";

export async function PUT(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return unauthorizedResponse();
    const payload = verifyToken(token);
    if (!payload) return unauthorizedResponse();
    if (!(await isSessionActive(token))) {
      return unauthorizedResponse("Session expired or revoked");
    }
    const currentClaims = await getDatabaseUserForToken(payload);
    if (!currentClaims) return unauthorizedResponse("Invalid or expired token");

    const limited = await checkRateLimit(`chusr:${currentClaims.userId}`, 5, 15 * 60 * 1000);
    if (limited) return limited;

    const body = await request.json();
    const parsed = changeUsernameSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid input", parsed.error.errors);

    const { currentPassword, newUsername } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: currentClaims.userId },
      include: { city: { select: { countryId: true } } },
    });
    if (!user) return unauthorizedResponse("User not found");

    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Current password is incorrect", 400);

    if (newUsername.toLowerCase() !== user.username.toLowerCase()) {
      const existing = await prisma.user.findUnique({ where: { username: newUsername } });
      if (existing) return errorResponse("DUPLICATE", "Username already exists", 409);
    }

    await prisma.user.update({
      where: { id: currentClaims.userId },
      data: { username: newUsername },
    });

    // Rotate sessions: existing tokens carry the old username and would fail the
    // getDatabaseUserForToken username check, so revoke and re-issue a new one.
    await prisma.userSession.updateMany({
      where: { userId: currentClaims.userId, isActive: true },
      data: { isActive: false },
    });

    const newToken = generateToken({
      userId: user.id,
      username: newUsername,
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

    const response = successResponse({ message: "Username changed successfully", username: newUsername });
    response.cookies.set("token", newToken, {
      httpOnly: true,
      secure: shouldUseSecureAuthCookie(request),
      sameSite: "lax",
      maxAge: getJwtExpirySeconds(),
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Change username error:", error);
    return serverError();
  }
}
