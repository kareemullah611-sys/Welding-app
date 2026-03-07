import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload, getTokenFromRequest } from "@/lib/auth";
import crypto from "crypto";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// POST /api/v1/sessions/revoke-others — revoke all sessions except current
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const currentToken = getTokenFromRequest(request);
    const currentTokenHash = currentToken ? hashToken(currentToken) : null;

    const result = await prisma.userSession.updateMany({
      where: {
        userId: user.userId,
        isActive: true,
        tokenHash: { not: currentTokenHash || "" },
      },
      data: { isActive: false },
    });

    return successResponse({ revoked: result.count, message: `${result.count} session(s) revoked` });
  } catch (error) {
    console.error("Revoke others error:", error);
    return serverError();
  }
});
