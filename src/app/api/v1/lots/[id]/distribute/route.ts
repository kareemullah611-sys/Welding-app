import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lots/:id/distribute
// Body: { distributions: [{ cityId, productId, allocatedQty }] }
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = parseInt(context.params.id);
    const body = await request.json();
    const { distributions } = body;

    if (!distributions || !Array.isArray(distributions) || distributions.length === 0) {
      return validationError("distributions array is required");
    }

    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      include: { lotProducts: true, country: { include: { cities: true } } },
    });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (lot.status === "completed") return errorResponse("VALIDATION_ERROR", "Cannot distribute a completed lot");

    // Validate each distribution entry has a positive qty
    for (const d of distributions) {
      if (!d.allocatedQty || Number(d.allocatedQty) <= 0) {
        return validationError(`allocatedQty must be greater than 0 (got ${d.allocatedQty} for city ${d.cityId}, product ${d.productId})`);
      }
    }

    // Validate cities belong to lot's country
    const countryCityIds = lot.country.cities.map((c) => c.id);
    for (const d of distributions) {
      if (!countryCityIds.includes(d.cityId)) {
        return errorResponse("VALIDATION_ERROR", `City ${d.cityId} does not belong to ${lot.country.name}`);
      }
    }

    // Validate total distributed per product doesn't exceed lot product qty
    for (const lp of lot.lotProducts) {
      const totalDistributed = distributions
        .filter((d: any) => d.productId === lp.productId)
        .reduce((sum: number, d: any) => sum + (d.allocatedQty || 0), 0);
      if (totalDistributed > Number(lp.totalQty)) {
        return errorResponse("VALIDATION_ERROR", `Distribution for product ${lp.productId} exceeds lot quantity (${totalDistributed} > ${lp.totalQty})`);
      }
    }

    // Upsert distributions (no transaction - avoids Neon timeout)
    for (const d of distributions) {
      await prisma.lotCityDistribution.upsert({
        where: { lotId_cityId_productId: { lotId, cityId: d.cityId, productId: d.productId } },
        create: { lotId, cityId: d.cityId, productId: d.productId, allocatedQty: d.allocatedQty },
        update: { allocatedQty: d.allocatedQty, updatedAt: new Date() },
      });
    }

    await createAuditLog(user.userId, null, "lots", lotId, "update", undefined, { action: "distribute", distributions }, getClientIP(request));

    return successResponse({ lotId, distributed: distributions.length }, "Lot distributed to cities");
  } catch (error) {
    console.error("Distribute error:", error);
    return serverError();
  }
});
