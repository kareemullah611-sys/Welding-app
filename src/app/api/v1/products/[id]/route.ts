import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { createProductSchema } from "@/lib/validations";

export const GET = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return errorResponse("NOT_FOUND", "Product not found", 404);
    return successResponse({
      id: product.id,
      name: product.name,
      unitOfMeasure: product.unitOfMeasure,
      defaultWeightPerCartonKg: product.defaultWeightPerCartonKg ? Number(product.defaultWeightPerCartonKg) : null,
      packetsPerCarton: product.packetsPerCarton,
      piecesPerCarton: product.piecesPerCarton,
      isActive: product.isActive,
    });
  } catch (error) { return serverError(); }
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return errorResponse("NOT_FOUND", "Product not found", 404);
    const isStatusOnlyUpdate = Object.keys(body).every((key) => key === "isActive");
    if (isStatusOnlyUpdate) {
      const updated = await prisma.product.update({
        where: { id },
        data: { isActive: body.isActive !== undefined ? body.isActive : product.isActive, updatedAt: new Date() },
      });
      await createAuditLog(user.userId, null, "products", id, "update", { isActive: product.isActive }, { isActive: updated.isActive }, getClientIP(request));
      return successResponse({
        id: updated.id,
        name: updated.name,
        unitOfMeasure: updated.unitOfMeasure,
        defaultWeightPerCartonKg: updated.defaultWeightPerCartonKg ? Number(updated.defaultWeightPerCartonKg) : null,
        packetsPerCarton: updated.packetsPerCarton,
        piecesPerCarton: updated.piecesPerCarton,
        isActive: updated.isActive,
      }, "Product updated");
    }
    const nextUnitOfMeasure = body.unitOfMeasure ?? product.unitOfMeasure;
    const nextDefaultWeightPerCartonKg = body.defaultWeightPerCartonKg !== undefined ? body.defaultWeightPerCartonKg : product.defaultWeightPerCartonKg ? Number(product.defaultWeightPerCartonKg) : null;
    const nextPacketsPerCarton = body.packetsPerCarton !== undefined ? body.packetsPerCarton : product.packetsPerCarton;
    const nextPiecesPerCarton = body.piecesPerCarton !== undefined ? body.piecesPerCarton : product.piecesPerCarton;
    const parsed = createProductSchema.safeParse({
      name: body.name || product.name,
      unitOfMeasure: nextUnitOfMeasure,
      defaultWeightPerCartonKg: nextDefaultWeightPerCartonKg,
      packetsPerCarton: nextPacketsPerCarton,
      piecesPerCarton: nextPiecesPerCarton,
    });
    if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid product data", 400);

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: parsed.data.name,
        unitOfMeasure: parsed.data.unitOfMeasure,
        defaultWeightPerCartonKg: parsed.data.defaultWeightPerCartonKg,
        packetsPerCarton: parsed.data.packetsPerCarton,
        piecesPerCarton: parsed.data.piecesPerCarton,
        isActive: body.isActive !== undefined ? body.isActive : product.isActive,
        updatedAt: new Date(),
      },
    });
    await createAuditLog(user.userId, null, "products", id, "update", {
      name: product.name,
      unitOfMeasure: product.unitOfMeasure,
      defaultWeightPerCartonKg: product.defaultWeightPerCartonKg ? Number(product.defaultWeightPerCartonKg) : null,
      packetsPerCarton: product.packetsPerCarton,
      piecesPerCarton: product.piecesPerCarton,
    }, {
      name: updated.name,
      unitOfMeasure: updated.unitOfMeasure,
      defaultWeightPerCartonKg: updated.defaultWeightPerCartonKg ? Number(updated.defaultWeightPerCartonKg) : null,
      packetsPerCarton: updated.packetsPerCarton,
      piecesPerCarton: updated.piecesPerCarton,
    }, getClientIP(request));
    return successResponse({
      id: updated.id,
      name: updated.name,
      unitOfMeasure: updated.unitOfMeasure,
      defaultWeightPerCartonKg: updated.defaultWeightPerCartonKg ? Number(updated.defaultWeightPerCartonKg) : null,
      packetsPerCarton: updated.packetsPerCarton,
      piecesPerCarton: updated.piecesPerCarton,
      isActive: updated.isActive,
    }, "Product updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return errorResponse("NOT_FOUND", "Product not found", 404);

    // Check for any linked records that would block deletion
    const [saleItems, lotProducts, lotPurchases, godownAllocs] = await Promise.all([
      prisma.saleItem.count({ where: { productId: id } }),
      prisma.lotProduct.count({ where: { productId: id } }),
      prisma.lotPurchase.count({ where: { productId: id } }),
      prisma.lotCityGodownAllocation.count({ where: { productId: id } }),
    ]);

    const totalLinked = saleItems + lotProducts + lotPurchases + godownAllocs;

    if (totalLinked > 0) {
      // Build a human-readable breakdown so the user knows exactly what's blocking deletion
      const parts: string[] = [];
      if (saleItems > 0) parts.push(`${saleItems} sale item${saleItems > 1 ? "s" : ""}`);
      if (lotProducts > 0) parts.push(`${lotProducts} lot product${lotProducts > 1 ? "s" : ""}`);
      if (lotPurchases > 0) parts.push(`${lotPurchases} lot purchase${lotPurchases > 1 ? "s" : ""}`);
      if (godownAllocs > 0) parts.push(`${godownAllocs} godown allocation${godownAllocs > 1 ? "s" : ""}`);

      return errorResponse(
        "CONFLICT",
        `Cannot delete "${product.name}" — it is referenced by ${parts.join(", ")}. Deactivate it instead to hide it from new entries.`,
        409
      );
    }

    // Safe to hard-delete
    await prisma.product.delete({ where: { id } });
    await createAuditLog(user.userId, null, "products", id, "delete", { name: product.name }, undefined, getClientIP(request));
    return successResponse({ id }, "Product deleted");
  } catch (error) { return serverError(); }
});
