import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { paginatedResponse, serverError, getPaginationParams, getDateRange } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const userId = searchParams.get("user_id") ? parseInt(searchParams.get("user_id")!) : undefined;
    const entityType = searchParams.get("entity_type");
    const entityId = searchParams.get("entity_id") ? parseInt(searchParams.get("entity_id")!) : undefined;
    const action = searchParams.get("action");

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true } },
          city: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip, take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginatedResponse(
      logs.map((l) => ({
        id: l.id,
        user: l.user,
        city: l.city,
        entityType: l.entityType,
        entityId: l.entityId,
        action: l.action,
        oldValues: l.oldValues,
        newValues: l.newValues,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt.toISOString(),
      })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});
