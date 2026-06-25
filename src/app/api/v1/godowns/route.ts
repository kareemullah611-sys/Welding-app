import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createGodownSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getAllowedGodownCityIds, getAllowedGodownIds } from "@/lib/godown-access";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    // show_all=true: return own city godowns + any permitted cross-city godowns
    const showAll = searchParams.get("show_all") === "true";
    const isActive = searchParams.get("is_active");

    const where: any = {};

    if (showAll && user.role === "city_admin" && user.cityId) {
      // Own city + cities this admin has permission to access
      const [permittedCityIds, permittedGodownIds] = await Promise.all([
        getAllowedGodownCityIds(user.cityId),
        getAllowedGodownIds(user.cityId),
      ]);
      const allowedCityIds = [user.cityId, ...permittedCityIds];
      where.OR = [
        { cityId: { in: allowedCityIds } },
        ...(permittedGodownIds.length ? [{ id: { in: permittedGodownIds } }] : []),
      ];
    } else if (showAll && user.role === "super_admin" && user.countryId) {
      // Super admin sees all godowns in the country when show_all
      where.city = { countryId: user.countryId };
    } else {
      const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
      if (cityId) where.cityId = cityId;
    }
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const [godowns, total] = await Promise.all([
      prisma.godown.findMany({
        where,
        include: { city: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip, take: limit,
      }),
      prisma.godown.count({ where }),
    ]);

    return paginatedResponse(
      godowns.map((g) => ({ id: g.id, cityId: g.cityId, cityName: g.city.name, name: g.name, isActive: g.isActive })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createGodownSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid godown data", parsed.error.errors);

    const cityId = user.role === "city_admin" ? user.cityId! : parsed.data.cityId;
    const city = await prisma.city.findFirst({ where: { id: cityId, isActive: true } });
    if (!city) return errorResponse("NOT_FOUND", "City not found");

    const existing = await prisma.godown.findFirst({ where: { cityId, name: parsed.data.name } });
    if (existing) return errorResponse("DUPLICATE", "Godown with this name already exists in this city", 409);

    const godown = await prisma.godown.create({
      data: { cityId, name: parsed.data.name },
      include: { city: { select: { id: true, name: true } } },
    });

    await createAuditLog(user.userId, cityId, "godowns", godown.id, "create", undefined, { name: godown.name }, getClientIP(request));

    return successResponse(
      { id: godown.id, cityId: godown.cityId, cityName: godown.city.name, name: godown.name, isActive: godown.isActive },
      "Godown created", 201
    );
  } catch (error) {
    return serverError();
  }
});
