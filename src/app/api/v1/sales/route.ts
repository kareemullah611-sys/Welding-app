import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createSaleSchema } from "@/lib/validations";
import { journalSaleCreated } from "@/lib/accounting";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams, getDateRange,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { canAccessGodownCity } from "@/lib/godown-access";

// Round a financial value to 2 decimal places to avoid floating-point precision errors
function roundMoney(n: number): number { return Math.round(n * 100) / 100; }

// Helper: Generate next 4-digit voucher
async function generateVoucherNo(cityId: number): Promise<string> {
  const result = await prisma.voucherSequence.upsert({
    where: { cityId },
    create: { cityId, currentNumber: 1 },
    update: { currentNumber: { increment: 1 } },
  });
  let num = result.currentNumber;
  if (num > 9999) {
    await prisma.voucherSequence.update({
      where: { cityId },
      data: { currentNumber: 1 },
    });
    num = 1;
  }
  return String(num).padStart(4, "0");
}

// Helper: Get FIFO lot for a city
async function getFIFOLot(cityId: number, countryId: number): Promise<number | null> {
  const lot = await prisma.lot.findFirst({
    where: {
      countryId,
      status: "ongoing",
      lotCityDistributions: { some: { cityId } },
    },
    orderBy: [{ lotDate: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return lot?.id || null;
}

// Helper: Check godown stock for a product
async function getGodownStock(godownId: number, productId: number): Promise<number> {
  // Received stock
  const received = await prisma.lotCityGodownAllocation.aggregate({
    where: { godownId, productId },
    _sum: { qty: true },
  });

  // Sold stock (active + marked_short — both consume physical stock)
  const sold = await prisma.saleItem.aggregate({
    where: {
      productId,
      sale: { godownId, status: { in: ["active", "marked_short"] } },
    },
    _sum: { qty: true },
  });

  // Transferred out
  const transferredOut = await prisma.godownTransfer.aggregate({
    where: { fromGodownId: godownId, productId },
    _sum: { qty: true },
  });

  // Transferred in
  const transferredIn = await prisma.godownTransfer.aggregate({
    where: { toGodownId: godownId, productId },
    _sum: { qty: true },
  });

  const rcv = Number(received._sum.qty || 0);
  const sld = Number(sold._sum.qty || 0);
  const out = Number(transferredOut._sum.qty || 0);
  const inn = Number(transferredIn._sum.qty || 0);

  return rcv - sld - out + inn;
}

// GET /api/v1/sales - List sales
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const { dateFrom, dateTo } = getDateRange(searchParams);

    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const customerId = searchParams.get("customer_id") ? parseInt(searchParams.get("customer_id")!) : undefined;
    const lotId = searchParams.get("lot_id") ? parseInt(searchParams.get("lot_id")!) : undefined;
    const godownId = searchParams.get("godown_id") ? parseInt(searchParams.get("godown_id")!) : undefined;
    const statusParam = searchParams.get("status");
    // Support comma-separated status values e.g. "active,marked_short"
    const statusValues = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const productId = searchParams.get("product_id") ? parseInt(searchParams.get("product_id")!) : undefined;

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (customerId) where.customerId = customerId;
    if (lotId) where.lotId = lotId;
    if (godownId) where.godownId = godownId;
    if (statusValues.length === 1) where.status = statusValues[0];
    else if (statusValues.length > 1) where.status = { in: statusValues };
    if (productId) where.items = { some: { productId } };
    if (dateFrom || dateTo) {
      where.saleDate = {};
      if (dateFrom) where.saleDate.gte = dateFrom;
      if (dateTo) where.saleDate.lte = dateTo;
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          lot: { select: { id: true, lotNumber: true, status: true } },
          godown: { select: { id: true, name: true, cityId: true, city: { select: { name: true } } } },
          currency: true,
          items: { include: { product: { select: { id: true, name: true } } } },
          creator: { select: { id: true, fullName: true } },
        },
        orderBy: { saleDate: "desc" },
        skip,
        take: limit,
      }),
      prisma.sale.count({ where }),
    ]);

    const formatted = sales.map((s) => ({
      id: s.id,
      cityId: s.cityId,
      voucherNo: s.voucherNo,
      saleDate: s.saleDate.toISOString().split("T")[0],
      totalAmount: Number(s.totalAmount),
      status: s.status,
      stockShortFlag: s.stockShortFlag,
      notes: s.notes,
      cancellationReason: s.cancellationReason,
      customer: s.customer,
      lot: { id: s.lot.id, lotNumber: s.lot.lotNumber, status: s.lot.status },
      godown: { ...s.godown, crossCity: s.godown.cityId !== s.cityId, sourceCityName: s.godown.city?.name },
      currency: { id: s.currency.id, code: s.currency.code, symbol: s.currency.symbol },
      items: s.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        qty: Number(i.qty),
        ratePerCarton: Number(i.ratePerCarton),
        amount: Number(i.amount),
      })),
      createdBy: s.creator,
    }));

    return paginatedResponse(formatted, total, page, limit);
  } catch (error) {
    console.error("List sales error:", error);
    return serverError();
  }
});

// POST /api/v1/sales - Create sale
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") {
      return errorResponse("FORBIDDEN", "Only city admins can create sales", 403);
    }

    const body = await request.json();
    const parsed = createSaleSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid sale data", parsed.error.errors);

    const { customerId, godownId, saleDate, currencyId, notes, items } = parsed.data;
    let lotId = parsed.data.lotId;
    const cityId = user.cityId!;

    // Validate customer belongs to this city
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, cityId, isActive: true },
    });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city");

    // Validate godown is active and in the same country
    const godown = await prisma.godown.findFirst({
      where: { id: godownId, isActive: true, city: { countryId: user.countryId! } },
      include: { city: { select: { id: true, name: true } } },
    });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found or not in your country");
    const isCrossCity = godown.cityId !== cityId;
    // If cross-city, verify this admin's city has explicit permission
    if (isCrossCity) {
      const permitted = await canAccessGodownCity(cityId, godown.cityId);
      if (!permitted) return errorResponse("FORBIDDEN", `Your city does not have permission to use godowns from ${godown.city.name}`, 403);
    }

    // Validate currency is supported by this city
    const cityCurrency = await prisma.cityCurrency.findFirst({
      where: { cityId, currencyId: currencyId ?? undefined },
    });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");

    // FIFO lot assignment if not specified
    if (!lotId) {
      lotId = await getFIFOLot(cityId, user.countryId!);
      if (!lotId) return errorResponse("VALIDATION_ERROR", "No ongoing lot available for this city");
    }

    // Validate lot is ongoing and city has distribution
    const lot = await prisma.lot.findFirst({
      where: {
        id: lotId,
        status: "ongoing",
        lotCityDistributions: { some: { cityId } },
      },
    });
    if (!lot) return errorResponse("VALIDATION_ERROR", "Lot not found, completed, or not distributed to your city");

    // Validate products exist
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      return errorResponse("NOT_FOUND", "One or more products not found or inactive");
    }

    // Check stock availability and flag shortages
    const stockWarnings: string[] = [];
    let hasShortage = false;
    for (const item of items) {
      const available = await getGodownStock(godownId, item.productId);
      if (available < item.qty) {
        const productName = products.find((p) => p.id === item.productId)?.name || `Product #${item.productId}`;
        stockWarnings.push(`${productName}: available ${available}, requested ${item.qty}`);
        hasShortage = true;
      }
    }

    // Calculate total using integer-rounded arithmetic to avoid floating-point errors
    const totalAmount = roundMoney(items.reduce((sum, i) => sum + roundMoney(i.qty * i.ratePerCarton), 0));

    // Generate voucher number
    const voucherNo = await generateVoucherNo(cityId);

    // Create sale (no transaction - avoids Neon timeout)
    const sale = await prisma.sale.create({
      data: {
        cityId,
        customerId,
        lotId: lotId!,
        godownId,
        voucherNo,
        saleDate: new Date(saleDate),
        totalAmount,
        currencyId: currencyId as number,
        notes,
        status: hasShortage ? "marked_short" : "active",
        stockShortFlag: hasShortage,
        createdBy: user.userId,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            qty: i.qty,
            ratePerCarton: i.ratePerCarton,
            amount: roundMoney(i.qty * i.ratePerCarton),
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true } },
        lot: { select: { id: true, lotNumber: true, status: true } },
        godown: { select: { id: true, name: true } },
        currency: true,
        items: { include: { product: { select: { id: true, name: true } } } },
        creator: { select: { id: true, fullName: true } },
      },
    }) as any;

    await createAuditLog(user.userId, cityId, "sales", sale.id, "create", undefined, {
      voucherNo, customerId, lotId, godownId, totalAmount, items,
    }, getClientIP(request));

    const responseData = {
      id: sale.id,
      voucherNo: sale.voucherNo,
      saleDate: sale.saleDate.toISOString().split("T")[0],
      totalAmount: Number(sale.totalAmount),
      status: sale.status,
      stockShortFlag: sale.stockShortFlag,
      customer: sale.customer,
      lot: { id: sale.lot.id, lotNumber: sale.lot.lotNumber },
      godown: { ...sale.godown, crossCity: isCrossCity, sourceCityName: godown.city.name },
      currency: { id: sale.currency.id, code: sale.currency.code, symbol: sale.currency.symbol },
      items: sale.items.map((i: any) => ({
        productId: i.productId,
        productName: i.product.name,
        qty: Number(i.qty),
        ratePerCarton: Number(i.ratePerCarton),
        amount: Number(i.amount),
      })),
      createdBy: sale.creator,
      ...(stockWarnings.length > 0 ? { stockWarnings } : {}),
    };

    // Create journal entries (double-entry accounting)
    try {
      const curr = await prisma.currency.findUnique({ where: { id: sale.currencyId } });
      await journalSaleCreated({
        id: sale.id, customerId: sale.customerId, cityId: sale.cityId, lotId: sale.lotId,
        totalAmount: Number(sale.totalAmount), currencyCode: curr?.code || "PKR",
        saleDate: sale.saleDate, createdBy: user.userId,
      });
    } catch (je) { console.error("Journal entry error (sale):", je); }

    return successResponse(
      responseData,
      hasShortage
        ? `Sale created with stock shortage warnings: ${stockWarnings.join("; ")}`
        : "Sale created successfully",
      201
    );
  } catch (error) {
    console.error("Create sale error:", error);
    return serverError();
  }
});
