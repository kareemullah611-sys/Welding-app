import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload, getTokenFromRequest } from "@/lib/auth";
import { hashToken } from "@/lib/session";

// GET /api/v1/sessions — list all active sessions for the current user
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const currentToken = getTokenFromRequest(request);
    const currentTokenHash = currentToken ? hashToken(currentToken) : null;

    const sessions = await prisma.userSession.findMany({
      where: {
        userId: user.userId,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastActiveAt: "desc" },
    });

    const mapped = sessions.map((s: any) => ({
      id: s.id,
      deviceInfo: s.deviceInfo,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.tokenHash === currentTokenHash,
    }));

    return successResponse(mapped);
  } catch (error) {
    console.error("List sessions error:", error);
    return serverError();
  }
});
