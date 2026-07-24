import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { journalSaleCreated, journalSaleCOGS } from "@/lib/accounting";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { canAccessGodown } from "@/lib/godown-access";
import { allocateSaleItemAcrossLots, AvailableSaleLot, SaleLotAllocationItem } from "@/lib/sale-lot-allocation";

// PUT /api/v1/sales/:id/correct - Correct items on a sale (wrong product given)
// Body: { items: [{ id?, productId, lotId, qty, ratePerCarton }], reason: string }
export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const saleId = parseInt(context.params.id);
    const body = await request.json();
    const { items, reason } = body;

    if (!items?.length) return errorResponse("VALIDATION_ERROR", "Provide corrected items");
    if (!reason) return errorResponse("VALIDATION_ERROR", "Provide a reason for correction");

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { lot: { select: { id: true, status: true } } } }, currency: { select: { code: true } } },
    });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (sale.status !== "active") return errorResponse("VALIDATION_ERROR", "Can only correct active sales");

    if (user.role === "city_admin" && sale.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }
    const nextGodownId = Number(body.godownId || sale.godownId || 0);
    const godown = await prisma.godown.findFirst({
      where: { id: nextGodownId, isActive: true, city: { countryId: user.countryId! } },
      include: { city: { select: { id: true, name: true } } },
    });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found or not in your country");
    if (godown.cityId !== sale.cityId) {
      const permitted = await canAccessGodown(sale.cityId, godown.id, godown.cityId);
      if (!permitted) return errorResponse("FORBIDDEN", `This city does not have permission to use godowns from ${godown.city.name}`, 403);
    }

    // Fix P2: Validate all products exist and are active (same checks as sale creation)
    const productIds: number[] = Array.from(new Set<number>(items.map((i: any) => Number(i.productId))));
    if (productIds.some(isNaN)) return errorResponse("VALIDATION_ERROR", "All items must have a valid productId");

    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missing = productIds.filter((pid) => !foundIds.has(pid));
      return errorResponse("VALIDATION_ERROR", `Product(s) not found or inactive: ${missing.join(", ")}`);
    }

    for (const item of items) {
      if (!item.qty || Number(item.qty) <= 0) return errorResponse("VALIDATION_ERROR", "All item quantities must be > 0");
      if (!item.ratePerCarton || Number(item.ratePerCarton) <= 0) return errorResponse("VALIDATION_ERROR", "All item rates must be > 0");
    }
    const oldItemById = new Map(sale.items.map((item) => [item.id, item]));
    const lotIds: number[] = Array.from(new Set<number>(items.map((item: any) => Number(item.lotId || 0))));
    if (lotIds.some((id) => !Number.isInteger(id) || id <= 0)) return errorResponse("VALIDATION_ERROR", "Lot is required for each item");
    const lots = await prisma.lot.findMany({
      where: { id: { in: lotIds }, lotCityDistributions: { some: { cityId: sale.cityId } } },
      select: { id: true, status: true },
    });
    if (lots.length !== lotIds.length) return errorResponse("VALIDATION_ERROR", "One or more lots are not distributed to this city");
    const lotStatusById = new Map(lots.map((lot) => [lot.id, lot.status]));
    for (const item of items) {
      const lockedLot = oldItemById.get(Number(item.id || 0))?.lot;
      const lockedLotId = lockedLot?.id;
      if (lockedLot && lockedLot.status === "completed" && Number(item.lotId) !== lockedLotId) {
        return errorResponse("VALIDATION_ERROR", "Completed lot sale items cannot be moved to another lot");
      }
      if (lotStatusById.get(Number(item.lotId)) !== "ongoing" && lockedLot?.status !== "completed") {
        return errorResponse("VALIDATION_ERROR", "New or changed sale item lots must be ongoing");
      }
    }
    const candidateLots = await prisma.lot.findMany({
      where: {
        lotCityDistributions: { some: { cityId: sale.cityId, productId: { in: productIds } } },
        OR: [{ status: "ongoing" }, { id: { in: lotIds } }],
      },
      orderBy: [{ lotDate: "asc" }, { id: "asc" }],
      select: { id: true, lotNumber: true, status: true },
    });
    const candidateLotIds = Array.from(new Set(candidateLots.map((lot) => lot.id)));

    // Normalize corrected quantities across available lots in the selected godown.
    // Because this sale is already part of the sold total, add back its own old quantities
    // so the correction is checked as a replacement, not as an extra sale.
    const stockKey = (lotId: number, productId: number) => `${lotId}:${productId}`;
    const oldQtyByLotProduct = sale.items.reduce((acc: Record<string, number>, item) => {
      if (nextGodownId !== sale.godownId) return acc;
      const key = stockKey(item.lotId, item.productId);
      acc[key] = (acc[key] || 0) + Number(item.qty);
      return acc;
    }, {});
    const stockRows: any[] = await prisma.$queryRaw`
      WITH received AS (
        SELECT lcd.lot_id, lcd.product_id, COALESCE(SUM(lcga.qty), 0) as qty
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        WHERE lcga.godown_id = ${nextGodownId}
          AND lcd.product_id IN (${Prisma.join(productIds)})
          AND lcd.lot_id IN (${Prisma.join(candidateLotIds)})
        GROUP BY lcd.lot_id, lcd.product_id
      ),
      sold AS (
        SELECT si.lot_id, si.product_id, COALESCE(SUM(si.qty), 0) as qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.godown_id = ${nextGodownId}
          AND s.status IN ('active', 'marked_short')
          AND si.product_id IN (${Prisma.join(productIds)})
          AND si.lot_id IN (${Prisma.join(candidateLotIds)})
        GROUP BY si.lot_id, si.product_id
      ),
      city_out AS (
        SELECT ct.lot_id, ct.product_id, COALESCE(SUM(ct.qty), 0) as qty
        FROM city_transfers ct
        WHERE ct.from_godown_id = ${nextGodownId}
          AND ct.status = 'approved'
          AND ct.product_id IN (${Prisma.join(productIds)})
          AND ct.lot_id IN (${Prisma.join(candidateLotIds)})
        GROUP BY ct.lot_id, ct.product_id
      ),
      city_in AS (
        SELECT ct.lot_id, ct.product_id, COALESCE(SUM(ct.qty), 0) as qty
        FROM city_transfers ct
        WHERE ct.to_godown_id = ${nextGodownId}
          AND ct.status = 'approved'
          AND ct.product_id IN (${Prisma.join(productIds)})
          AND ct.lot_id IN (${Prisma.join(candidateLotIds)})
        GROUP BY ct.lot_id, ct.product_id
      )
      SELECT
        lcd.lot_id,
        p.id as product_id,
        COALESCE(r.qty, 0) - COALESCE(s.qty, 0) - COALESCE(co.qty, 0) + COALESCE(ci.qty, 0) as available
      FROM products p
      CROSS JOIN (SELECT UNNEST(ARRAY[${Prisma.join(candidateLotIds)}])::int AS lot_id) lcd
      LEFT JOIN received r ON r.product_id = p.id AND r.lot_id = lcd.lot_id
      LEFT JOIN sold s ON s.product_id = p.id AND s.lot_id = lcd.lot_id
      LEFT JOIN city_out co ON co.product_id = p.id AND co.lot_id = lcd.lot_id
      LEFT JOIN city_in ci ON ci.product_id = p.id AND ci.lot_id = lcd.lot_id
      WHERE p.id IN (${Prisma.join(productIds)})
    `;
    const availableByLotProduct = Object.fromEntries(
      stockRows.map((row) => [stockKey(Number(row.lot_id), Number(row.product_id)), Number(row.available || 0)])
    );

    const availableLotsByProduct = new Map<number, AvailableSaleLot[]>();
    for (const lot of candidateLots) {
      for (const productId of productIds) {
        const key = stockKey(lot.id, productId);
        const effectiveAvailable = Number(availableByLotProduct[key] || 0) + Number(oldQtyByLotProduct[key] || 0);
        if (effectiveAvailable > 0 || items.some((item: any) => Number(item.productId) === productId && Number(item.lotId) === lot.id)) {
          const rows = availableLotsByProduct.get(productId) || [];
          rows.push({ lotId: lot.id, lotNumber: lot.lotNumber, available: effectiveAvailable });
          availableLotsByProduct.set(productId, rows);
        }
      }
    }

    const roundMoney = (n: number) => Math.round(n * 100) / 100;
    const normalizedItems: SaleLotAllocationItem[] = [];
    for (const item of items) {
      const productId = Number(item.productId);
      const productName = products.find((p) => p.id === productId)?.name || `Product ${productId}`;
      const lockedLot = oldItemById.get(Number(item.id || 0))?.lot;
      const availableLots = lockedLot?.status === "completed"
        ? (availableLotsByProduct.get(productId) || []).filter((lot) => Number(lot.lotId) === Number(lockedLot.id))
        : (availableLotsByProduct.get(productId) || []);
      const requestedItem: SaleLotAllocationItem = {
        productId,
        lotId: Number(item.lotId),
        stockQty: Number(item.qty),
        cartonQty: null,
        ratePerCarton: Number(item.ratePerCarton),
        ratePerPieceLocal: null,
        ratePerPieceUsd: null,
      };
      try {
        const allocatedItems = allocateSaleItemAcrossLots({ item: requestedItem, availableLots, roundMoney });
        normalizedItems.push(...allocatedItems);
        for (const allocatedItem of allocatedItems) {
          const productLots = availableLotsByProduct.get(productId) || [];
          const lot = productLots.find((row) => Number(row.lotId) === Number(allocatedItem.lotId));
          if (lot) lot.available = roundMoney(Number(lot.available || 0) - Number(allocatedItem.stockQty || 0));
        }
      } catch {
        return errorResponse("VALIDATION_ERROR", `${productName}: corrected quantity ${Number(item.qty)} exceeds available stock in ${godown.name}`);
      }
    }

    const oldItems = sale.items.map((i) => ({
      id: i.id, productId: i.productId, lotId: i.lotId, qty: Number(i.qty),
      ratePerCarton: Number(i.ratePerCarton), amount: Number(i.amount),
    }));

    const newItemData = normalizedItems.map((item: any) => ({
      saleId,
      productId: Number(item.productId),
      lotId: Number(item.lotId),
      qty: Number(item.stockQty),
      ratePerCarton: Number(item.ratePerCarton),
      amount: roundMoney(Number(item.stockQty) * Number(item.ratePerCarton)),
    }));
    const totalAmount = roundMoney(newItemData.reduce((sum: number, i: { amount: number }) => sum + i.amount, 0));

    await prisma.$transaction(async (tx) => {
      // Deterministically replace sale journals on correction to avoid cumulative
      // reverse/repost drift when a sale is corrected multiple times.
      await tx.journalEntry.deleteMany({
        where: {
          transactionId: {
            in: [
              `SALE-${saleId}`,
              `REV-SALE-${saleId}`,
              `COGS-${saleId}`,
              `REV-COGS-${saleId}`,
            ],
          },
        },
      });

      await tx.saleItem.deleteMany({ where: { saleId } });
      await tx.saleItem.createMany({ data: newItemData });
      await tx.sale.update({
        where: { id: saleId },
        data: {
          godownId: nextGodownId,
          totalAmount,
          notes: `${sale.notes || ""}\n[CORRECTION: ${reason}]`.trim(),
        },
      });

      await journalSaleCreated({
        id: saleId, customerId: sale.customerId, cityId: sale.cityId,
        lotId: sale.lotId!, totalAmount, currencyCode: (sale as any).currency?.code || "PKR",
        saleDate: sale.saleDate, createdBy: user.userId,
      }, tx);

      const qtyByLot = newItemData.reduce((acc: Record<number, number>, item: { lotId: number; qty: number }) => {
        acc[item.lotId] = (acc[item.lotId] || 0) + item.qty;
        return acc;
      }, {});
      for (const [itemLotId, totalQtySold] of Object.entries(qtyByLot) as Array<[string, number]>) {
        await journalSaleCOGS({
          saleId, lotId: Number(itemLotId), totalQtySold,
          saleDate: sale.saleDate, cityId: sale.cityId, createdBy: user.userId,
        }, tx);
      }

      await createAuditLog(user.userId, sale.cityId, "sales", saleId, "update",
        { items: oldItems, totalAmount: Number(sale.totalAmount), godownId: sale.godownId },
        { items: newItemData.map(({ saleId: _s, ...rest }: any) => rest), totalAmount, godownId: nextGodownId, reason, action: "correction" },
        getClientIP(request),
        tx
      );
    });

    return successResponse({ saleId, totalAmount }, "Sale corrected successfully");
  } catch (error) {
    console.error("Sale correction error:", error);
    return serverError();
  }
});
