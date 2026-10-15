import { NextRequest } from "next/server";

import { notFoundResponse, successResponse, serverError } from "@/lib/api-response";
import type { JWTPayload } from "@/lib/auth";
import { withAuth } from "@/lib/middleware";
import prisma from "@/lib/prisma";

export const POST = withAuth(async (_request: NextRequest, context, user: JWTPayload) => {
  try {
    const result = await prisma.offlineSyncDevice.updateMany({
      where: {
        id: context.params.id,
        userId: user.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      const existing = await prisma.offlineSyncDevice.findFirst({
        where: { id: context.params.id, userId: user.userId },
        select: { id: true },
      });
      if (!existing) return notFoundResponse("Offline device not found");
    }
    return successResponse({ revoked: true });
  } catch (error) {
    console.error("Revoke offline device error:", error);
    return serverError();
  }
});
