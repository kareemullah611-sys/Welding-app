import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createSaleSchema } from "@/lib/validations";
import { journalSaleCreated, journalPaymentReceived, journalSaleCOGS } from "@/lib/accounting";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams, getDateRange,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { canAccessGodownCity } from "@/lib/godown-access";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const SALE_SYNC_MODULE = "sales.create";

// Round a financial value to 2 decimal places to avoid floating-point precision errors
function roundMoney(n: number): number { return Math.round(n * 100) / 100; }

// Helper: Generate next 4-digit voucher
async function generateVoucherNo(cityId: number, db: PrismaClient | Prisma.TransactionClient = prisma): Promise<string> {
  const result = await db.voucherSequence.upsert({
    where: { cityId },
    create: { cityId, currentNumber: 1 },
    update: { currentNumber: { increment: 1 } },
  });
  let num = result.currentNumber;
  if (num > 9999) {
    await db.voucherSequence.update({
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
async function getGodownStock(
  godownId: number,
  productId: number,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<number> {
  // Received stock
  const received = await db.lotCityGodownAllocation.aggregate({
    where: { godownId, productId },
    _sum: { qty: true },
  });
  const opening = await db.openingStock.aggregate({
    where: { godownId, productId },
    _sum: { qty: true },
  });

  // Sold stock (active + marked_short — both consume physical stock)
  const sold = await db.saleItem.aggregate({
    where: {
      productId,
      sale: { godownId, status: { in: ["active", "marked_short"] } },
    },
    _sum: { qty: true },
  });

  // Transferred out
  const transferredOut = await db.godownTransfer.aggregate({
    where: { fromGodownId: godownId, productId },
    _sum: { qty: true },
  });

  // Transferred in
  const transferredIn = await db.godownTransfer.aggregate({
    where: { toGodownId: godownId, productId },
    _sum: { qty: true },
  });

  const opn = Number(opening._sum.qty || 0);
  const rcv = Number(received._sum.qty || 0);
  const sld = Number(sold._sum.qty || 0);
  const out = Number(transferredOut._sum.qty || 0);
  const inn = Number(transferredIn._sum.qty || 0);

  return opn + rcv - sld - out + inn;
}

function formatSaleCreateResponse(
  sale: any,
  isCrossCity: boolean,
  sourceCityName: string,
  stockWarnings?: string[],
) {
  return {
    id: sale.id,
    voucherNo: sale.voucherNo,
    saleDate: sale.saleDate.toISOString().split("T")[0],
    totalAmount: Number(sale.totalAmount),
    status: sale.status,
    stockShortFlag: sale.stockShortFlag,
    customer: sale.customer,
    lot: { id: sale.lot.id, lotNumber: sale.lot.lotNumber },
    godown: { ...sale.godown, crossCity: isCrossCity, sourceCityName },
    currency: { id: sale.currency.id, code: sale.currency.code, symbol: sale.currency.symbol },
    items: sale.items.map((i: any) => ({
      productId: i.productId,
      productName: i.product.name,
      qty: Number(i.qty),
      ratePerCarton: Number(i.ratePerCarton),
      amount: Number(i.amount),
    })),
    createdBy: sale.creator,
    ...(stockWarnings && stockWarnings.length > 0 ? { stockWarnings } : {}),
  };
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
    const rawQuery = (searchParams.get("q") || "").trim();
    const query = rawQuery.length >= 2 ? rawQuery : "";
    const normalizedQuery = query.toLowerCase();
    const compactQuery = normalizedQuery.replace(/[\s,]/g, "");
    const queryDigits = normalizedQuery.replace(/[^\d]/g, "");
    const isNumericLikeQuery = query.length >= 2 && /^-?\d*\.?\d+$/.test(compactQuery);
    const numericSearchText = isNumericLikeQuery ? compactQuery : "";
    const numericQuery = numericSearchText ? Number(numericSearchText) : NaN;
    const hasNumericQuery = Number.isFinite(numericQuery);
    const decimalPlaces = numericSearchText.includes(".") ? (numericSearchText.split(".")[1] || "").length : 0;
    const numericQueryUpper = hasNumericQuery
      ? numericQuery + (decimalPlaces > 0 ? Math.pow(10, -decimalPlaces) : 1)
      : NaN;
    const statusQuery = ["active", "cancelled", "marked_short"].includes(normalizedQuery)
      ? normalizedQuery
      : null;
    const statusParam = searchParams.get("status");
    // Support comma-separated status values e.g. "active,marked_short"
    const statusValues = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const productId = searchParams.get("product_id") ? parseInt(searchParams.get("product_id")!) : undefined;

    const baseWhere: any = {};
    if (cityId) baseWhere.cityId = cityId;
    if (customerId) baseWhere.customerId = customerId;
    if (lotId) baseWhere.lotId = lotId;
    if (godownId) baseWhere.godownId = godownId;
    if (statusValues.length === 1) baseWhere.status = statusValues[0];
    else if (statusValues.length > 1) baseWhere.status = { in: statusValues };
    if (productId) baseWhere.items = { some: { productId } };
    if (dateFrom || dateTo) {
      baseWhere.saleDate = {};
      if (dateFrom) baseWhere.saleDate.gte = dateFrom;
      if (dateTo) baseWhere.saleDate.lte = dateTo;
    }

    const formatSale = (s: any) => ({
      id: s.id,
      cityId: s.cityId,
      cityName: (s as any).city?.name ?? null,
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
      items: s.items.map((i: any) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        qty: Number(i.qty),
        ratePerCarton: Number(i.ratePerCarton),
        amount: Number(i.amount),
      })),
      createdBy: s.creator,
    });

    // Fast path: no search query -> fully DB paginated
    if (!query) {
      const [sales, total] = await Promise.all([
        prisma.sale.findMany({
          where: baseWhere,
          include: {
            customer: { select: { id: true, name: true } },
            lot: { select: { id: true, lotNumber: true, status: true } },
            godown: { select: { id: true, name: true, cityId: true, city: { select: { name: true } } } },
            city: { select: { id: true, name: true } },
            currency: true,
            items: { include: { product: { select: { id: true, name: true } } } },
            creator: { select: { id: true, fullName: true } },
          },
          orderBy: [{ saleDate: "desc" }, { id: "desc" }],
          skip,
          take: limit,
        }),
        prisma.sale.count({ where: baseWhere }),
      ]);
      return paginatedResponse(sales.map(formatSale), total, page, limit);
    }

    // Search path: load candidates under active filters, then apply full multi-column match including partial numeric digits
    const candidates = await prisma.sale.findMany({
      where: baseWhere,
      include: {
        customer: { select: { id: true, name: true } },
        lot: { select: { id: true, lotNumber: true, status: true } },
        godown: { select: { id: true, name: true, cityId: true, city: { select: { name: true } } } },
        city: { select: { id: true, name: true } },
        currency: true,
        items: { include: { product: { select: { id: true, name: true } } } },
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: [{ saleDate: "desc" }, { id: "desc" }],
    });

    const includesQuery = (value: unknown) => String(value ?? "").toLowerCase().includes(normalizedQuery);
    const digitsOnly = (value: unknown) => String(value ?? "").replace(/[^\d]/g, "");
    const numericContains = (value: unknown) => queryDigits.length >= 2 && digitsOnly(value).includes(queryDigits);
    const inNumericWindow = (value: number) =>
      Number.isFinite(value) && value >= numericQuery && value < numericQueryUpper;

    const filtered = candidates.filter((s) => {
      const textFields = [
        s.voucherNo,
        s.customer?.name,
        s.lot?.lotNumber,
        s.godown?.name,
        s.godown?.city?.name,
        s.city?.name,
        s.creator?.fullName,
        s.status,
        s.notes,
        s.cancellationReason,
        s.currency?.code,
        s.currency?.symbol,
        ...s.items.map((i: any) => i.product?.name),
      ];
      if (textFields.some(includesQuery)) return true;
      if (statusQuery && s.status === statusQuery) return true;

      const numericFields = [
        Number(s.totalAmount || 0),
        ...s.items.flatMap((i: any) => [Number(i.qty || 0), Number(i.ratePerCarton || 0), Number(i.amount || 0)]),
      ];
      if (numericFields.some((value) => numericContains(value))) return true;
      if (hasNumericQuery && numericFields.some(inNumericWindow)) return true;
      return false;
    });

    const total = filtered.length;
    const pageItems = filtered.slice(skip, skip + limit);
    return paginatedResponse(pageItems.map(formatSale), total, page, limit);
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

    const syncMeta = getSyncRequestMeta(request);
    const cityId = user.cityId!;

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: SALE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingSale = await prisma.sale.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: {
            customer: { select: { id: true, name: true } },
            lot: { select: { id: true, lotNumber: true, status: true } },
            godown: { include: { city: { select: { id: true, name: true } } } },
            currency: true,
            items: { include: { product: { select: { id: true, name: true } } } },
            creator: { select: { id: true, fullName: true } },
          },
        });
        if (existingSale) {
          const replayResponse = formatSaleCreateResponse(
            existingSale,
            existingSale.godown.cityId !== cityId,
            existingSale.godown.city.name,
          );
          return successResponse(replayResponse, "Sale already synced");
        }
      }
    }

    const body = await request.json();
    const parsed = createSaleSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid sale data", parsed.error.errors);

    const { godownId, saleDate, currencyId, notes, items } = parsed.data;
    let { customerId } = parsed.data;
    let lotId = parsed.data.lotId;

    // Handle walk-in customer (id = -1): find or create per city
    if (customerId === -1) {
      let walkin = await prisma.customer.findFirst({ where: { cityId, name: "Walk-in Customer", isActive: true } });
      if (!walkin) walkin = await prisma.customer.create({ data: { cityId, name: "Walk-in Customer", isActive: true } });
      customerId = walkin.id;
    }

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
      orderBy: { currencyId: "asc" },
    });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");
    const resolvedCurrencyId = currencyId ?? cityCurrency.currencyId;

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

    let stockWarnings: string[] = [];
    let hasShortage = false;

    // Calculate total using integer-rounded arithmetic to avoid floating-point errors
    const totalAmount = roundMoney(items.reduce((sum, i) => sum + roundMoney(i.qty * i.ratePerCarton), 0));

    const sale = await prisma.$transaction(async (tx) => {
      const productIdsToLock = Array.from(new Set(items.map((item) => item.productId)));
      if (productIdsToLock.length > 0) {
        await tx.$executeRaw`
          SELECT id
          FROM lot_city_godown_allocations
          WHERE godown_id = ${godownId}
            AND product_id IN (${Prisma.join(productIdsToLock)})
          FOR UPDATE
        `;
      }

      const txStockWarnings: string[] = [];
      let txHasShortage = false;
      for (const item of items) {
        const available = await getGodownStock(godownId, item.productId, tx);
        if (available < item.qty) {
          const productName = products.find((p) => p.id === item.productId)?.name || `Product #${item.productId}`;
          txStockWarnings.push(`${productName}: available ${available}, requested ${item.qty}`);
          txHasShortage = true;
        }
      }
      stockWarnings = txStockWarnings;
      hasShortage = txHasShortage;

      const voucherNo = await generateVoucherNo(cityId, tx);
      const createdSale = await tx.sale.create({
        data: {
          cityId,
          customerId,
          lotId: lotId!,
          godownId,
          voucherNo,
          saleDate: new Date(saleDate),
          totalAmount,
          currencyId: resolvedCurrencyId,
          notes,
          status: txHasShortage ? "marked_short" : "active",
          stockShortFlag: txHasShortage,
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

      await createAuditLog(user.userId, cityId, "sales", createdSale.id, "create", undefined, {
        voucher: `#${voucherNo}`,
        date: saleDate,
        customer: createdSale.customer.name,
        total: `${Number(totalAmount).toLocaleString("en-US")}`,
        items: createdSale.items.map((i: any) => `${i.product.name} ×${Number(i.qty)}`).join(", ") || undefined,
      }, getClientIP(request), tx);

      if (createdSale.customer.name === "Walk-in Customer") {
        const walkinPayment = await tx.payment.create({
          data: {
            cityId,
            customerId: createdSale.customerId,
            lotId: createdSale.lotId,
            saleId: createdSale.id,
            paymentDate: createdSale.saleDate,
            detail: `Walk-in cash payment — Sale Voucher #${createdSale.voucherNo}`,
            amount: createdSale.totalAmount,
            currencyId: createdSale.currencyId,
            exchangeRate: null,
            usdEquivalent: null,
            manualVoucherNo: String(createdSale.voucherNo),
            paymentMethod: "cash",
            destination: "our_account",
            notes: `Auto-recorded. Mode: Cash. Sale Voucher: #${createdSale.voucherNo}. Sale ID: ${createdSale.id}.`,
            createdBy: user.userId,
          },
        });
        await createAuditLog(user.userId, cityId, "payments", walkinPayment.id, "create", undefined, {
          date: createdSale.saleDate.toISOString().split("T")[0],
          customer: createdSale.customer.name,
          detail: `Walk-in cash payment — Sale Voucher #${createdSale.voucherNo}`,
          amount: `${createdSale.currency.symbol || createdSale.currency.code} ${Number(createdSale.totalAmount).toLocaleString("en-US")}`,
          method: "cash",
          destination: "our_account",
          autoLinkedSaleId: createdSale.id,
        }, getClientIP(request), tx);
        await journalPaymentReceived({
          id: walkinPayment.id,
          customerId: createdSale.customerId,
          cityId,
          lotId: createdSale.lotId,
          amount: Number(createdSale.totalAmount),
          currencyCode: createdSale.currency.code,
          paymentDate: createdSale.saleDate,
          createdBy: user.userId,
        }, tx);
      }

      await journalSaleCreated({
        id: createdSale.id, customerId: createdSale.customerId, cityId: createdSale.cityId, lotId: createdSale.lotId,
        totalAmount: Number(createdSale.totalAmount), currencyCode: createdSale.currency.code,
        saleDate: createdSale.saleDate, createdBy: user.userId,
      }, tx);

      const totalQtySold = items.reduce((s, i) => s + i.qty, 0);
      await journalSaleCOGS({
        saleId: createdSale.id, lotId: createdSale.lotId!, totalQtySold,
        saleDate: createdSale.saleDate, cityId: createdSale.cityId, createdBy: user.userId,
      }, tx);

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: SALE_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "sales",
            entityId: createdSale.id,
            createdBy: user.userId,
          },
        });
      }

      return createdSale;
    });

    const responseData = formatSaleCreateResponse(sale, isCrossCity, godown.city.name, stockWarnings);

    // Check inventory thresholds — fire low-stock notification if any product drops below minimum
    try {
      for (const item of items) {
        const threshold = await prisma.inventoryThreshold.findUnique({
          where: { cityId_productId: { cityId: cityId!, productId: item.productId } },
        });
        if (!threshold) continue;

        // City stock = total allocated to this city's godowns - total sold in this city
        const [openingAgg, allocatedAgg, soldAgg, xferOutAgg, xferInAgg] = await Promise.all([
          prisma.openingStock.aggregate({
            where: { cityId: cityId!, productId: item.productId },
            _sum: { qty: true },
          }),
          prisma.lotCityGodownAllocation.aggregate({
            where: { godown: { cityId: cityId! }, productId: item.productId },
            _sum: { qty: true },
          }),
          prisma.saleItem.aggregate({
            where: { productId: item.productId, sale: { cityId: cityId!, status: { notIn: ["cancelled"] } } },
            _sum: { qty: true },
          }),
          prisma.cityTransfer.aggregate({
            where: { fromCityId: cityId!, productId: item.productId, status: "approved" },
            _sum: { qty: true },
          }),
          prisma.cityTransfer.aggregate({
            where: { toCityId: cityId!, productId: item.productId, status: "approved" },
            _sum: { qty: true },
          }),
        ]);

        const cityStock =
          Number(openingAgg._sum.qty || 0) +
          Number(allocatedAgg._sum.qty || 0) -
          Number(soldAgg._sum.qty || 0) +
          Number(xferInAgg._sum.qty || 0) -
          Number(xferOutAgg._sum.qty || 0);

        if (cityStock <= Number(threshold.minQty)) {
          const productName = products.find((p) => p.id === item.productId)?.name || `Product #${item.productId}`;
          // Avoid duplicate notifications: check if a low-stock notification already exists in last 24h
          const recent = await prisma.notification.findFirst({
            where: {
              cityId: cityId!,
              type: "low_stock",
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              data: { path: ["productId"], equals: item.productId },
            },
          });
          if (!recent) {
            await prisma.notification.create({
              data: {
                cityId: cityId!,
                type: "low_stock",
                title: `⚠️ Low Stock: ${productName}`,
                message: `${productName} stock has dropped to ${cityStock} carton(s) — below minimum threshold of ${Number(threshold.minQty)}.`,
                data: { productId: item.productId, currentStock: cityStock, threshold: Number(threshold.minQty) },
              },
            });
          }
        }
      }
    } catch (te) { console.error("Threshold check error:", te); }

    return successResponse(
      responseData,
      hasShortage
        ? `Sale created with stock shortage warnings: ${stockWarnings.join("; ")}`
        : "Sale created successfully",
      201
    );
  } catch (error) {
    const syncMeta = getSyncRequestMeta(request);
    const cityId = user.role === "city_admin" ? user.cityId! : null;
    if (syncMeta && cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: SALE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingSale = await prisma.sale.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: {
            customer: { select: { id: true, name: true } },
            lot: { select: { id: true, lotNumber: true, status: true } },
            godown: { include: { city: { select: { id: true, name: true } } } },
            currency: true,
            items: { include: { product: { select: { id: true, name: true } } } },
            creator: { select: { id: true, fullName: true } },
          },
        });
        if (existingSale) {
          const replayResponse = formatSaleCreateResponse(
            existingSale,
            existingSale.godown.cityId !== cityId,
            existingSale.godown.city.name,
          );
          return successResponse(replayResponse, "Sale already synced");
        }
      }
    }
    console.error("Create sale error:", error);
    return serverError();
  }
});
