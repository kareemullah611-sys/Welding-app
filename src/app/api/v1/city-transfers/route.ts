import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { groupCityTransferRows, normalizeCityTransferRequest } from "@/lib/city-transfer-batch";
import { lockGodownProductStock } from "@/lib/financial-locks";
import { randomUUID } from "node:crypto";

const CITY_TRANSFER_SYNC_MODULE = "city_transfers";

// GET - list transfers (sent + received)
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const status = searchParams.get("status");
    const direction = searchParams.get("direction");
    const query = (searchParams.get("q") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);
    const statusQuery = ["pending", "approved", "rejected"].includes(normalizedQuery) ? normalizedQuery : null;
    const where: any = {};
    if (user.role === "city_admin") {
      if (direction === "incoming") where.toCityId = user.cityId;
      else if (direction === "outgoing") where.fromCityId = user.cityId;
      else where.OR = [{ fromCityId: user.cityId }, { toCityId: user.cityId }];
    }
    if (status) where.status = status;
    if (shouldApplySearch) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { notes: { contains: query, mode: "insensitive" } },
            { approvalNotes: { contains: query, mode: "insensitive" } },
            ...(statusQuery ? [{ status: statusQuery as any }] : []),
            { fromCity: { name: { contains: query, mode: "insensitive" } } },
            { toCity: { name: { contains: query, mode: "insensitive" } } },
            { fromGodown: { name: { contains: query, mode: "insensitive" } } },
            { toGodown: { name: { contains: query, mode: "insensitive" } } },
            { product: { name: { contains: query, mode: "insensitive" } } },
            { lot: { lotNumber: { contains: query, mode: "insensitive" } } },
            ...(hasNumericQuery ? [{ qty: numericQuery }, { id: Math.trunc(numericQuery) }] : []),
          ],
        },
      ];
    }

    const transfers = await prisma.cityTransfer.findMany({
        where, include: {
          fromCity: { select: { id: true, name: true } }, toCity: { select: { id: true, name: true } },
          fromGodown: { select: { id: true, name: true } }, toGodown: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } }, lot: { select: { id: true, lotNumber: true } },
          sender: { select: { id: true, fullName: true } }, approver: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
      });

    const grouped = groupCityTransferRows(transfers.map(t => ({
      id: t.id, batchId: t.batchId, fromCity: t.fromCity, toCity: t.toCity, fromGodown: t.fromGodown, toGodown: t.toGodown,
      product: t.product, lot: { id: t.lot.id, lotNumber: t.lot.lotNumber },
      qty: t.product.unitOfMeasure === "PCS" && Number(t.product.piecesPerCarton || 0) > 0
        ? Number(t.qty) / Number(t.product.piecesPerCarton)
        : Number(t.qty),
      status: t.status, notes: t.notes, approvalNotes: t.approvalNotes,
      transferDate: t.transferDate.toISOString().split("T")[0],
      sentBy: t.sender, approvedBy: t.approver,
      approvedAt: t.approvedAt?.toISOString() || null,
    })));
    const total = grouped.length;
    return paginatedResponse(grouped.slice(skip, skip + limit), total, page, limit);
  } catch (error) { console.error("List city transfers:", error); return serverError(); }
});

// POST - send goods to another city
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can send", 403);
    const body = await request.json();
    const requestData = normalizeCityTransferRequest(body);

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: user.cityId!,
            module: CITY_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingTransfer = await prisma.cityTransfer.findUnique({ where: { id: existingSync.entityId } });
        if (existingTransfer) return successResponse({ id: existingTransfer.id, batchId: existingTransfer.batchId }, "Transfer already synced");
      }
    }

    if (!requestData.toCityId || requestData.items.length === 0) return validationError("Destination city and transfer items are required");
    if (requestData.toCityId === user.cityId) return errorResponse("VALIDATION_ERROR", "Cannot transfer to same city");
    const productIds = requestData.items.map((item) => item.productId);
    if (productIds.some((id) => !id) || new Set(productIds).size !== productIds.length) {
      return validationError("Select each product once");
    }
    for (const item of requestData.items) {
      if (item.sources.length === 0) return validationError("Each product requires at least one source godown");
      const sourceGodownIds = item.sources.map((source) => source.fromGodownId);
      if (sourceGodownIds.some((id) => !id) || new Set(sourceGodownIds).size !== sourceGodownIds.length) {
        return validationError("A source godown can only be selected once per product");
      }
      if (item.sources.some((source) => !Number.isFinite(source.qty) || source.qty <= 0)) {
        return validationError("Every source quantity must be greater than 0");
      }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, unitOfMeasure: true, piecesPerCarton: true, name: true },
    });
    if (products.length !== productIds.length) return errorResponse("NOT_FOUND", "One or more products were not found", 404);
    const productById = new Map(products.map((product) => [product.id, product]));
    for (const product of products) {
      if (product.unitOfMeasure === "PCS" && !product.piecesPerCarton) {
        return errorResponse("VALIDATION_ERROR", `${product.name}: PCS/CTN is required on product master`);
      }
    }

    const destinationCity = await prisma.city.findUnique({
      where: { id: requestData.toCityId },
      select: { id: true, isActive: true },
    });
    if (!destinationCity || !destinationCity.isActive) {
      return errorResponse("NOT_FOUND", "Destination city not found", 404);
    }
    const sourceGodownIds = Array.from(new Set(requestData.items.flatMap((item) => item.sources.map((source) => source.fromGodownId))));
    const sourceGodowns = await prisma.godown.findMany({
      where: { id: { in: sourceGodownIds }, cityId: user.cityId!, isActive: true },
      select: { id: true },
    });
    if (sourceGodowns.length !== sourceGodownIds.length) return errorResponse("NOT_FOUND", "One or more source godowns were not found in your city", 404);

    const batchId = randomUUID();
    const createdTransfers = await prisma.$transaction(async (tx) => {
      await lockGodownProductStock(tx, requestData.items.flatMap((item) =>
        item.sources.map((source) => ({ godownId: source.fromGodownId, productId: item.productId }))
      ));
      const created: any[] = [];
      for (const item of requestData.items) {
        const product = productById.get(item.productId)!;
        const piecesPerCarton = Number(product.piecesPerCarton || 0);
        for (const source of item.sources) {
          const requestedBaseQty = product.unitOfMeasure === "PCS" ? source.qty * piecesPerCarton : source.qty;
          const requestedLotId = source.lotId || null;
          const stockRows: any[] = await tx.$queryRaw`
            SELECT
              lcd.id AS distribution_id,
              lcd.lot_id,
              lcga.id AS allocation_id,
              COALESCE(lcga.qty, 0)
                - COALESCE((
                    SELECT SUM(si.qty) FROM sale_items si
                    JOIN sales s ON s.id = si.sale_id AND s.status IN ('active','marked_short')
                    WHERE s.godown_id = ${source.fromGodownId} AND si.product_id = ${item.productId} AND si.lot_id = lcd.lot_id
                  ), 0)
                - COALESCE((
                    SELECT SUM(gt.qty) FROM godown_transfers gt
                    WHERE gt.from_godown_id = ${source.fromGodownId} AND gt.product_id = ${item.productId} AND gt.lot_id = lcd.lot_id
                  ), 0)
                + COALESCE((
                    SELECT SUM(gt.qty) FROM godown_transfers gt
                    WHERE gt.to_godown_id = ${source.fromGodownId} AND gt.product_id = ${item.productId} AND gt.lot_id = lcd.lot_id
                  ), 0) AS available
            FROM lot_city_godown_allocations lcga
            JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
            JOIN lots l ON l.id = lcd.lot_id
            WHERE lcga.godown_id = ${source.fromGodownId}
              AND lcd.city_id = ${user.cityId!}
              AND lcd.product_id = ${item.productId}
              AND l.status = 'ongoing'
              AND (${requestedLotId}::int IS NULL OR lcd.lot_id = ${requestedLotId}::int)
            ORDER BY l.lot_date ASC, l.id ASC
          `;
          const available = stockRows.reduce((sum, row) => sum + Math.max(0, Number(row.available || 0)), 0);
          if (available < requestedBaseQty) {
            const displayAvailable = product.unitOfMeasure === "PCS" && piecesPerCarton > 0 ? available / piecesPerCarton : available;
            throw new Error(`INSUFFICIENT_STOCK:${product.name}:${source.fromGodownId}:${displayAvailable}`);
          }

          let remaining = requestedBaseQty;
          for (const row of stockRows) {
            if (remaining <= 0) break;
            const allocation = { qty: Math.min(remaining, Math.max(0, Number(row.available || 0))) };
            if (allocation.qty <= 0) continue;
            await tx.lotCityGodownAllocation.update({
              where: { id: Number(row.allocation_id) },
              data: { qty: { decrement: allocation.qty } },
            });
            await tx.lotCityDistribution.update({
              where: { id: Number(row.distribution_id) },
              data: { allocatedQty: { decrement: allocation.qty } },
            });
            const transfer = await tx.cityTransfer.create({
              data: {
                batchId,
                fromCityId: user.cityId!,
                toCityId: requestData.toCityId,
                fromGodownId: source.fromGodownId,
                productId: item.productId,
                lotId: Number(row.lot_id),
                qty: allocation.qty,
                notes: requestData.notes,
                transferDate: requestData.transferDate ? new Date(requestData.transferDate) : new Date(),
                sentBy: user.userId,
              },
            });
            created.push(transfer);
            remaining = Math.round((remaining - allocation.qty) * 100) / 100;
            await createAuditLog(user.userId, user.cityId, "city_transfers", transfer.id, "create", undefined, {
              batchId, toCityId: requestData.toCityId, productId: item.productId,
              fromGodownId: source.fromGodownId, lotId: Number(row.lot_id), qty: allocation.qty,
            }, getClientIP(request), tx);
          }
        }
      }
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: user.cityId!,
            module: CITY_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "city_transfers",
            entityId: created[0].id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({ id: createdTransfers[0].id, batchId, transferIds: createdTransfers.map((transfer) => transfer.id) }, "Transfer sent — source stock deducted, waiting for approval", 201);
  } catch (error: any) {
    if (syncMeta && user.cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: user.cityId,
            module: CITY_TRANSFER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingTransfer = await prisma.cityTransfer.findUnique({ where: { id: existingSync.entityId } });
        if (existingTransfer) return successResponse({ id: existingTransfer.id, batchId: existingTransfer.batchId }, "Transfer already synced");
      }
    }
    console.error("Create city transfer:", error);
    if (typeof error?.message === "string" && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      const [, productName, godownId, available] = error.message.split(":");
      return errorResponse("VALIDATION_ERROR", `${productName}: only ${Number(available || 0)} available in source godown #${godownId}`);
    }
    return serverError();
  }
});
