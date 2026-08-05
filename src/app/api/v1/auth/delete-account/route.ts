import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { comparePassword, getTokenFromRequest, verifyToken } from "@/lib/auth";
import { deleteAccountSchema } from "@/lib/validations";
import { successResponse, unauthorizedResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";
import { getDatabaseUserForToken, createAuditLog, getClientIP } from "@/lib/middleware";
import { isSessionActive } from "@/lib/session";

export async function POST(request: NextRequest) {
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
    if (currentClaims.role !== "city_admin") {
      return errorResponse("FORBIDDEN", "Only city admin accounts can be self-deleted", 403);
    }

    const limited = await checkRateLimit(`delacct:${currentClaims.userId}`, 5, 15 * 60 * 1000);
    if (limited) return limited;

    const body = await request.json();
    const parsed = deleteAccountSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid input", parsed.error.errors);

    const user = await prisma.user.findUnique({ where: { id: currentClaims.userId } });
    if (!user) return unauthorizedResponse("User not found");

    // Step 1: verify the account password.
    const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Current password is incorrect", 400);

    // Step 2: require the admin to type their username as confirmation text.
    if (parsed.data.confirmation.trim().toLowerCase() !== user.username.trim().toLowerCase()) {
      return errorResponse("AUTH_FAILED", "Confirmation text does not match your username", 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: currentClaims.userId },
        data: { isActive: false },
      });
      await tx.userSession.updateMany({
        where: { userId: currentClaims.userId, isActive: true },
        data: { isActive: false },
      });
      await createAuditLog(
        currentClaims.userId,
        currentClaims.cityId ?? null,
        "users",
        currentClaims.userId,
        "delete",
        { action: "self_delete" },
        undefined,
        getClientIP(request),
        tx
      );
    });

    const response = successResponse({ message: "Your account has been deleted" });
    response.cookies.set("token", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Delete account error:", error);
    return serverError();
  }
}
