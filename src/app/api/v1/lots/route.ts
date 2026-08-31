import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotSchema } from "@/lib/validations";
import { buildLotPurchasePkrBasis, journalLotPurchase } from "@/lib/accounting";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams, getDateRange,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { cityAssignmentMetricsFromDistributions } from "@/lib/city-lot-assignment";
import { aggregateLotSalesMetrics, fetchLotSalesForMetrics } from "@/lib/lot-sold-metrics";
import { LOT_SHIPMENT_STATUS_VALUES, lotShipmentStatusLabel } from "@/lib/lot-documents";
import { resolveLotRecognitionRateFromDb } from "@/lib/lot-recognition-fx-db";

const LOT_SYNC_MODULE = "lots";
const SUPERADMIN_SYNC_CITY_ID = 0;

type ProductUnitMeta = {
  id: number;
  name: string;
  unitOfMeasure: "MT" | "PCS";
  defaultWeightPerCartonKg: any;
  piecesPerCarton: number | null;
};

function purchaseStockQty(item: any, product: ProductUnitMeta) {
  if (product.unitOfMeasure === "PCS") return Number(item.qtyPcs || 0);
  return Math.round((Number(item.qtyMt || 0) * 1000) / Number(product.defaultWeightPerCartonKg || 0));
}

function purchaseQtyAndPrice(item: any, product: ProductUnitMeta) {
  const purchaseQty = product.unitOfMeasure === "PCS" ? Number(item.qtyPcs || 0) : Number(item.qtyMt || 0);
  const unitPriceUsd = product.unitOfMeasure === "PCS" ? Number(item.unitPriceUsdPerPcs || 0) : Number(item.unitPriceUsdPerMt || 0);
  return { purchaseQty, unitPriceUsd };
}

function toDisplayStockQty(qty: number, product: { unitOfMeasure?: string | null; piecesPerCarton?: number | null }) {
  const piecesPerCarton = Number(product.piecesPerCarton || 0);
  if (product.unitOfMeasure === "PCS" && piecesPerCarton > 0) {
    return Math.round((qty / piecesPerCarton) * 100) / 100;
  }
  return Math.round(qty * 100) / 100;
}

// GET /api/v1/lots - List lots
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateToExclusive } = getDateRange(searchParams);

    const countryId = searchParams.get("country_id") ? parseInt(searchParams.get("country_id")!) : undefined;
    const status = searchParams.get("status") as "ongoing" | "completed" | undefined;
    const query = (searchParams.get("q") || searchParams.get("search") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);
    const statusQuery = ["ongoing", "completed"].includes(normalizedQuery) ? normalizedQuery : null;

    // Build where clause
    const where: any = { isLegacyStock: false };

    // City admin: show lots for their country that include their city
    if (user.role === "city_admin") {
      where.countryId = user.countryId!;
      where.lotCityDistributions = { some: { cityId: user.cityId! } };
    } else if (countryId) {
      where.countryId = countryId;
    }

    if (status) where.status = status;
    if (shouldApplySearch) {
      where.OR = [
        { lotNumber: { contains: query, mode: "insensitive" } },
        { notes: { contains: query, mode: "insensitive" } },
        ...(statusQuery ? [{ status: statusQuery as any }] : []),
        { country: { name: { contains: query, mode: "insensitive" } } },
        { creator: { fullName: { contains: query, mode: "insensitive" } } },
        { completer: { fullName: { contains: query, mode: "insensitive" } } },
        { consignee: { name: { contains: query, mode: "insensitive" } } },
        { destinationCity: { name: { contains: query, mode: "insensitive" } } },
        { lotProducts: { some: { product: { name: { contains: query, mode: "insensitive" } } } } },
        { lotPurchases: { some: { supplier: { name: { contains: query, mode: "insensitive" } } } } },
        { lotPurchases: { some: { product: { name: { contains: query, mode: "insensitive" } } } } },
        ...(hasNumericQuery ? [{ id: Math.trunc(numericQuery) }, { pkrExchangeRate: numericQuery }] : []),
      ];
    }
    if (dateFrom || dateToExclusive) {
      where.lotDate = {};
      if (dateFrom) where.lotDate.gte = dateFrom;
      if (dateToExclusive) where.lotDate.lt = dateToExclusive;
    }

    const [lots, total] = await Promise.all([
      prisma.lot.findMany({
        where,
        include: {
          country: true,
          consignee: { select: { id: true, name: true, phone: true, address: true, notes: true, isActive: true } },
          destinationCity: { select: { id: true, name: true } },
          creator: { select: { id: true, fullName: true } },
          completer: { select: { id: true, fullName: true } },
          lotProducts: { include: { product: true } },
          lotPurchases: { include: { supplier: { select: { id: true, name: true } } } },
          lotCityDistributions: {
            include: { city: true, product: true, godownAllocations: true },
            ...(user.role === "city_admin" ? { where: { cityId: user.cityId! } } : {}),
          },
          _count: { select: { sales: true, hajiTransfers: true, documents: { where: { archivedAt: null } } } },
        },
        orderBy: { lotDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.lot.count({ where }),
    ]);

    // Sold cartons + sales amounts per lot (active + marked_short both consume stock)
    const soldByLotProduct: Record<number, Record<number, number>> = {};
    const soldAmountByLotProduct: Record<number, Record<number, number>> = {};
    const soldSalesByLot: Record<number, Record<string, number>> = {};
    const lotIds = lots.map((l) => l.id);
    if (lotIds.length > 0) {
      const lotSales = await fetchLotSalesForMetrics(
        lotIds,
        user.role === "city_admin" ? { cityId: user.cityId! } : {}
      );
      const metricsByLot = aggregateLotSalesMetrics(lotSales);
      for (const lotId of lotIds) {
        const metrics = metricsByLot.get(lotId);
        if (!metrics) continue;
        soldByLotProduct[lotId] = metrics.soldQtyByProduct;
        soldAmountByLotProduct[lotId] = metrics.soldAmountByProduct;
        soldSalesByLot[lotId] = metrics.soldSalesByCurrency;
      }
      if (user.role === "city_admin") {
        for (const lotId of lotIds) {
          const metrics = metricsByLot.get(lotId);
          if (!metrics) continue;
          soldByLotProduct[lotId] = metrics.soldQtyByProduct;
          soldAmountByLotProduct[lotId] = metrics.soldAmountByProduct;
          soldSalesByLot[lotId] = metrics.soldSalesByCurrency;
        }
      }
    }

    const formatted = lots.map((lot) => {
      const cityDists = lot.lotCityDistributions.map((d) => ({
        id: d.id,
        cityId: d.cityId,
        cityName: d.city.name,
        productId: d.productId,
        productName: d.product.name,
        unitOfMeasure: d.product.unitOfMeasure,
        piecesPerCarton: d.product.piecesPerCarton,
        allocatedQty: Number(d.allocatedQty),
        displayAllocatedQty: toDisplayStockQty(Number(d.allocatedQty), d.product),
        godownAllocations: d.godownAllocations.map((ga) => ({
          godownId: ga.godownId,
          qty: Number(ga.qty),
          displayQty: toDisplayStockQty(Number(ga.qty), d.product),
        })),
      }));

      let totalCartons: number;
      let soldCartons: number;
      let remainingCartons: number;
      let assignmentProducts: Array<{
        productId: number;
        productName: string;
        assignedQty: number;
        soldQty: number;
        soldAmount: number;
        remainingQty: number;
      }> | undefined;
      let soldSalesByCurrency: Record<string, number> | undefined;

      if (user.role === "city_admin") {
        const metrics = cityAssignmentMetricsFromDistributions(
          cityDists,
          soldByLotProduct[lot.id] || {},
          soldAmountByLotProduct[lot.id] || {}
        );
        totalCartons = metrics.totalCartons;
        soldCartons = metrics.soldCartons;
        remainingCartons = metrics.remainingCartons;
        assignmentProducts = metrics.byProduct;
        assignmentProducts = metrics.byProduct.map((product) => {
          const distribution = cityDists.find((d) => d.productId === product.productId);
          return distribution
            ? {
                ...product,
                displayAssignedQty: toDisplayStockQty(product.assignedQty, distribution),
                displaySoldQty: toDisplayStockQty(product.soldQty, distribution),
                displayRemainingQty: toDisplayStockQty(product.remainingQty, distribution),
              }
            : product;
        });
        soldSalesByCurrency = soldSalesByLot[lot.id] || {};
      } else {
        totalCartons = lot.lotProducts.reduce((s, lp) => s + toDisplayStockQty(Number(lp.totalQty), lp.product), 0);
        soldCartons = lot.lotProducts.reduce((s, lp) => s + toDisplayStockQty(Number(soldByLotProduct[lot.id]?.[lp.productId] || 0), lp.product), 0);
        remainingCartons = Math.max(0, totalCartons - soldCartons);
      }

      return {
        totalCartons,
        soldCartons,
        remainingCartons,
        assignmentProducts,
        soldSalesByCurrency,
        id: lot.id,
        countryId: lot.countryId,
        countryName: lot.country.name,
        countryCode: lot.country.code,
        lotNumber: lot.lotNumber,
        lotDate: lot.lotDate.toISOString().split("T")[0],
        notes: lot.notes,
        status: lot.status,
        shipmentStatus: lot.shipmentStatus,
        shipmentStatusLabel: lotShipmentStatusLabel(lot.shipmentStatus),
        etaDate: lot.etaDate?.toISOString().split("T")[0] || null,
        consignee: lot.consignee,
        destinationCity: lot.destinationCity,
        documentsCount: lot._count.documents,
        isLegacyStock: lot.isLegacyStock,
        createdBy: lot.creator,
        completedBy: lot.completer,
        completedAt: lot.completedAt?.toISOString() || null,
        products: lot.lotProducts.map((lp) => ({
          id: lp.id,
          productId: lp.productId,
          productName: lp.product.name,
          unitOfMeasure: lp.product.unitOfMeasure,
          piecesPerCarton: lp.product.piecesPerCarton,
          totalQty: Number(lp.totalQty),
          displayTotalQty: toDisplayStockQty(Number(lp.totalQty), lp.product),
        })),
        suppliers: Array.from(new Map(lot.lotPurchases.map((p) => [p.supplierId, { id: p.supplierId, name: p.supplier.name }])).values()),
        distributions: cityDists,
        salesCount: lot._count.sales,
        hajiTransfersCount: lot._count.hajiTransfers,
        createdAt: lot.createdAt.toISOString(),
      };
    });

    return paginatedResponse(formatted, total, page, limit);
  } catch (error) {
    console.error("List lots error:", error);
    return serverError();
  }
});

// POST /api/v1/lots - Create lot with purchase invoice (Super Admin only)
export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const parsed = createLotSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid lot data", parsed.error.errors);

    const { countryId, consigneeId, destinationCityId, lotNumber, lotDate, shipmentStatus, etaDate, notes, purchaseItems, distributions } = parsed.data;
    if (shipmentStatus && !LOT_SHIPMENT_STATUS_VALUES.includes(shipmentStatus as any)) {
      return validationError("Invalid shipment status");
    }

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: LOT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingLot = await prisma.lot.findUnique({ where: { id: existingSync.entityId } });
        if (existingLot) return successResponse({ id: existingLot.id }, "Lot already synced");
      }
    }

    // Verify country exists
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return errorResponse("NOT_FOUND", "Country not found", 404);
    const recognitionRate = await resolveLotRecognitionRateFromDb({
      countryCode: country.code,
      transactionDate: new Date(`${lotDate}T00:00:00.000Z`),
    });
    if (!recognitionRate.ok) {
      return errorResponse("VALIDATION_ERROR", recognitionRate.missingReason, 400);
    }
    if (consigneeId) {
      const consignee = await prisma.consignee.findUnique({ where: { id: consigneeId } });
      if (!consignee) return errorResponse("NOT_FOUND", "Consignee not found", 404);
    }
    if (destinationCityId) {
      const destination = await prisma.city.findUnique({ where: { id: destinationCityId } });
      if (!destination || destination.countryId !== countryId) return errorResponse("VALIDATION_ERROR", "Destination city must belong to selected country", 400);
    }

    // Check lot number unique within country
    const existing = await prisma.lot.findUnique({
      where: { countryId_lotNumber: { countryId, lotNumber } },
    });
    if (existing) return errorResponse("DUPLICATE", `Lot number ${lotNumber} already exists for ${country.name}`, 409);

    // Validate all products exist
    const productIds = Array.from(new Set(purchaseItems.map((p) => p.productId)));
    const existingProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (existingProducts.length !== productIds.length) {
      return errorResponse("NOT_FOUND", "One or more products not found or inactive");
    }

    // Validate all suppliers exist
    const supplierIds = Array.from(new Set(purchaseItems.map((p) => p.supplierId)));
    const existingSuppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds }, isActive: true },
    });
    if (existingSuppliers.length !== supplierIds.length) {
      return errorResponse("NOT_FOUND", "One or more suppliers not found or inactive");
    }

    const productById = new Map(existingProducts.map((p) => [p.id, p as ProductUnitMeta]));
    for (const item of purchaseItems) {
      const product = productById.get(item.productId);
      if (!product) continue;
      if (product.unitOfMeasure === "PCS") {
        if (!product.piecesPerCarton) return errorResponse("VALIDATION_ERROR", `${product.name}: PCS/CTN is required on product master`);
        if (!item.qtyPcs || !item.unitPriceUsdPerPcs) return errorResponse("VALIDATION_ERROR", `${product.name}: QTY (PCS) and USD/PCS are required`);
      } else {
        if (!product.defaultWeightPerCartonKg) return errorResponse("VALIDATION_ERROR", `${product.name}: WT/CRT (KG) is required on product master`);
        if (!item.qtyMt || !item.unitPriceUsdPerMt) return errorResponse("VALIDATION_ERROR", `${product.name}: QTY (MT) and USD/MT are required`);
      }
    }

    // Derive LotProduct totals: MT products store cartons; PCS products store pieces.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const productCartons: Record<number, number> = {};
    for (const item of purchaseItems) {
      const product = productById.get(item.productId)!;
      const stockQty = purchaseStockQty(item, product);
      productCartons[item.productId] = (productCartons[item.productId] || 0) + stockQty;
    }

    // Validate distributions if provided
    if (distributions && distributions.length > 0) {
      const cityIds = Array.from(new Set(distributions.map((d) => d.cityId)));
      const cities = await prisma.city.findMany({
        where: { id: { in: cityIds }, countryId, isActive: true },
      });
      if (cities.length !== cityIds.length) {
        return errorResponse("VALIDATION_ERROR", "All distribution cities must belong to the same country and be active");
      }
      for (const [productId, totalQty] of Object.entries(productCartons)) {
        const totalDistributed = distributions
          .filter((d) => d.productId === Number(productId))
          .reduce((sum, d) => sum + d.allocatedQty, 0);
        if (totalDistributed > totalQty) {
          return errorResponse("VALIDATION_ERROR", `Distribution for product ${productId} exceeds total quantity`);
        }
      }
    }

    const lotFull = await prisma.$transaction(async (tx) => {
      const lot = await tx.lot.create({
        data: {
          countryId,
          consigneeId: consigneeId || null,
          destinationCityId: destinationCityId || null,
          lotNumber,
          lotDate: new Date(lotDate),
          shipmentStatus: (shipmentStatus || "order_confirmed") as any,
          etaDate: etaDate ? new Date(etaDate) : null,
          notes,
          pkrExchangeRate: recognitionRate.rate,
          pkrExchangeRateMetadata: recognitionRate as any,
          createdBy: user.userId,
        },
      });

      await tx.lotStatusHistory.create({
        data: {
          lotId: lot.id,
          previousStatus: null,
          newStatus: (shipmentStatus || "order_confirmed") as any,
          effectiveAt: new Date(),
          note: "Initial shipment status",
          changedBy: user.userId,
        },
      });

      for (const [productId, totalQty] of Object.entries(productCartons)) {
        await tx.lotProduct.create({
          data: { lotId: lot.id, productId: Number(productId), totalQty },
        });
      }

      for (const item of purchaseItems) {
        const product = productById.get(item.productId)!;
        const { purchaseQty, unitPriceUsd } = purchaseQtyAndPrice(item, product);
        const totalPriceUsd = round2(purchaseQty * unitPriceUsd);
        const purchaseBasis = buildLotPurchasePkrBasis({ totalUsd: totalPriceUsd, carryingRatePkr: recognitionRate.rate });
        const purchase = await tx.lotPurchase.create({
          data: {
            lotId: lot.id,
            supplierId: item.supplierId,
            productId: item.productId,
            qty: purchaseQty,
            weightPerCartonKg: product.unitOfMeasure === "PCS" ? null : product.defaultWeightPerCartonKg,
            unitPriceUsd,
            totalPriceUsd,
            carryingRatePkr: purchaseBasis.carryingRatePkr,
            carryingAmountPkr: purchaseBasis.carryingAmountPkr,
            recognitionDate: new Date(lotDate),
            recognitionRateMetadata: recognitionRate as any,
            createdBy: user.userId,
          },
        });
        await journalLotPurchase(
          {
            id: purchase.id, supplierId: item.supplierId, lotId: lot.id, totalUsd: totalPriceUsd,
            carryingRatePkr: purchaseBasis.carryingRatePkr, carryingAmountPkr: purchaseBasis.carryingAmountPkr,
            recognitionDate: new Date(lotDate), journalVersion: purchase.journalVersion, createdBy: user.userId,
          },
          tx
        );
      }

      if (distributions && distributions.length > 0) {
        for (const d of distributions) {
          await tx.lotCityDistribution.create({
            data: { lotId: lot.id, cityId: d.cityId, productId: d.productId, allocatedQty: d.allocatedQty },
          });
        }
      }

      const createdLot = await tx.lot.findUnique({
        where: { id: lot.id },
        include: {
          country: true,
          consignee: { select: { id: true, name: true, phone: true, address: true, notes: true, isActive: true } },
          destinationCity: { select: { id: true, name: true } },
          lotProducts: { include: { product: true } },
          lotPurchases: { include: { supplier: { select: { id: true, name: true } }, product: { select: { id: true, name: true, unitOfMeasure: true, defaultWeightPerCartonKg: true, piecesPerCarton: true } } } },
          lotCityDistributions: { include: { city: true, product: true } },
          creator: { select: { id: true, fullName: true } },
        },
      });
      if (!createdLot) throw new Error("LOT_CREATE_FETCH_FAILED");

      await createAuditLog(user.userId, null, "lots", createdLot.id, "create", undefined, {
        lotNumber, countryId, consigneeId, destinationCityId, shipmentStatus, purchaseItems, distributions,
        pkrExchangeRate: recognitionRate.rate,
        pkrExchangeRateMetadata: recognitionRate,
      }, getClientIP(request), tx);

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: LOT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "lots",
            entityId: createdLot.id,
            createdBy: user.userId,
          },
        });
      }

      return createdLot;
    });

    const totalUsd = lotFull.lotPurchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);

    return successResponse({
      id: lotFull.id,
      countryId: lotFull.countryId,
      countryName: lotFull.country.name,
      lotNumber: lotFull.lotNumber,
      lotDate: lotFull.lotDate.toISOString().split("T")[0],
      notes: lotFull.notes,
      pkrExchangeRate: Number(lotFull.pkrExchangeRate),
      pkrExchangeRateMetadata: (lotFull as any).pkrExchangeRateMetadata || recognitionRate,
      status: lotFull.status,
      shipmentStatus: lotFull.shipmentStatus,
      shipmentStatusLabel: lotShipmentStatusLabel(lotFull.shipmentStatus),
      etaDate: lotFull.etaDate?.toISOString().split("T")[0] || null,
      consignee: lotFull.consignee,
      destinationCity: lotFull.destinationCity,
      documentsCount: 0,
      totalPurchaseUsd: round2(totalUsd),
      products: lotFull.lotProducts.map((lp) => ({
        productId: lp.productId,
        productName: lp.product.name,
        unitOfMeasure: lp.product.unitOfMeasure,
        defaultWeightPerCartonKg: lp.product.defaultWeightPerCartonKg ? Number(lp.product.defaultWeightPerCartonKg) : null,
        piecesPerCarton: lp.product.piecesPerCarton,
        totalQty: Number(lp.totalQty),
        displayTotalQty: toDisplayStockQty(Number(lp.totalQty), lp.product),
      })),
      purchaseItems: lotFull.lotPurchases.map((p) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierName: p.supplier.name,
        productId: p.productId,
        productName: p.product.name,
        unitOfMeasure: p.product.unitOfMeasure,
        defaultWeightPerCartonKg: p.product.defaultWeightPerCartonKg ? Number(p.product.defaultWeightPerCartonKg) : null,
        piecesPerCarton: p.product.piecesPerCarton,
        qtyMt: p.product.unitOfMeasure === "PCS" ? null : Number(p.qty),
        qtyPcs: p.product.unitOfMeasure === "PCS" ? Number(p.qty) : null,
        weightPerCartonKg: p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null,
        unitPriceUsdPerMt: p.product.unitOfMeasure === "PCS" ? null : Number(p.unitPriceUsd),
        unitPriceUsdPerPcs: p.product.unitOfMeasure === "PCS" ? Number(p.unitPriceUsd) : null,
        totalPriceUsd: Number(p.totalPriceUsd),
      })),
      distributions: lotFull.lotCityDistributions.map((d) => ({
        cityId: d.cityId,
        cityName: d.city.name,
        productId: d.productId,
        productName: d.product.name,
        unitOfMeasure: d.product.unitOfMeasure,
        piecesPerCarton: d.product.piecesPerCarton,
        allocatedQty: Number(d.allocatedQty),
        displayAllocatedQty: toDisplayStockQty(Number(d.allocatedQty), d.product),
      })),
      createdBy: lotFull.creator,
    }, "Lot created successfully", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: LOT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingLot = await prisma.lot.findUnique({ where: { id: existingSync.entityId } });
        if (existingLot) {
          return successResponse({ id: existingLot.id }, "Lot already synced");
        }
      }
    }
    console.error("Create lot error:", error);
    return serverError();
  }
});
