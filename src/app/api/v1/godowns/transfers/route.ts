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
    const reversedTransferIds = new Set((await prisma.auditLog.findMany({
      where: { entityType: "godown_transfers", entityId: { in: transfers.map((transfer) => transfer.id) }, action: "cancel" },
      select: { entityId: true },
    })).map((row) => row.entityId));

    return paginatedResponse(transfers.map((t) => ({
      id: t.id, transferDate: t.transferDate.toISOString().split("T")[0],
      fromGodown: t.fromGodown.name, toGodown: t.toGodown.name, city: t.fromGodown.city.name,
      product: t.product.name, lotNumber: t.lot?.lotNumber || "Opening Stock", qty: Number(t.qty),
      notes: t.notes, createdBy: t.creator.fullName, isReversed: reversedTransferIds.has(t.id),
    })), total, page, limit);
  } catch (error) { return serverError(); }
});

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can transfer stock", 403);
    const body = await request.json();
    const { fromGodownId, toGodownId, productId, lotId, openingInventoryValuationId, qty, transferDate, notes } = body;

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

    const transfers = await prisma.$transaction(async (tx) => {
      await lockGodownProductStock(tx, [
        { godownId: Number(fromGodownId), productId: Number(productId) },
        { godownId: Number(toGodownId), productId: Number(productId) },
      ]);
      const requestedLotId = lotId ? Number(lotId) : null;
      const requestedOpeningId = openingInventoryValuationId ? Number(openingInventoryValuationId) : null;
      if (requestedLotId && requestedOpeningId) throw new Error("SOURCE_INVALID");
      const stockRows: any[] = await tx.$queryRaw`
        WITH opening_sources AS (
          SELECT DISTINCT source.opening_inventory_valuation_id
          FROM (
            SELECT oiv.id AS opening_inventory_valuation_id
            FROM opening_stocks os
            JOIN opening_inventory_valuations oiv ON oiv.city_id = os.city_id AND oiv.product_id = os.product_id
            WHERE os.godown_id = ${fromGodownId} AND os.product_id = ${productId}
            UNION ALL
            SELECT gt.opening_inventory_valuation_id
            FROM godown_transfers gt
            WHERE gt.to_godown_id = ${fromGodownId} AND gt.product_id = ${productId} AND gt.opening_inventory_valuation_id IS NOT NULL
            UNION ALL
            SELECT ct_in.opening_inventory_valuation_id
            FROM city_transfers ct_in
            WHERE ct_in.to_godown_id = ${fromGodownId} AND ct_in.product_id = ${productId}
              AND ct_in.status = 'approved' AND ct_in.opening_inventory_valuation_id IS NOT NULL
          ) source
        ),
        lot_sources AS (
          SELECT DISTINCT source.lot_id
          FROM (
            SELECT lcd.lot_id
            FROM lot_city_godown_allocations lcga
            JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
            WHERE lcga.godown_id = ${fromGodownId} AND lcd.product_id = ${productId}
            UNION ALL
            SELECT gt.lot_id FROM godown_transfers gt
            WHERE gt.to_godown_id = ${fromGodownId} AND gt.product_id = ${productId} AND gt.lot_id IS NOT NULL
            UNION ALL
            SELECT ct_in.lot_id FROM city_transfers ct_in
            WHERE ct_in.to_godown_id = ${fromGodownId} AND ct_in.product_id = ${productId}
              AND ct_in.status = 'approved' AND ct_in.lot_id IS NOT NULL
          ) source
        )
        SELECT * FROM (
          SELECT NULL::int AS lot_id, oiv.id AS opening_inventory_valuation_id, oiv.opening_date AS source_date,
            COALESCE((SELECT SUM(os.qty) FROM opening_stocks os WHERE os.godown_id = ${fromGodownId} AND os.product_id = ${productId} AND os.city_id = oiv.city_id), 0)
            + COALESCE((SELECT SUM(ct_in.qty) FROM city_transfers ct_in WHERE ct_in.to_godown_id = ${fromGodownId} AND ct_in.product_id = ${productId} AND ct_in.opening_inventory_valuation_id = oiv.id AND ct_in.status = 'approved'), 0)
            + COALESCE((SELECT SUM(gt_in.qty) FROM godown_transfers gt_in WHERE gt_in.to_godown_id = ${fromGodownId} AND gt_in.product_id = ${productId} AND gt_in.opening_inventory_valuation_id = oiv.id), 0)
            - COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.godown_id = ${fromGodownId} AND s.status IN ('active','marked_short') AND si.product_id = ${productId} AND si.opening_inventory_valuation_id = oiv.id), 0)
            - COALESCE((SELECT SUM(gt_out.qty) FROM godown_transfers gt_out WHERE gt_out.from_godown_id = ${fromGodownId} AND gt_out.product_id = ${productId} AND gt_out.opening_inventory_valuation_id = oiv.id), 0)
            - COALESCE((SELECT SUM(ct_out.qty) FROM city_transfers ct_out WHERE ct_out.from_godown_id = ${fromGodownId} AND ct_out.product_id = ${productId} AND ct_out.opening_inventory_valuation_id = oiv.id AND ct_out.status IN ('pending','approved')), 0) AS available
          FROM opening_sources src JOIN opening_inventory_valuations oiv ON oiv.id = src.opening_inventory_valuation_id
          WHERE (${requestedLotId}::int IS NULL) AND (${requestedOpeningId}::int IS NULL OR oiv.id = ${requestedOpeningId}::int)
          UNION ALL
          SELECT l.id AS lot_id, NULL::int AS opening_inventory_valuation_id, l.lot_date AS source_date,
            COALESCE((SELECT SUM(lcga.qty) FROM lot_city_godown_allocations lcga JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id WHERE lcga.godown_id = ${fromGodownId} AND lcd.product_id = ${productId} AND lcd.lot_id = l.id), 0)
            + COALESCE((SELECT SUM(ct_in.qty) FROM city_transfers ct_in WHERE ct_in.to_godown_id = ${fromGodownId} AND ct_in.product_id = ${productId} AND ct_in.lot_id = l.id AND ct_in.status = 'approved'), 0)
            + COALESCE((SELECT SUM(gt_in.qty) FROM godown_transfers gt_in WHERE gt_in.to_godown_id = ${fromGodownId} AND gt_in.product_id = ${productId} AND gt_in.lot_id = l.id), 0)
            - COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.godown_id = ${fromGodownId} AND s.status IN ('active','marked_short') AND si.product_id = ${productId} AND si.lot_id = l.id), 0)
            - COALESCE((SELECT SUM(gt_out.qty) FROM godown_transfers gt_out WHERE gt_out.from_godown_id = ${fromGodownId} AND gt_out.product_id = ${productId} AND gt_out.lot_id = l.id), 0)
            - COALESCE((SELECT SUM(ct_out.qty) FROM city_transfers ct_out WHERE ct_out.from_godown_id = ${fromGodownId} AND ct_out.product_id = ${productId} AND ct_out.lot_id = l.id AND ct_out.status IN ('pending','approved')), 0) AS available
          FROM lot_sources src JOIN lots l ON l.id = src.lot_id
          WHERE (${requestedOpeningId}::int IS NULL) AND (${requestedLotId}::int IS NULL OR l.id = ${requestedLotId}::int)
        ) sources
        WHERE available > 0
        ORDER BY source_date ASC, COALESCE(lot_id, 0) ASC
      `;
      const available = stockRows.reduce((sum, row) => sum + Number(row.available || 0), 0);
      if (baseQty > available) throw new Error(`STOCK_SHORT:${Math.max(0, available)}`);

      let remaining = baseQty;
      const created = [];
      for (const row of stockRows) {
        if (remaining <= 0) break;
        const allocatedQty = Math.min(remaining, Number(row.available || 0));
        if (allocatedQty <= 0) continue;
        const movement = await tx.godownTransfer.create({
          data: {
            fromGodownId, toGodownId, productId,
            lotId: row.lot_id == null ? null : Number(row.lot_id),
            openingInventoryValuationId: row.opening_inventory_valuation_id == null ? null : Number(row.opening_inventory_valuation_id),
            qty: allocatedQty, transferDate: transferDate ? new Date(transferDate) : new Date(), notes, createdBy: user.userId,
          },
          include: { fromGodown: true, toGodown: true, product: true },
        });
        created.push(movement);
        remaining = Math.round((remaining - allocatedQty) * 10000) / 10000;
        await createAuditLog(user.userId, user.cityId!, "godown_transfers", movement.id, "create", undefined, {
          fromGodownId, toGodownId, productId, lotId: movement.lotId,
          openingInventoryValuationId: movement.openingInventoryValuationId, qty: allocatedQty,
        }, getClientIP(request), tx);
      }
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: user.cityId!,
            module: GODOWN_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "godown_transfers",
            entityId: created[0].id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({
      id: transfers[0].id, transferIds: transfers.map((transfer) => transfer.id),
      fromGodown: transfers[0].fromGodown.name, toGodown: transfers[0].toGodown.name,
      product: transfers[0].product.name, qty: transfers.reduce((sum, transfer) => sum + Number(transfer.qty), 0),
    }, "Stock transferred", 201);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("STOCK_SHORT:")) {
      return errorResponse("VALIDATION_ERROR", `Insufficient stock: only ${error.message.slice("STOCK_SHORT:".length)} available in this godown`);
    }
    if (error instanceof Error && error.message === "SOURCE_INVALID") return validationError("Select either a lot or an opening inventory source, not both");
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
