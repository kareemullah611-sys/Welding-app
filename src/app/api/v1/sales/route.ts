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
import { canAccessGodown } from "@/lib/godown-access";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { allocateSaleItemAcrossLots, consolidateSaleLotAllocationItems, AvailableSaleLot, SaleLotAllocationItem } from "@/lib/sale-lot-allocation";
import { resolveAfghanistanFxRateFromDb } from "@/lib/sarafi-af-snapshot-db";
import { isAfghanistanCountry } from "@/lib/country-code";

const SALE_SYNC_MODULE = "sales.create";

// Round a financial value to 2 decimal places to avoid floating-point precision errors
function roundMoney(n: number): number { return Math.round(n * 100) / 100; }

// Helper: Generate next 4-digit voucher (atomic wrap-around via single SQL UPDATE)
// Fix C1+H6: previous upsert+update pattern had a TOCTOU race on wrap-around at 9999.
async function generateVoucherNo(cityId: number, db: PrismaClient | Prisma.TransactionClient = prisma): Promise<string> {
  await db.voucherSequence.upsert({
    where: { cityId },
    create: { cityId, currentNumber: 0 },
    update: {},
  });
  const rows = await db.$queryRaw<Array<{ current_number: number }>>`
    UPDATE voucher_sequences
    SET current_number = CASE WHEN current_number >= 9999 THEN 1 ELSE current_number + 1 END
    WHERE city_id = ${cityId}
    RETURNING current_number
  `;
  const num = Number(rows[0]?.current_number ?? 1);
  return String(num).padStart(4, "0");
}

// Helper: Check godown stock for a product
async function getGodownStock(
  godownId: number,
  productId: number,
  lotId?: number,
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<number> {
  // Received stock
  const received = await db.lotCityGodownAllocation.aggregate({
    where: {
      godownId,
      productId,
      ...(lotId ? { lotCityDistribution: { lotId } } : {}),
    },
    _sum: { qty: true },
  });

  // Sold stock (active + marked_short — both consume physical stock)
  const sold = await db.saleItem.aggregate({
    where: {
      productId,
      ...(lotId ? { lotId } : {}),
      sale: { godownId, status: { in: ["active", "marked_short"] } },
    },
    _sum: { qty: true },
  });

  // Transferred out
  const transferredOut = await db.godownTransfer.aggregate({
    where: { fromGodownId: godownId, productId, ...(lotId ? { lotId } : {}) },
    _sum: { qty: true },
  });

  // Approved city transfers already mutate the godown allocation. Only pending
  // transfers need an additional reservation while awaiting approval.
  const cityTransferredOut = await db.cityTransfer.aggregate({
    where: { fromGodownId: godownId, productId, status: "pending", ...(lotId ? { lotId } : {}) },
    _sum: { qty: true },
  });

  // Transferred in
  const transferredIn = await db.godownTransfer.aggregate({
    where: { toGodownId: godownId, productId, ...(lotId ? { lotId } : {}) },
    _sum: { qty: true },
  });

  const rcv = Number(received._sum.qty || 0);
  const sld = Number(sold._sum.qty || 0);
  const out = Number(transferredOut._sum.qty || 0);
  const cityOut = Number(cityTransferredOut._sum.qty || 0);
  const inn = Number(transferredIn._sum.qty || 0);
  return rcv - sld - out - cityOut + inn;
}

async function getAvailableLotsForProduct(
  cityId: number,
  countryId: number,
  godownId: number,
  productId: number,
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<AvailableSaleLot[]> {
  const saleLots = await db.lot.findMany({
    where: {
      countryId,
      status: "ongoing",
      lotCityDistributions: { some: { cityId, productId } },
    },
    orderBy: [{ lotDate: "asc" }, { id: "asc" }],
    select: { id: true, lotNumber: true },
  });
  const rows: AvailableSaleLot[] = [];
  for (const lot of saleLots) {
    const available = await getGodownStock(godownId, productId, lot.id, db);
    if (available > 0) rows.push({ lotId: lot.id, lotNumber: lot.lotNumber, available });
  }
  return rows;
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
      lotId: i.lotId,
      lot: i.lot,
      productName: i.product.name,
      unitOfMeasure: i.product.unitOfMeasure,
      piecesPerCarton: i.product.piecesPerCarton,
      qty: Number(i.qty),
      cartonQty: i.cartonQty === null || i.cartonQty === undefined ? null : Number(i.cartonQty),
      ratePerCarton: Number(i.ratePerCarton),
      ratePerPieceLocal: i.ratePerPieceLocal === null || i.ratePerPieceLocal === undefined ? null : Number(i.ratePerPieceLocal),
      ratePerPieceUsd: i.ratePerPieceUsd === null || i.ratePerPieceUsd === undefined ? null : Number(i.ratePerPieceUsd),
      amount: Number(i.amount),
      amountUsd: i.amountUsd === null || i.amountUsd === undefined ? null : Number(i.amountUsd),
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
    const { dateFrom, dateToExclusive } = getDateRange(searchParams);

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
    if (godownId) baseWhere.godownId = godownId;
    if (statusValues.length === 1) baseWhere.status = statusValues[0];
    else if (statusValues.length > 1) baseWhere.status = { in: statusValues };
    const itemWhere: any = {};
    if (lotId) itemWhere.lotId = lotId;
    if (productId) itemWhere.productId = productId;
    if (Object.keys(itemWhere).length > 0) baseWhere.items = { some: itemWhere };
    if (dateFrom || dateToExclusive) {
      baseWhere.saleDate = {};
      if (dateFrom) baseWhere.saleDate.gte = dateFrom;
      if (dateToExclusive) baseWhere.saleDate.lt = dateToExclusive;
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
        lotId: i.lotId,
        lot: i.lot,
        productName: i.product.name,
        unitOfMeasure: i.product.unitOfMeasure,
        piecesPerCarton: i.product.piecesPerCarton,
        qty: Number(i.qty),
        cartonQty: i.cartonQty === null || i.cartonQty === undefined ? null : Number(i.cartonQty),
        ratePerCarton: Number(i.ratePerCarton),
        ratePerPieceLocal: i.ratePerPieceLocal === null || i.ratePerPieceLocal === undefined ? null : Number(i.ratePerPieceLocal),
        ratePerPieceUsd: i.ratePerPieceUsd === null || i.ratePerPieceUsd === undefined ? null : Number(i.ratePerPieceUsd),
        amount: Number(i.amount),
        amountUsd: i.amountUsd === null || i.amountUsd === undefined ? null : Number(i.amountUsd),
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
            items: { include: { lot: { select: { id: true, lotNumber: true, status: true } }, product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } } } },
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
        items: { include: { lot: { select: { id: true, lotNumber: true, status: true } }, product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } } } },
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
            items: { include: { lot: { select: { id: true, lotNumber: true, status: true } }, product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } } } },
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
      const permitted = await canAccessGodown(cityId, godown.id, godown.cityId);
      if (!permitted) return errorResponse("FORBIDDEN", `Your city does not have permission to use godowns from ${godown.city.name}`, 403);
    }

    // Validate currency is supported by this city
    const cityCurrency = await prisma.cityCurrency.findFirst({
      where: { cityId, currencyId: currencyId ?? undefined },
      orderBy: { currencyId: "asc" },
      include: { currency: true },
    });
    if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not supported in your city");
    const resolvedCurrencyId = currencyId ?? cityCurrency.currencyId;
    const resolvedCurrency = cityCurrency.currency;

    // Validate products exist
    const productIds: number[] = Array.from(new Set<number>(items.map((i) => i.productId)));
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      return errorResponse("NOT_FOUND", "One or more products not found or inactive");
    }

    const productById = new Map(products.map((p) => [p.id, p]));
    const requestedItems: SaleLotAllocationItem[] = [];
    for (const item of items) {
      const product = productById.get(item.productId)!;
      const itemLotId = Number(item.lotId || lotId || 0) || null;
      if (product.unitOfMeasure === "PCS") {
        if (!product.piecesPerCarton) return errorResponse("VALIDATION_ERROR", `${product.name}: PCS/CTN is required on product master`);
        const cartonQty = Number(item.cartonQty || item.qty || 0);
        const stockQty = cartonQty * product.piecesPerCarton;
        const ratePerPieceLocal = Number(item.ratePerPieceLocal || 0);
        const ratePerPieceUsd = item.ratePerPieceUsd ? Number(item.ratePerPieceUsd) : null;
        if (cartonQty <= 0 || ratePerPieceLocal <= 0) return errorResponse("VALIDATION_ERROR", `${product.name}: carton quantity and local price/PCS are required`);
        requestedItems.push({
          productId: item.productId,
          lotId: itemLotId,
          stockQty,
          cartonQty,
          ratePerCarton: roundMoney(ratePerPieceLocal * product.piecesPerCarton),
          ratePerPieceLocal,
          ratePerPieceUsd,
        });
        continue;
      }
      const stockQty = Number(item.qty || 0);
      const ratePerCarton = Number(item.ratePerCarton || 0);
      if (stockQty <= 0 || ratePerCarton <= 0) return errorResponse("VALIDATION_ERROR", `${product.name}: quantity and rate/carton are required`);
      requestedItems.push({
        productId: item.productId,
        lotId: itemLotId,
        stockQty,
        cartonQty: null,
        ratePerCarton,
        ratePerPieceLocal: null,
        ratePerPieceUsd: null,
      });
    }

    const allocatedItems: SaleLotAllocationItem[] = [];
    for (const item of requestedItems) {
      const product = productById.get(item.productId)!;
      try {
        allocatedItems.push(...allocateSaleItemAcrossLots({
          item,
          availableLots: await getAvailableLotsForProduct(cityId, user.countryId!, godownId, item.productId),
          roundMoney,
        }));
      } catch {
        return errorResponse("VALIDATION_ERROR", `${product.name}: lot allocation exceeds available stock`);
      }
    }
    const normalizedItems = consolidateSaleLotAllocationItems(allocatedItems, roundMoney);

    if (!normalizedItems.length) return errorResponse("VALIDATION_ERROR", "Lot is required for each product");
    const itemLotIds: number[] = Array.from(new Set<number>(normalizedItems.map((i) => Number(i.lotId || 0))));
    if (itemLotIds.some((id) => !Number.isInteger(id) || id <= 0)) return errorResponse("VALIDATION_ERROR", "Lot is required for each product");
    const lots = await prisma.lot.findMany({
      where: {
        id: { in: itemLotIds },
        status: "ongoing",
        lotCityDistributions: { some: { cityId } },
      },
      select: { id: true, lotNumber: true, status: true },
    });
    if (lots.length !== itemLotIds.length) return errorResponse("VALIDATION_ERROR", "One or more lots are completed, missing, or not distributed to your city");
    lotId = normalizedItems[0].lotId!;
    const lot = lots.find((row) => row.id === lotId) || lots[0];

    // Calculate total using integer-rounded arithmetic to avoid floating-point errors
    const totalAmount = roundMoney(normalizedItems.reduce((sum, i) => sum + Number(i.amount || 0), 0));
    const country = await prisma.country.findUnique({ where: { id: user.countryId! }, select: { code: true, name: true } });
    const isAfghanistan = isAfghanistanCountry(country);
    const saleFx = isAfghanistan && ["AFN", "USD", "CNY"].includes(String(resolvedCurrency.code || "").toUpperCase())
      ? await resolveAfghanistanFxRateFromDb({
          currencyCode: resolvedCurrency.code,
          transactionDate: new Date(saleDate),
          purpose: "sale_recognition",
          positionKind: "asset",
        })
      : null;

    const sale = await prisma.$transaction(async (tx) => {
      const productIdsToLock: number[] = Array.from(new Set<number>(normalizedItems.map((item) => item.productId)));
      if (productIdsToLock.length > 0) {
        await tx.$executeRaw`
          SELECT id
          FROM lot_city_godown_allocations
          WHERE godown_id = ${godownId}
            AND product_id IN (${Prisma.join(productIdsToLock)})
          FOR UPDATE
        `;
      }

      for (const item of normalizedItems) {
        const available = await getGodownStock(godownId, item.productId, item.lotId!, tx);
        if (available < item.stockQty) {
          const productName = products.find((p) => p.id === item.productId)?.name || `Product #${item.productId}`;
          const lotNumber = lots.find((row) => row.id === item.lotId)?.lotNumber || item.lotId;
          throw new Error(`STOCK_SHORT:${productName} Lot ${lotNumber}: requested ${item.stockQty} exceeds available stock ${available}`);
        }
      }

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
          ...(saleFx?.ok ? {
            fxSnapshotId: saleFx.provider === "SARAFI_AF" ? saleFx.snapshotId || null : null,
            fxOriginalCurrencyCode: resolvedCurrency.code,
            fxOriginalAmount: totalAmount,
            fxSelectedRate: saleFx.rate,
            fxSelectedRateType: saleFx.selectedRateType,
            fxProvider: saleFx.provider,
            fxProviderReference: saleFx.providerReference,
            fxPkrEquivalent: roundMoney(totalAmount * saleFx.rate),
            fxConversionPathJson: saleFx.conversionPath,
          } : {}),
          notes,
          status: "active",
          stockShortFlag: false,
          createdBy: user.userId,
          items: {
            create: normalizedItems.map((i) => ({
              productId: i.productId,
              lotId: i.lotId!,
              qty: i.stockQty,
              cartonQty: i.cartonQty,
              ratePerCarton: i.ratePerCarton,
              ratePerPieceLocal: i.ratePerPieceLocal,
              ratePerPieceUsd: i.ratePerPieceUsd,
              amount: i.amount || 0,
              amountUsd: i.amountUsd,
            })),
          },
        },
        include: {
          customer: { select: { id: true, name: true } },
          lot: { select: { id: true, lotNumber: true, status: true } },
          godown: { select: { id: true, name: true } },
          currency: true,
          items: { include: { lot: { select: { id: true, lotNumber: true, status: true } }, product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } } } },
          creator: { select: { id: true, fullName: true } },
        },
      }) as any;

      await createAuditLog(user.userId, cityId, "sales", createdSale.id, "create", undefined, {
        voucher: `#${voucherNo}`,
        date: saleDate,
        customer: createdSale.customer.name,
        total: `${Number(totalAmount).toLocaleString("en-US")}`,
        items: createdSale.items.map((i: any) => `${i.product.name} ×${Number(i.cartonQty || i.qty)}`).join(", ") || undefined,
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

      const qtyByLot = normalizedItems.reduce((acc: Record<number, number>, item) => {
        acc[item.lotId!] = (acc[item.lotId!] || 0) + item.stockQty;
        return acc;
      }, {});
      for (const [itemLotId, totalQtySold] of Object.entries(qtyByLot) as Array<[string, number]>) {
        await journalSaleCOGS({
          saleId: createdSale.id, lotId: Number(itemLotId), totalQtySold,
          saleDate: createdSale.saleDate, cityId: createdSale.cityId, createdBy: user.userId,
        }, tx);
      }

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

    const responseData = formatSaleCreateResponse(sale, isCrossCity, godown.city.name);

    return successResponse(responseData, "Sale created successfully", 201);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("STOCK_SHORT:")) {
      return errorResponse("VALIDATION_ERROR", error.message.replace("STOCK_SHORT:", ""));
    }
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
            items: { include: { lot: { select: { id: true, lotNumber: true, status: true } }, product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } } } },
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
