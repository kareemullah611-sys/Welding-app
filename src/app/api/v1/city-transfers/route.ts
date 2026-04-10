import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { canAccessGodownCity } from "@/lib/godown-access";

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
    const parsedToCityId = Number(toCityId);
    const parsedFromGodownId = Number(fromGodownId);
    const parsedProductId = Number(productId);
    const parsedLotId = lotId ? Number(lotId) : null;
    const parsedQty = Number(qty);

    if (!parsedToCityId || !parsedFromGodownId || !parsedProductId || !parsedQty) return validationError("Missing required fields");
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) return validationError("Quantity must be greater than 0");
    if (parsedToCityId === user.cityId) return errorResponse("VALIDATION_ERROR", "Cannot transfer to same city");

    const destinationCity = await prisma.city.findUnique({
      where: { id: parsedToCityId },
      select: { id: true, isActive: true },
    });
    if (!destinationCity || !destinationCity.isActive) {
      return errorResponse("NOT_FOUND", "Destination city not found", 404);
    }
    const permitted = await canAccessGodownCity(user.cityId!, parsedToCityId);
    if (!permitted) {
      return errorResponse("FORBIDDEN", "Your city is not permitted to transfer stock to that city", 403);
    }

    // Verify godown belongs to sender
    const godown = await prisma.godown.findFirst({ where: { id: parsedFromGodownId, cityId: user.cityId!, isActive: true } });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found in your city");

    // Get FIFO lot if not specified
    let effectiveLotId: number | null = parsedLotId;
    if (!effectiveLotId) {
      const lot = await prisma.lot.findFirst({
        where: { status: "ongoing", lotCityDistributions: { some: { cityId: user.cityId! } } },
        orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      });
      effectiveLotId = lot?.id ?? null;
    }
    if (!effectiveLotId) return errorResponse("VALIDATION_ERROR", "No ongoing lot available");

    const transfer = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${31001}, ${parsedFromGodownId * 100000 + parsedProductId})`;

      const stockRows: any[] = await tx.$queryRaw`
        SELECT
          COALESCE(SUM(lcga.qty), 0) as received,
          COALESCE((
            SELECT SUM(si.qty) FROM sale_items si
            JOIN sales s ON s.id = si.sale_id AND s.status IN ('active','marked_short')
            WHERE s.godown_id = ${parsedFromGodownId} AND si.product_id = ${parsedProductId}
          ), 0) as sold,
          COALESCE((
            SELECT SUM(ct.qty) FROM city_transfers ct
            WHERE ct.from_godown_id = ${parsedFromGodownId} AND ct.product_id = ${parsedProductId} AND ct.status = 'approved'
          ), 0) as city_out,
          COALESCE((
            SELECT SUM(ct.qty) FROM city_transfers ct
            WHERE ct.from_godown_id = ${parsedFromGodownId} AND ct.product_id = ${parsedProductId} AND ct.status = 'pending'
          ), 0) as city_pending
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        WHERE lcga.godown_id = ${parsedFromGodownId} AND lcd.product_id = ${parsedProductId}
      `;
      const row = stockRows[0];
      const available = Math.max(
        0,
        Number(row?.received || 0) - Number(row?.sold || 0) - Number(row?.city_out || 0) - Number(row?.city_pending || 0)
      );
      if (parsedQty > available) {
        throw new Error(`INSUFFICIENT_STOCK:${available}`);
      }

      const createdTransfer = await tx.cityTransfer.create({
        data: {
          fromCityId: user.cityId!,
          toCityId: parsedToCityId,
          fromGodownId: parsedFromGodownId,
          productId: parsedProductId,
          lotId: effectiveLotId,
          qty: parsedQty,
          notes,
          transferDate: transferDate ? new Date(transferDate) : new Date(),
          sentBy: user.userId,
        },
      });

      await createAuditLog(user.userId, user.cityId, "city_transfers", createdTransfer.id, "create", undefined, body, getClientIP(request), tx);
      return createdTransfer;
    });

    return successResponse({ id: transfer.id }, "Transfer sent — waiting for approval", 201);
  } catch (error: any) {
    console.error("Create city transfer:", error);
    if (typeof error?.message === "string" && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      const available = Number(error.message.split(":")[1] || 0);
      return errorResponse("VALIDATION_ERROR", `Insufficient stock: only ${available} available (including pending transfers) in this godown`);
    }
    return serverError();
  }
});
