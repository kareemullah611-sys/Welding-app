import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { lockGodownProductStock } from "@/lib/financial-locks";

const GODOWN_TRANSFER_SYNC_MODULE = "godown_transfers";

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
  const syncMeta = getSyncRequestMeta(request);
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can transfer stock", 403);
    const body = await request.json();
    const { fromGodownId, toGodownId, productId, lotId, qty, transferDate, notes } = body;

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: user.cityId!,
            module: GODOWN_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingTransfer = await prisma.godownTransfer.findUnique({ where: { id: existingSync.entityId } });
        if (existingTransfer) return successResponse({ id: existingTransfer.id }, "Stock transfer already synced");
      }
    }

    if (!fromGodownId || !toGodownId || !productId || !qty || qty <= 0) return validationError("All fields required, qty must be positive");
    if (fromGodownId === toGodownId) return validationError("Cannot transfer to same godown");
    const product = await prisma.product.findUnique({
      where: { id: Number(productId) },
      select: { unitOfMeasure: true, piecesPerCarton: true, name: true },
    });
    if (!product) return errorResponse("NOT_FOUND", "Product not found", 404);
    if (product.unitOfMeasure === "PCS" && !product.piecesPerCarton) {
      return errorResponse("VALIDATION_ERROR", `${product.name}: PCS/CTN is required on product master`);
    }
    const baseQty = product.unitOfMeasure === "PCS" ? Number(qty) * Number(product.piecesPerCarton || 0) : Number(qty);

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

    const transfer = await prisma.$transaction(async (tx) => {
      await lockGodownProductStock(tx, [
        { godownId: Number(fromGodownId), productId: Number(productId) },
        { godownId: Number(toGodownId), productId: Number(productId) },
      ]);
      const stockRows: any[] = await tx.$queryRaw`
        SELECT
          COALESCE(SUM(lcga.qty), 0) as received,
          COALESCE((
            SELECT SUM(si.qty) FROM sale_items si
            JOIN sales s ON s.id = si.sale_id AND s.status IN ('active','marked_short')
            WHERE s.godown_id = ${fromGodownId} AND si.product_id = ${productId}
          ), 0) as sold,
          COALESCE((
            SELECT SUM(gt2.qty) FROM godown_transfers gt2
            WHERE gt2.from_godown_id = ${fromGodownId} AND gt2.product_id = ${productId}
          ), 0) as transferred_out,
          COALESCE((
            SELECT SUM(gt2.qty) FROM godown_transfers gt2
            WHERE gt2.to_godown_id = ${fromGodownId} AND gt2.product_id = ${productId}
          ), 0) as transferred_in,
          COALESCE((
            SELECT SUM(ct.qty) FROM city_transfers ct
            WHERE ct.from_godown_id = ${fromGodownId} AND ct.product_id = ${productId} AND ct.status IN ('approved','pending')
          ), 0) as city_out
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        WHERE lcga.godown_id = ${fromGodownId} AND lcd.product_id = ${productId}
      `;
      const stock = stockRows[0];
      const available = Number(stock?.received || 0) - Number(stock?.sold || 0)
        - Number(stock?.transferred_out || 0) + Number(stock?.transferred_in || 0)
        - Number(stock?.city_out || 0);
      if (baseQty > available) throw new Error(`STOCK_SHORT:${Math.max(0, available)}`);

      const created = await tx.godownTransfer.create({
        data: { fromGodownId, toGodownId, productId, lotId: effectiveLotId, qty: baseQty, transferDate: transferDate ? new Date(transferDate) : new Date(), notes, createdBy: user.userId },
        include: { fromGodown: true, toGodown: true, product: true },
      });

      await createAuditLog(user.userId, user.cityId!, "godown_transfers", created.id, "create", undefined, { fromGodownId, toGodownId, productId, qty: baseQty }, getClientIP(request), tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: user.cityId!,
            module: GODOWN_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "godown_transfers",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({
      id: transfer.id, fromGodown: transfer.fromGodown.name, toGodown: transfer.toGodown.name,
      product: transfer.product.name, qty: Number(transfer.qty),
    }, "Stock transferred", 201);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("STOCK_SHORT:")) {
      return errorResponse("VALIDATION_ERROR", `Insufficient stock: only ${error.message.slice("STOCK_SHORT:".length)} available in this godown`);
    }
    if (syncMeta && user.cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: user.cityId,
            module: GODOWN_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingTransfer = await prisma.godownTransfer.findUnique({ where: { id: existingSync.entityId } });
        if (existingTransfer) return successResponse({ id: existingTransfer.id }, "Stock transfer already synced");
      }
    }
    return serverError();
  }
});
