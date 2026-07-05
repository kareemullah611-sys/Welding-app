import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createProductSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const PRODUCT_SYNC_MODULE = "products";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const search = searchParams.get("search");
    const isActive = searchParams.get("is_active");

    const where: any = {};
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { name: "asc" }, skip, take: limit }),
      prisma.product.count({ where }),
    ]);

    return paginatedResponse(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        unitOfMeasure: p.unitOfMeasure,
        defaultWeightPerCartonKg: p.defaultWeightPerCartonKg ? Number(p.defaultWeightPerCartonKg) : null,
        packetsPerCarton: p.packetsPerCarton,
        piecesPerCarton: p.piecesPerCarton,
        isActive: p.isActive,
      })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid product data", parsed.error.errors);

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: PRODUCT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingProduct = await prisma.product.findUnique({ where: { id: existingSync.entityId } });
        if (existingProduct) {
          return successResponse({
            id: existingProduct.id,
            name: existingProduct.name,
            unitOfMeasure: existingProduct.unitOfMeasure,
            defaultWeightPerCartonKg: existingProduct.defaultWeightPerCartonKg ? Number(existingProduct.defaultWeightPerCartonKg) : null,
            packetsPerCarton: existingProduct.packetsPerCarton,
            piecesPerCarton: existingProduct.piecesPerCarton,
            isActive: existingProduct.isActive,
          }, "Product already synced");
        }
      }
    }

    const existing = await prisma.product.findUnique({ where: { name: parsed.data.name } });
    if (existing) return errorResponse("DUPLICATE", "Product with this name already exists", 409);

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: parsed.data.name,
          unitOfMeasure: parsed.data.unitOfMeasure,
          defaultWeightPerCartonKg: parsed.data.defaultWeightPerCartonKg,
          packetsPerCarton: parsed.data.packetsPerCarton,
          piecesPerCarton: parsed.data.piecesPerCarton,
        },
      });
      await createAuditLog(user.userId, null, "products", created.id, "create", undefined, {
        name: created.name,
        unitOfMeasure: created.unitOfMeasure,
        defaultWeightPerCartonKg: created.defaultWeightPerCartonKg ? Number(created.defaultWeightPerCartonKg) : null,
        packetsPerCarton: created.packetsPerCarton,
        piecesPerCarton: created.piecesPerCarton,
      }, getClientIP(request), tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: PRODUCT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "products",
            entityId: created.id,
            createdBy: user.userId,
          },
        });
      }
      return created;
    });

    return successResponse({
      id: product.id,
      name: product.name,
      unitOfMeasure: product.unitOfMeasure,
      defaultWeightPerCartonKg: product.defaultWeightPerCartonKg ? Number(product.defaultWeightPerCartonKg) : null,
      packetsPerCarton: product.packetsPerCarton,
      piecesPerCarton: product.piecesPerCarton,
      isActive: product.isActive,
    }, "Product created", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: PRODUCT_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingProduct = await prisma.product.findUnique({ where: { id: existingSync.entityId } });
        if (existingProduct) {
          return successResponse({
            id: existingProduct.id,
            name: existingProduct.name,
            unitOfMeasure: existingProduct.unitOfMeasure,
            defaultWeightPerCartonKg: existingProduct.defaultWeightPerCartonKg ? Number(existingProduct.defaultWeightPerCartonKg) : null,
            packetsPerCarton: existingProduct.packetsPerCarton,
            piecesPerCarton: existingProduct.piecesPerCarton,
            isActive: existingProduct.isActive,
          }, "Product already synced");
        }
      }
    }
    return serverError();
  }
});
