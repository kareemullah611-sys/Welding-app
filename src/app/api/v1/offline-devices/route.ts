import { NextRequest } from "next/server";

import { successResponse, serverError } from "@/lib/api-response";
import type { JWTPayload } from "@/lib/auth";
import { withAuth } from "@/lib/middleware";
import prisma from "@/lib/prisma";

export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  try {
    const devices = await prisma.offlineSyncDevice.findMany({
      where: { userId: user.userId },
      orderBy: { lastUsedAt: "desc" },
      select: {
        id: true,
        deviceId: true,
        platform: true,
        approvedAt: true,
        revokedAt: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return successResponse(devices);
  } catch (error) {
    console.error("List offline devices error:", error);
    return serverError();
  }
});
