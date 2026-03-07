import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const cityId = user.role === "city_admin" ? user.cityId : undefined;
    const where: any = {};
    if (cityId) where.OR = [{ cityId }, { cityId: null }];

    const notifications = await prisma.notification.findMany({
      where, orderBy: { createdAt: "desc" }, take: 50,
    });
    return successResponse(notifications.map((n) => ({
      id: n.id, type: n.type, title: n.title, message: n.message, isRead: n.isRead, createdAt: n.createdAt.toISOString(),
    })));
  } catch (error) { return serverError(); }
});

export const PUT = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    // Mark all as read
    const cityId = user.role === "city_admin" ? user.cityId : undefined;
    const where: any = { isRead: false };
    if (cityId) where.OR = [{ cityId }, { cityId: null }];

    await prisma.notification.updateMany({ where, data: { isRead: true } });
    return successResponse(null, "All notifications marked as read");
  } catch (error) { return serverError(); }
});
