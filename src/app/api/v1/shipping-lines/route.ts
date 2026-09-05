import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, paginatedResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const SHIPPING_LINE_SYNC_MODULE = "shipping_lines";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withSuperAdmin(async (request: NextRequest, _context, _user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const [lines, total] = await Promise.all([
      prisma.shippingLine.findMany({
        where: { isActive: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip, take: limit,
        include: { _count: { select: { payments: { where: { deletedAt: null } }, lotCosts: true } } },
      }),
      prisma.shippingLine.count({ where: { isActive: true } }),
    ]);

    // Compute running balance per shipping line
    const result = await Promise.all(lines.map(async (sl) => {
      const [openings, costs, totalPaidUsd] = await Promise.all([
        prisma.openingLiability.findMany({
          where: { shippingLineId: sl.id },
          include: { currency: { select: { code: true } } },
        }),
        prisma.lotCost.findMany({
          where: { shippingLineId: sl.id },
          select: { amount: true, currencyCode: true },
        }),
        prisma.shippingLinePayment.aggregate({
          where: { shippingLineId: sl.id, deletedAt: null },
          _sum: { amountUsd: true },
        }),
      ]);
      const billedByCurrency = openings.reduce<Record<string, number>>((acc, opening) => {
        acc[opening.currency.code] = Math.round(((acc[opening.currency.code] || 0) + (opening.balanceSide === "receivable" ? -Number(opening.amount) : Number(opening.amount))) * 100) / 100;
        return acc;
      }, {});
      for (const cost of costs) {
        const currencyCode = cost.currencyCode || "USD";
        billedByCurrency[currencyCode] = Math.round(((billedByCurrency[currencyCode] || 0) + Number(cost.amount)) * 100) / 100;
      }
      const billed = billedByCurrency.USD || 0;
      const paid   = Number(totalPaidUsd._sum.amountUsd || 0);
      return {
        id: sl.id, name: sl.name, contact: sl.contact, notes: sl.notes,
        totalCosts: sl._count.lotCosts, totalPayments: sl._count.payments,
        billedByCurrency,
        hasNonUsdCharges: Object.keys(billedByCurrency).some((currencyCode) => currencyCode !== "USD"),
        billedUsd: billed, paidUsd: paid, balanceOwedUsd: billed - paid,
      };
    }));

    return paginatedResponse(result, total, page, limit);
  } catch (error) { console.error("List shipping lines:", error); return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    if (!body.name?.trim()) return validationError("Name is required");

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SHIPPING_LINE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingShippingLine = await prisma.shippingLine.findUnique({ where: { id: existingSync.entityId } });
        if (existingShippingLine) return successResponse({ id: existingShippingLine.id, name: existingShippingLine.name }, "Shipping line already synced");
      }
    }

    const sl = await prisma.$transaction(async (tx) => {
      const created = await tx.shippingLine.create({
        data: { name: body.name.trim(), contact: body.contact || null, notes: body.notes || null },
      });
      await createAuditLog(user.userId, null, "shipping_lines", created.id, "create", undefined, { name: created.name }, getClientIP(request), tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SHIPPING_LINE_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "shipping_lines",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({ id: sl.id, name: sl.name }, "Shipping line created", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SHIPPING_LINE_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingShippingLine = await prisma.shippingLine.findUnique({ where: { id: existingSync.entityId } });
        if (existingShippingLine) return successResponse({ id: existingShippingLine.id, name: existingShippingLine.name }, "Shipping line already synced");
      }
    }
    console.error("Create shipping line:", error);
    return serverError();
  }
});
