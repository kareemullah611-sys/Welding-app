import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);

    const where: any = {};
    if (cityId) where.fromGodown = { cityId };

    const [transfers, total] = await Promise.all([
      prisma.godownTransfer.findMany({
        where, include: { fromGodown: { include: { city: true } }, toGodown: true, product: true, lot: { select: { lotNumber: true } }, creator: { select: { fullName: true } } },
        orderBy: { transferDate: "desc" }, skip, take: limit,
      }),
      prisma.godownTransfer.count({ where }),
    ]);

    return paginatedResponse(transfers.map((t) => ({
      id: t.id, transferDate: t.transferDate.toISOString().split("T")[0],
      fromGodown: t.fromGodown.name, toGodown: t.toGodown.name, city: t.fromGodown.city.name,
      product: t.product.name, lotNumber: t.lot.lotNumber, qty: Number(t.qty),
      notes: t.notes, createdBy: t.creator.fullName,
    })), total, page, limit);
  } catch (error) { return serverError(); }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can transfer stock", 403);
    const body = await request.json();
    const { fromGodownId, toGodownId, productId, lotId, qty, transferDate, notes } = body;

    if (!fromGodownId || !toGodownId || !productId || !qty || qty <= 0) return validationError("All fields required, qty must be positive");
    if (fromGodownId === toGodownId) return validationError("Cannot transfer to same godown");

    // Validate godowns belong to user's city
    const [fromGd, toGd] = await Promise.all([
      prisma.godown.findFirst({ where: { id: fromGodownId, cityId: user.cityId! } }),
      prisma.godown.findFirst({ where: { id: toGodownId, cityId: user.cityId! } }),
    ]);
    if (!fromGd || !toGd) return errorResponse("VALIDATION_ERROR", "Godowns must belong to your city");

    // Get FIFO lot if not specified
    let effectiveLotId = lotId;
    if (!effectiveLotId) {
      const fifoLot = await prisma.lot.findFirst({
        where: { status: "ongoing", countryId: user.countryId!, lotCityDistributions: { some: { cityId: user.cityId! } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      });
      if (!fifoLot) return errorResponse("VALIDATION_ERROR", "No ongoing lot found");
      effectiveLotId = fifoLot.id;
    }

    const transfer = await prisma.godownTransfer.create({
      data: { fromGodownId, toGodownId, productId, lotId: effectiveLotId, qty, transferDate: transferDate ? new Date(transferDate) : new Date(), notes, createdBy: user.userId },
      include: { fromGodown: true, toGodown: true, product: true },
    });

    await createAuditLog(user.userId, user.cityId!, "godown_transfers", transfer.id, "create", undefined, { fromGodownId, toGodownId, productId, qty }, getClientIP(request));

    return successResponse({
      id: transfer.id, fromGodown: transfer.fromGodown.name, toGodown: transfer.toGodown.name,
      product: transfer.product.name, qty: Number(transfer.qty),
    }, "Stock transferred", 201);
  } catch (error) { return serverError(); }
});
