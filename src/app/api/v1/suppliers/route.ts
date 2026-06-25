import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createSupplierSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const SUPPLIER_SYNC_MODULE = "suppliers";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({ where: { isActive: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: limit,
        include: {
          lotPurchases: { select: { totalPriceUsd: true } },
          supplierPayments: { select: { amountUsd: true } },
        },
      }),
      prisma.supplier.count({ where: { isActive: true } }),
    ]);
    const formatted = suppliers.map((s) => ({
      id: s.id, name: s.name, country: s.country, contact: s.contact, notes: s.notes, isActive: s.isActive,
      totalPurchases: s.lotPurchases.reduce((sum, p) => sum + Number(p.totalPriceUsd || 0), 0),
      totalPayments: s.supplierPayments.reduce((sum, p) => sum + Number(p.amountUsd || 0), 0),
      purchasesCount: s.lotPurchases.length,
      paymentsCount: s.supplierPayments.length,
    }));
    return paginatedResponse(formatted, total, page, limit);
  } catch (error) { console.error("List suppliers error:", error); return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const parsed = createSupplierSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPPLIER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingSupplier = await prisma.supplier.findUnique({ where: { id: existingSync.entityId } });
        if (existingSupplier) return successResponse({ id: existingSupplier.id, name: existingSupplier.name }, "Supplier already synced");
      }
    }

    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({ data: parsed.data });
      await createAuditLog(user.userId, null, "suppliers", created.id, "create", undefined, parsed.data, getClientIP(request), tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPPLIER_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "suppliers",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });
    return successResponse({ id: supplier.id, name: supplier.name }, "Supplier created", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPPLIER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingSupplier = await prisma.supplier.findUnique({ where: { id: existingSync.entityId } });
        if (existingSupplier) return successResponse({ id: existingSupplier.id, name: existingSupplier.name }, "Supplier already synced");
      }
    }
    console.error("Create supplier error:", error);
    return serverError();
  }
});
