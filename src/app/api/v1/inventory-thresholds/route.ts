import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const cityId = getCityScope(user, undefined);
    const where: any = {};
    if (cityId) where.cityId = cityId;

    const thresholds = await prisma.inventoryThreshold.findMany({
      where, include: { product: true, city: true },
    });
    return successResponse(thresholds.map((t) => ({
      id: t.id, cityId: t.cityId, cityName: t.city.name,
      productId: t.productId, productName: t.product.name,
      minQty: Number(t.minQty),
    })));
  } catch (error) { return serverError(); }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const cityId = user.role === "city_admin" ? user.cityId! : body.cityId;
    const { productId, minQty } = body;
    if (!cityId || !productId || minQty === undefined) return validationError("cityId, productId, minQty required");

    const threshold = await prisma.inventoryThreshold.upsert({
      where: { cityId_productId: { cityId, productId } },
      create: { cityId, productId, minQty, createdBy: user.userId },
      update: { minQty, updatedAt: new Date() },
    });
    await createAuditLog(user.userId, cityId, "inventory_thresholds", threshold.id, "create", undefined, { productId, minQty }, getClientIP(request));
    return successResponse({ id: threshold.id }, "Threshold saved");
  } catch (error) { return serverError(); }
});
