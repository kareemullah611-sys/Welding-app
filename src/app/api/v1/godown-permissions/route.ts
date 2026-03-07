import { NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getAllGodownPermissions, grantGodownAccess, revokeGodownAccess } from "@/lib/godown-access";
import prisma from "@/lib/prisma";

// GET /api/v1/godown-permissions — list all permissions with city names
export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const [permissions, cities] = await Promise.all([
      getAllGodownPermissions(),
      prisma.city.findMany({ select: { id: true, name: true, country: { select: { name: true } } }, orderBy: [{ country: { name: "asc" } }, { name: "asc" }] }),
    ]);
    return successResponse({ permissions, cities: cities.map((c) => ({ id: c.id, name: c.name, country: c.country.name })) });
  } catch { return serverError(); }
});

// POST /api/v1/godown-permissions — grant access { fromCityId, toCityId }
export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const { fromCityId, toCityId } = await request.json();
    if (!fromCityId || !toCityId || fromCityId === toCityId) return errorResponse("VALIDATION_ERROR", "Invalid city IDs");
    await grantGodownAccess(Number(fromCityId), Number(toCityId));
    return successResponse({}, "Permission granted");
  } catch { return serverError(); }
});

// DELETE /api/v1/godown-permissions — revoke access { fromCityId, toCityId }
export const DELETE = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const { fromCityId, toCityId } = await request.json();
    if (!fromCityId || !toCityId) return errorResponse("VALIDATION_ERROR", "Invalid city IDs");
    await revokeGodownAccess(Number(fromCityId), Number(toCityId));
    return successResponse({}, "Permission revoked");
  } catch { return serverError(); }
});
