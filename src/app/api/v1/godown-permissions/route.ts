import { NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  getAllGodownPermissions,
  getAllSpecificGodownPermissions,
  grantGodownAccess,
  revokeGodownAccess,
  grantSpecificGodownAccess,
  revokeSpecificGodownAccess,
} from "@/lib/godown-access";
import prisma from "@/lib/prisma";
import { godownPermissionSchema } from "@/lib/validations";

// GET /api/v1/godown-permissions — list all permissions with city names
export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const [permissions, specificPermissions, cities, godowns] = await Promise.all([
      getAllGodownPermissions(),
      getAllSpecificGodownPermissions(),
      prisma.city.findMany({ select: { id: true, name: true, country: { select: { name: true } } }, orderBy: [{ country: { name: "asc" } }, { name: "asc" }] }),
      prisma.godown.findMany({
        where: { isActive: true },
        select: { id: true, name: true, cityId: true, city: { select: { name: true, country: { select: { name: true } } } } },
        orderBy: [{ city: { country: { name: "asc" } } }, { city: { name: "asc" } }, { name: "asc" }],
      }),
    ]);
    return successResponse({
      permissions,
      specificPermissions,
      cities: cities.map((c) => ({ id: c.id, name: c.name, country: c.country.name })),
      godowns: godowns.map((g) => ({
        id: g.id,
        name: g.name,
        cityId: g.cityId,
        cityName: g.city.name,
        country: g.city.country.name,
      })),
    });
  } catch { return serverError(); }
});

// POST /api/v1/godown-permissions — grant access { fromCityId, toCityId } OR { fromCityId, toGodownId }
export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const parsed = godownPermissionSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid godown permission", 400, parsed.error.errors);
    const { fromCityId, toCityId, toGodownId } = parsed.data;
    if (toGodownId) {
      const godown = await prisma.godown.findUnique({ where: { id: toGodownId }, select: { id: true, cityId: true } });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found");
      if (fromCityId === godown.cityId) return errorResponse("VALIDATION_ERROR", "Own city godown access is implicit");
      await grantSpecificGodownAccess(fromCityId, toGodownId);
      return successResponse({}, "Specific godown permission granted");
    }
    await grantGodownAccess(fromCityId, toCityId!);
    return successResponse({}, "Permission granted");
  } catch { return serverError(); }
});

// DELETE /api/v1/godown-permissions — revoke access { fromCityId, toCityId } OR { fromCityId, toGodownId }
export const DELETE = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const { fromCityId, toCityId, toGodownId } = await request.json();
    if (!fromCityId) return errorResponse("VALIDATION_ERROR", "Invalid city ID");
    if (toGodownId) {
      await revokeSpecificGodownAccess(Number(fromCityId), Number(toGodownId));
      return successResponse({}, "Specific godown permission revoked");
    }
    if (!toCityId) return errorResponse("VALIDATION_ERROR", "Invalid city IDs");
    await revokeGodownAccess(Number(fromCityId), Number(toCityId));
    return successResponse({}, "Permission revoked");
  } catch { return serverError(); }
});
