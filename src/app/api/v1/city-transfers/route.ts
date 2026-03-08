import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET - list transfers (sent + received)
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get("status");
    const direction = request.nextUrl.searchParams.get("direction");
    const where: any = {};
    if (user.role === "city_admin") {
      if (direction === "incoming") where.toCityId = user.cityId;
      else if (direction === "outgoing") where.fromCityId = user.cityId;
      else where.OR = [{ fromCityId: user.cityId }, { toCityId: user.cityId }];
    }
    if (status) where.status = status;

    const [transfers, total] = await Promise.all([
      prisma.cityTransfer.findMany({
        where, include: {
          fromCity: { select: { id: true, name: true } }, toCity: { select: { id: true, name: true } },
          fromGodown: { select: { id: true, name: true } }, toGodown: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } }, lot: { select: { id: true, lotNumber: true } },
          sender: { select: { id: true, fullName: true } }, approver: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" }, skip, take: limit,
      }),
      prisma.cityTransfer.count({ where }),
    ]);

    return paginatedResponse(transfers.map(t => ({
      id: t.id, fromCity: t.fromCity, toCity: t.toCity, fromGodown: t.fromGodown, toGodown: t.toGodown,
      product: t.product, lot: { id: t.lot.id, lotNumber: t.lot.lotNumber },
      qty: Number(t.qty), status: t.status, notes: t.notes, approvalNotes: t.approvalNotes,
      transferDate: t.transferDate.toISOString().split("T")[0],
      sentBy: t.sender, approvedBy: t.approver,
      approvedAt: t.approvedAt?.toISOString() || null,
    })), total, page, limit);
  } catch (error) { console.error("List city transfers:", error); return serverError(); }
});

// POST - send goods to another city
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can send", 403);
    const body = await request.json();
    const { toCityId, fromGodownId, productId, lotId, qty, notes, transferDate } = body;

    if (!toCityId || !fromGodownId || !productId || !qty) return validationError("Missing required fields");
    if (toCityId === user.cityId) return errorResponse("VALIDATION_ERROR", "Cannot transfer to same city");

    // Verify godown belongs to sender
    const godown = await prisma.godown.findFirst({ where: { id: fromGodownId, cityId: user.cityId!, isActive: true } });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found in your city");

    // Get FIFO lot if not specified
    let effectiveLotId = lotId;
    if (!effectiveLotId) {
      const lot = await prisma.lot.findFirst({
        where: { status: "ongoing", lotCityDistributions: { some: { cityId: user.cityId! } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      });
      effectiveLotId = lot?.id;
    }
    if (!effectiveLotId) return errorResponse("VALIDATION_ERROR", "No ongoing lot available");

    const transfer = await prisma.cityTransfer.create({
      data: {
        fromCityId: user.cityId!, toCityId, fromGodownId, productId,
        lotId: effectiveLotId, qty, notes,
        transferDate: transferDate ? new Date(transferDate) : new Date(),
        sentBy: user.userId,
      },
    });

    await createAuditLog(user.userId, user.cityId, "city_transfers", transfer.id, "create", undefined, body, getClientIP(request));
    return successResponse({ id: transfer.id }, "Transfer sent — waiting for approval", 201);
  } catch (error) { console.error("Create city transfer:", error); return serverError(); }
});
