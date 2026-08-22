import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, getPaginationParams, paginatedResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

function formatConsignee(row: any) {
  return {
    id: row.id,
    name: row.name,
    countryId: row.countryId,
    countryName: row.country?.name || null,
    cityId: row.cityId,
    cityName: row.city?.name || null,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: row.isActive,
    lotsCount: row._count?.lots || 0,
  };
}

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    const query = (request.nextUrl.searchParams.get("q") || "").trim();
    const where: any = includeArchived ? {} : { isActive: true };
    if (query.length >= 2) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { city: { name: { contains: query, mode: "insensitive" } } },
        { country: { name: { contains: query, mode: "insensitive" } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.consignee.findMany({
        where,
        include: { country: true, city: true, _count: { select: { lots: true } } },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        skip,
        take: limit,
      }),
      prisma.consignee.count({ where }),
    ]);

    return paginatedResponse(rows.map(formatConsignee), total, page, limit);
  } catch (error) {
    console.error("List consignees error:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) return validationError("Name is required");

    const countryId = body.countryId ? Number(body.countryId) : null;
    const cityId = body.cityId ? Number(body.cityId) : null;
    if (cityId) {
      const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, countryId: true } });
      if (!city) return errorResponse("NOT_FOUND", "City not found", 404);
      if (countryId && city.countryId !== countryId) return validationError("City does not belong to selected country");
    }

    const existing = await prisma.consignee.findUnique({ where: { name } });
    if (existing) return errorResponse("DUPLICATE", "Consignee already exists", 409);

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.consignee.create({
        data: {
          name,
          countryId,
          cityId,
          phone: body.phone ? String(body.phone).trim() : null,
          address: body.address ? String(body.address).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
          createdBy: user.userId,
        },
        include: { country: true, city: true, _count: { select: { lots: true } } },
      });
      await createAuditLog(user.userId, null, "consignees", created.id, "create", undefined, { name }, getClientIP(request), tx);
      return created;
    });

    return successResponse(formatConsignee(row), "Consignee created", 201);
  } catch (error) {
    console.error("Create consignee error:", error);
    return serverError();
  }
});
