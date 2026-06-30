import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { hashPassword } from "@/lib/auth";
import { createUserSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const cityId = searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined;
    const role = searchParams.get("role") as "super_admin" | "city_admin" | undefined;
    const isActive = searchParams.get("is_active");

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (role) where.role = role;
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, username: true, fullName: true, role: true, isActive: true, createdAt: true,
          city: { select: { id: true, name: true, country: { select: { name: true } } } },
        },
        orderBy: { fullName: "asc" },
        skip, take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return paginatedResponse(
      users.map((u) => ({
        id: u.id, username: u.username, fullName: u.fullName, role: u.role, isActive: u.isActive,
        cityId: u.city?.id || null, cityName: u.city?.name || null,
        countryName: u.city?.country?.name || null,
        createdAt: u.createdAt.toISOString(),
      })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid user data", parsed.error.errors);

    const { username, password, fullName, role, cityId } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return errorResponse("DUPLICATE", "Username already exists", 409);

    if (cityId) {
      const city = await prisma.city.findFirst({ where: { id: cityId, isActive: true } });
      if (!city) return errorResponse("NOT_FOUND", "City not found");
    }

    const passwordHash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        username,
        passwordHash,
        fullName,
        role,
        cityId: cityId || null,
      },
      select: {
        id: true, username: true, fullName: true, role: true, isActive: true,
        city: { select: { id: true, name: true } },
      },
    });

    await createAuditLog(user.userId, cityId || null, "users", newUser.id, "create", undefined, { username, role, cityId }, getClientIP(request));

    return successResponse({
      id: newUser.id, username: newUser.username, fullName: newUser.fullName,
      role: newUser.role, cityId: newUser.city?.id || null, cityName: newUser.city?.name || null,
    }, "User created", 201);
  } catch (error) {
    return serverError();
  }
});
