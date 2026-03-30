import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotSchema } from "@/lib/validations";
import { journalLotPurchase } from "@/lib/accounting";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams, getDateRange,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/lots - List lots
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);

    const countryId = searchParams.get("country_id") ? parseInt(searchParams.get("country_id")!) : undefined;
    const status = searchParams.get("status") as "ongoing" | "completed" | undefined;
    const search = searchParams.get("search");

    // Build where clause
    const where: any = {};

    // City admin: show lots for their country that include their city
    if (user.role === "city_admin") {
      where.countryId = user.countryId!;
      where.lotCityDistributions = { some: { cityId: user.cityId! } };
    } else if (countryId) {
      where.countryId = countryId;
    }

    if (status) where.status = status;
    if (search) where.lotNumber = { contains: search, mode: "insensitive" };
    if (dateFrom || dateTo) {
      where.lotDate = {};
      if (dateFrom) where.lotDate.gte = dateFrom;
      if (dateTo) where.lotDate.lte = dateTo;
    }

    const [lots, total] = await Promise.all([
      prisma.lot.findMany({
        where,
        include: {
          country: true,
          creator: { select: { id: true, fullName: true } },
          completer: { select: { id: true, fullName: true } },
          lotProducts: { include: { product: true } },
          lotCityDistributions: {
            include: { city: true, product: true, godownAllocations: true },
            ...(user.role === "city_admin" ? { where: { cityId: user.cityId! } } : {}),
          },
          _count: { select: { sales: true, hajiTransfers: true } },
        },
        orderBy: { lotDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.lot.count({ where }),
    ]);

    const formatted = lots.map((lot) => ({
      id: lot.id,
      countryId: lot.countryId,
      countryName: lot.country.name,
      countryCode: lot.country.code,
      lotNumber: lot.lotNumber,
      lotDate: lot.lotDate.toISOString().split("T")[0],
      notes: lot.notes,
      status: lot.status,
      createdBy: lot.creator,
      completedBy: lot.completer,
      completedAt: lot.completedAt?.toISOString() || null,
      products: lot.lotProducts.map((lp) => ({
        id: lp.id,
        productId: lp.productId,
        productName: lp.product.name,
        totalQty: Number(lp.totalQty),
      })),
      distributions: lot.lotCityDistributions.map((d) => ({
        id: d.id,
        cityId: d.cityId,
        cityName: d.city.name,
        productId: d.productId,
        productName: d.product.name,
        allocatedQty: Number(d.allocatedQty),
        godownAllocations: d.godownAllocations.map((ga) => ({
          godownId: ga.godownId,
          qty: Number(ga.qty),
        })),
      })),
      salesCount: lot._count.sales,
      hajiTransfersCount: lot._count.hajiTransfers,
      createdAt: lot.createdAt.toISOString(),
    }));

    return paginatedResponse(formatted, total, page, limit);
  } catch (error) {
    console.error("List lots error:", error);
    return serverError();
  }
});

// POST /api/v1/lots - Create lot with purchase invoice (Super Admin only)
export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createLotSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid lot data", parsed.error.errors);

    const { countryId, lotNumber, lotDate, notes, purchaseItems, distributions } = parsed.data;

    // Verify country exists
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return errorResponse("NOT_FOUND", "Country not found", 404);

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

    // Derive LotProduct totals: sum cartons per product
    // cartons = round((qtyMt * 1000) / weightPerCartonKg)
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const productCartons: Record<number, number> = {};
    for (const item of purchaseItems) {
      const cartons = Math.round((item.qtyMt * 1000) / item.weightPerCartonKg);
      productCartons[item.productId] = (productCartons[item.productId] || 0) + cartons;
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

    // Create lot
    const lot = await prisma.lot.create({
      data: { countryId, lotNumber, lotDate: new Date(lotDate), notes, createdBy: user.userId },
    });

    // Add LotProduct records (one per unique product, qty in cartons)
    for (const [productId, totalQty] of Object.entries(productCartons)) {
      await prisma.lotProduct.create({
        data: { lotId: lot.id, productId: Number(productId), totalQty },
      });
    }

    // Add LotPurchase records (one per invoice line item)
    for (const item of purchaseItems) {
      const totalPriceUsd = round2(item.qtyMt * item.unitPriceUsdPerMt);
      const purchase = await prisma.lotPurchase.create({
        data: {
          lotId: lot.id,
          supplierId: item.supplierId,
          productId: item.productId,
          qty: item.qtyMt,
          weightPerCartonKg: item.weightPerCartonKg,
          unitPriceUsd: item.unitPriceUsdPerMt,
          totalPriceUsd,
          createdBy: user.userId,
        },
      });
      try {
        await journalLotPurchase({ id: purchase.id, supplierId: item.supplierId, lotId: lot.id, totalUsd: totalPriceUsd, createdBy: user.userId });
      } catch (je) { console.error("Journal (lot purchase):", je); }
    }

    // Add distributions if provided
    if (distributions && distributions.length > 0) {
      for (const d of distributions) {
        await prisma.lotCityDistribution.create({
          data: { lotId: lot.id, cityId: d.cityId, productId: d.productId, allocatedQty: d.allocatedQty },
        });
      }
    }

    // Refetch with full includes
    const lotFull = await prisma.lot.findUnique({
      where: { id: lot.id },
      include: {
        country: true,
        lotProducts: { include: { product: true } },
        lotPurchases: { include: { supplier: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } } },
        lotCityDistributions: { include: { city: true, product: true } },
        creator: { select: { id: true, fullName: true } },
      },
    });
    if (!lotFull) return serverError();

    await createAuditLog(user.userId, null, "lots", lotFull.id, "create", undefined, {
      lotNumber, countryId, purchaseItems, distributions,
    }, getClientIP(request));

    const totalUsd = lotFull.lotPurchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);

    return successResponse({
      id: lotFull.id,
      countryId: lotFull.countryId,
      countryName: lotFull.country.name,
      lotNumber: lotFull.lotNumber,
      lotDate: lotFull.lotDate.toISOString().split("T")[0],
      notes: lotFull.notes,
      status: lotFull.status,
      totalPurchaseUsd: round2(totalUsd),
      products: lotFull.lotProducts.map((lp) => ({
        productId: lp.productId,
        productName: lp.product.name,
        totalQty: Number(lp.totalQty),
      })),
      purchaseItems: lotFull.lotPurchases.map((p) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierName: p.supplier.name,
        productId: p.productId,
        productName: p.product.name,
        qtyMt: Number(p.qty),
        weightPerCartonKg: p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null,
        unitPriceUsdPerMt: Number(p.unitPriceUsd),
        totalPriceUsd: Number(p.totalPriceUsd),
      })),
      distributions: lotFull.lotCityDistributions.map((d) => ({
        cityId: d.cityId,
        cityName: d.city.name,
        productId: d.productId,
        productName: d.product.name,
        allocatedQty: Number(d.allocatedQty),
      })),
      createdBy: lotFull.creator,
    }, "Lot created successfully", 201);
  } catch (error) {
    console.error("Create lot error:", error);
    return serverError();
  }
});
