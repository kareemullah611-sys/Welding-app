import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotSchema } from "@/lib/validations";
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
            include: { city: true, product: true },
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

// POST /api/v1/lots - Create lot (Super Admin only)
export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createLotSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid lot data", parsed.error.errors);

    const { countryId, lotNumber, lotDate, notes, products, distributions } = parsed.data;

    // Verify country exists
    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return errorResponse("NOT_FOUND", "Country not found", 404);

    // Check lot number unique within country
    const existing = await prisma.lot.findUnique({
      where: { countryId_lotNumber: { countryId, lotNumber } },
    });
    if (existing) return errorResponse("DUPLICATE", `Lot number ${lotNumber} already exists for ${country.name}`, 409);

    // Validate products exist
    const productIds = products.map((p) => p.productId);
    const existingProducts = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (existingProducts.length !== productIds.length) {
      return errorResponse("NOT_FOUND", "One or more products not found or inactive");
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

      // Check distribution doesn't exceed total
      for (const product of products) {
        const totalDistributed = distributions
          .filter((d) => d.productId === product.productId)
          .reduce((sum, d) => sum + d.allocatedQty, 0);
        if (totalDistributed > product.totalQty) {
          return errorResponse(
            "VALIDATION_ERROR",
            `Distribution for product ${product.productId} exceeds total quantity (${totalDistributed} > ${product.totalQty})`
          );
        }
      }
    }

    // Create lot then products then distributions (no transaction - avoids Neon timeout)
    const lot = await prisma.lot.create({
      data: {
        countryId,
        lotNumber,
        lotDate: new Date(lotDate),
        notes,
        createdBy: user.userId,
      },
    });

    // Add products
    for (const p of products) {
      await prisma.lotProduct.create({ data: { lotId: lot.id, productId: p.productId, totalQty: p.totalQty } });
    }

    // Add distributions if provided
    if (distributions && distributions.length > 0) {
      for (const d of distributions) {
        await prisma.lotCityDistribution.create({ data: { lotId: lot.id, cityId: d.cityId, productId: d.productId, allocatedQty: d.allocatedQty } });
      }
    }

    // Refetch with includes
    const lotFull = await prisma.lot.findUnique({
      where: { id: lot.id },
      include: {
        country: true,
        lotProducts: { include: { product: true } },
        lotCityDistributions: { include: { city: true, product: true } },
        creator: { select: { id: true, fullName: true } },
      },
    });
    if (!lotFull) return serverError();

    await createAuditLog(user.userId, null, "lots", lotFull.id, "create", undefined, {
      lotNumber, countryId, products, distributions,
    }, getClientIP(request));

    return successResponse({
      id: lotFull.id,
      countryId: lotFull.countryId,
      countryName: lotFull.country.name,
      lotNumber: lotFull.lotNumber,
      lotDate: lotFull.lotDate.toISOString().split("T")[0],
      notes: lotFull.notes,
      status: lotFull.status,
      products: lotFull.lotProducts.map((lp) => ({
        productId: lp.productId,
        productName: lp.product.name,
        totalQty: Number(lp.totalQty),
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
