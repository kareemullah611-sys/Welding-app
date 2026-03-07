import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, notFoundResponse, forbiddenResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// DELETE /api/v1/sessions/:id — revoke a specific session
export const DELETE = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { id } = context.params;

    const session = await prisma.userSession.findUnique({
      where: { id },
    });

    if (!session) {
      return notFoundResponse("Session not found");
    }

    // Users can only revoke their own sessions
    if (session.userId !== user.userId) {
      return forbiddenResponse("Cannot revoke another user's session");
    }

    await prisma.userSession.update({
      where: { id },
      data: { isActive: false },
    });

    return successResponse({ message: "Session revoked" });
  } catch (error) {
    console.error("Revoke session error:", error);
    return serverError();
  }
});
