import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { getIntermediaryBalances } from "@/lib/intermediary-balance";

const INTERMEDIARY_SYNC_MODULE = "intermediaries";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withSuperAdmin(async (request: NextRequest, _context: any, _user: JWTPayload) => {
  const intermediaries = await prisma.intermediary.findMany({
    where: {},
    orderBy: { name: "asc" },
  });
  if (request.nextUrl.searchParams.get("include_balances") !== "1") return successResponse(intermediaries);
  return successResponse(await Promise.all(intermediaries.map(async (intermediary) => ({
    ...intermediary,
    balances: await getIntermediaryBalances(intermediary.id),
  }))));
});

export const POST = withSuperAdmin(async (request: NextRequest, _context: any, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    if (!body.name?.trim()) return errorResponse("VALIDATION", "Name is required", 400);

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existing = await prisma.intermediary.findUnique({ where: { id: existingSync.entityId } });
        if (existing) return successResponse(existing, "Intermediary already synced");
      }
    }

    const intermediary = await prisma.$transaction(async (tx) => {
      const created = await tx.intermediary.create({
        data: { name: body.name.trim(), notes: body.notes || null },
      });
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "intermediaries",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });
    return successResponse(intermediary, "Intermediary created", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: INTERMEDIARY_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existing = await prisma.intermediary.findUnique({ where: { id: existingSync.entityId } });
        if (existing) return successResponse(existing, "Intermediary already synced");
      }
    }
    console.error("Create intermediary error:", error);
    return serverError();
  }
});
