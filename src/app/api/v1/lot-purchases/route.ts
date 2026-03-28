import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalLotPurchase } from "@/lib/accounting";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotPurchaseSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// POST /api/v1/lot-purchases - Record purchase prices for a lot
export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createLotPurchaseSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    const { lotId, supplierId, products, exchangeRate } = parsed.data;

    const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: { lotProducts: { select: { productId: true } } } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    // Validate positive qty and price on each product
    for (const p of products) {
      if (Number(p.qty) <= 0) return validationError(`qty must be greater than 0 (product ${p.productId})`);
      if (Number(p.unitPriceUsd) <= 0) return validationError(`unitPriceUsd must be greater than 0 (product ${p.productId})`);
    }

    // Validate all purchase products exist in this lot
    const lotProductIds = new Set(lot.lotProducts.map((lp) => lp.productId));
    const invalidProducts = products.filter((p) => !lotProductIds.has(p.productId));
    if (invalidProducts.length > 0) {
      return errorResponse("VALIDATION_ERROR", `Products not in this lot: ${invalidProducts.map((p) => p.productId).join(", ")}`);
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) return errorResponse("NOT_FOUND", "Supplier not found", 404);

    const roundMoney = (n: number) => Math.round(n * 100) / 100;
    // Batch insert all purchases atomically
    await prisma.lotPurchase.createMany({
      data: products.map((p) => ({
        lotId, supplierId, productId: p.productId,
        qty: p.qty, unitPriceUsd: p.unitPriceUsd,
        totalPriceUsd: roundMoney(p.qty * p.unitPriceUsd),
        exchangeRate: exchangeRate || null, createdBy: user.userId,
      })),
    });
    // Retrieve the created IDs for the response and journal entry
    const created = await prisma.lotPurchase.findMany({
      where: { lotId, supplierId, createdBy: user.userId },
      select: { id: true },
      orderBy: { id: "desc" },
      take: products.length,
    });
    const createdIds = created.map((c) => c.id);

    await createAuditLog(user.userId, null, "lot_purchases", lotId, "create", undefined, { supplierId, products }, getClientIP(request));

    // Journal entries for each product purchase
    try {
      const totalUsd = products.reduce((s: number, p: any) => s + p.qty * p.unitPriceUsd, 0);
      await journalLotPurchase({ id: createdIds[0] || lotId, supplierId, lotId, totalUsd, createdBy: user.userId });
    } catch (je) { console.error("Journal (purchase):", je); }

    return successResponse({ lotId, purchaseIds: createdIds }, "Purchase prices recorded", 201);
  } catch (error) { console.error("Create lot purchase error:", error); return serverError(); }
});

// GET /api/v1/lot-purchases?lot_id=X - Get purchases for a lot
export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const lotId = request.nextUrl.searchParams.get("lot_id") ? parseInt(request.nextUrl.searchParams.get("lot_id")!) : undefined;
    const where: any = {};
    if (lotId) where.lotId = lotId;

    const purchases = await prisma.lotPurchase.findMany({
      where, include: { lot: { select: { id: true, lotNumber: true } }, supplier: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return successResponse(purchases.map((p) => ({
      id: p.id, lotId: p.lotId, lotNumber: p.lot.lotNumber,
      supplierId: p.supplierId, supplierName: p.supplier.name,
      productId: p.productId, productName: p.product.name,
      qty: Number(p.qty), unitPriceUsd: Number(p.unitPriceUsd), totalPriceUsd: Number(p.totalPriceUsd),
      exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null,
    })));
  } catch (error) { return serverError(); }
});
