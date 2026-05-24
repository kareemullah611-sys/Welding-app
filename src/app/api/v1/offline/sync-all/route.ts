import { NextRequest } from "next/server";
import { withAuth, ApiHandler } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { buildOfflineSyncPayload } from "@/lib/offline-sync-payload.server";

const syncAllHandler: ApiHandler = async (_request, _context, user) => {
  try {
    const data = await buildOfflineSyncPayload(prisma, {
      role: user.role as "super_admin" | "city_admin",
      cityId: user.cityId,
      countryId: user.countryId,
    });
    return successResponse(data);
  } catch (error) {
    console.error("sync-all error:", error);
    return errorResponse("SYNC_FAILED", "Failed to sync data", 500);
  }
};

export const GET = withAuth(syncAllHandler);
