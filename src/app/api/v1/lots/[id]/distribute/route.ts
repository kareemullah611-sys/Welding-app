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
    if (lot.isLegacyStock) {
      return errorResponse("VALIDATION_ERROR", "Use Openings → Stock to manage the OLD-STOCK legacy lot");
    }
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

    const incomingKeys = new Set(distributions.map((d: any) => `${d.cityId}:${d.productId}`));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(32001, ${lotId}::int)`;
      const existingRows = await tx.lotCityDistribution.findMany({
        where: { lotId },
        include: { godownAllocations: { select: { qty: true } } },
      });

      for (const row of existingRows) {
        if (incomingKeys.has(`${row.cityId}:${row.productId}`)) continue;
        const [saleCount, transferCount] = await Promise.all([
          tx.saleItem.count({
            where: {
              lotId,
              productId: row.productId,
              sale: { cityId: row.cityId, status: { in: ["active", "marked_short"] } },
            },
          }),
          tx.cityTransfer.count({
            where: {
              lotId,
              productId: row.productId,
              status: { in: ["pending", "approved"] },
              OR: [{ fromCityId: row.cityId }, { toCityId: row.cityId }],
            },
          }),
        ]);
        if (saleCount > 0 || transferCount > 0) {
          throw new Error(`DISTRIBUTION_HAS_MOVEMENTS:${row.cityId}:${row.productId}`);
        }
        await tx.lotCityGodownAllocation.deleteMany({ where: { lotCityDistributionId: row.id } });
        await tx.lotCityDistribution.delete({ where: { id: row.id } });
      }

      for (const d of distributions) {
        const existing = existingRows.find((row) => row.cityId === d.cityId && row.productId === d.productId);
        const assignedQty = existing?.godownAllocations.reduce((sum, allocation) => sum + Number(allocation.qty), 0) || 0;
        if (assignedQty > Number(d.allocatedQty)) {
          throw new Error(`DISTRIBUTION_BELOW_GODOWN_ASSIGNMENTS:${d.cityId}:${d.productId}:${assignedQty}`);
        }
        await tx.lotCityDistribution.upsert({
          where: { lotId_cityId_productId: { lotId, cityId: d.cityId, productId: d.productId } },
          create: { lotId, cityId: d.cityId, productId: d.productId, allocatedQty: d.allocatedQty },
          update: { allocatedQty: d.allocatedQty, updatedAt: new Date() },
        });
      }

      await createAuditLog(user.userId, null, "lots", lotId, "update", undefined, { action: "distribute", distributions }, getClientIP(request), tx);
    });

    return successResponse({ lotId, distributed: distributions.length }, "Lot distributed to cities");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("DISTRIBUTION_HAS_MOVEMENTS:")) {
      return errorResponse("VALIDATION_ERROR", "Cannot remove a distribution after sales or city transfers exist. Reverse those movements first.", 400);
    }
    if (message.startsWith("DISTRIBUTION_BELOW_GODOWN_ASSIGNMENTS:")) {
      return errorResponse("VALIDATION_ERROR", "City distribution cannot be lower than its existing godown assignments. Adjust godown assignments first.", 400);
    }
    console.error("Distribute error:", error);
    return serverError();
  }
});
