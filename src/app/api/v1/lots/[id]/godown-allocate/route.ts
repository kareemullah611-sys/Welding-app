import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { autoActivateShortSales } from "@/lib/stock-activation";

// POST /api/v1/lots/:id/godown-allocation
// Body: { cityId, productId, allocations: [{ godownId, qty }] }
export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = parseInt(context.params.id);
    const body = await request.json();
    const { cityId, productId, allocations } = body;

    const effectiveCityId = user.role === "city_admin" ? user.cityId! : cityId;
    if (!effectiveCityId || !productId || !allocations?.length) {
      return validationError("cityId, productId, and allocations are required");
    }

    // Find the distribution record
    const dist = await prisma.lotCityDistribution.findUnique({
      where: { lotId_cityId_productId: { lotId, cityId: effectiveCityId, productId } },
    });
    if (!dist) return errorResponse("NOT_FOUND", "No distribution found for this lot/city/product combination");

    // Validate godowns belong to this city
    const godownIds = allocations.map((a: any) => a.godownId);
    const godowns = await prisma.godown.findMany({ where: { id: { in: godownIds }, cityId: effectiveCityId } });
    if (godowns.length !== godownIds.length) {
      return errorResponse("VALIDATION_ERROR", "One or more godowns don't belong to this city");
    }

    const incomingByGodown = new Map<number, number>();
    for (const allocation of allocations) {
      incomingByGodown.set(Number(allocation.godownId), Number(allocation.qty || 0));
    }
    const existingRows = await prisma.lotCityGodownAllocation.findMany({
      where: { lotCityDistributionId: dist.id },
      select: { godownId: true, qty: true },
    });
    const existingGodownIds = new Set(existingRows.map((row) => row.godownId));
    const nextTotal =
      existingRows.reduce((sum, row) => sum + (incomingByGodown.has(row.godownId) ? Number(incomingByGodown.get(row.godownId)) : Number(row.qty)), 0) +
      [...incomingByGodown.entries()].filter(([godownId]) => !existingGodownIds.has(godownId)).reduce((sum, [, qty]) => sum + qty, 0);
    if (nextTotal > Number(dist.allocatedQty)) {
      return errorResponse("VALIDATION_ERROR", `Total godown allocation (${nextTotal}) exceeds city distribution (${dist.allocatedQty})`);
    }

    // Upsert godown allocations one by one (no transaction - avoids Neon timeout)
    for (const a of allocations) {
      if (a.qty <= 0) continue;
      await prisma.lotCityGodownAllocation.upsert({
        where: { lotCityDistributionId_godownId: { lotCityDistributionId: dist.id, godownId: a.godownId } },
        create: { lotCityDistributionId: dist.id, godownId: a.godownId, productId, qty: a.qty },
        update: { qty: a.qty },
      });
    }

    await createAuditLog(user.userId, effectiveCityId, "lot_city_godown_allocations", lotId, "create", undefined, { allocations }, getClientIP(request));

    // Auto-activate any marked_short sales now covered by the new stock
    const affectedGodownIds = [...new Set(allocations.map((a: any) => a.godownId))] as number[];
    let totalActivated = 0;
    for (const gId of affectedGodownIds) {
      totalActivated += await autoActivateShortSales(gId);
    }

    return successResponse(
      { lotId, cityId: effectiveCityId, productId, allocations: allocations.length, salesActivated: totalActivated },
      totalActivated > 0
        ? `Godown allocations saved — ${totalActivated} short sale(s) auto-activated`
        : "Godown allocations saved"
    );
  } catch (error) {
    console.error("Godown allocation error:", error);
    return serverError();
  }
});
