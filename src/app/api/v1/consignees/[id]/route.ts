import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

function formatConsignee(row: any) {
  return {
    id: row.id,
    name: row.name,
    countryId: row.countryId,
    countryName: row.country?.name || null,
    cityId: row.cityId,
    cityName: row.city?.name || null,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: row.isActive,
    lotsCount: row._count?.lots || 0,
  };
}

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    if (!id) return validationError("Invalid consignee");
    const body = await request.json();
    const existing = await prisma.consignee.findUnique({ where: { id }, include: { _count: { select: { lots: true } } } });
    if (!existing) return errorResponse("NOT_FOUND", "Consignee not found", 404);

    const name = body.name !== undefined ? String(body.name || "").trim() : existing.name;
    if (!name) return validationError("Name is required");
    const countryId = body.countryId === undefined ? existing.countryId : body.countryId ? Number(body.countryId) : null;
    const cityId = body.cityId === undefined ? existing.cityId : body.cityId ? Number(body.cityId) : null;
    if (cityId) {
      const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true, countryId: true } });
      if (!city) return errorResponse("NOT_FOUND", "City not found", 404);
      if (countryId && city.countryId !== countryId) return validationError("City does not belong to selected country");
    }

    const duplicate = await prisma.consignee.findUnique({ where: { name } });
    if (duplicate && duplicate.id !== id) return errorResponse("DUPLICATE", "Consignee already exists", 409);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.consignee.update({
        where: { id },
        data: {
          name,
          countryId,
          cityId,
          phone: body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : existing.phone,
          address: body.address !== undefined ? (body.address ? String(body.address).trim() : null) : existing.address,
          notes: body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes,
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive,
        },
        include: { country: true, city: true, _count: { select: { lots: true } } },
      });
      await createAuditLog(user.userId, null, "consignees", id, "update", { name: existing.name, isActive: existing.isActive }, { name: row.name, isActive: row.isActive }, getClientIP(request), tx);
      return row;
    });

    return successResponse(formatConsignee(updated), "Consignee updated");
  } catch (error) {
    console.error("Update consignee error:", error);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    if (!id) return validationError("Invalid consignee");
    const existing = await prisma.consignee.findUnique({ where: { id }, include: { _count: { select: { lots: true } } } });
    if (!existing) return errorResponse("NOT_FOUND", "Consignee not found", 404);

    const archived = await prisma.$transaction(async (tx) => {
      const row = await tx.consignee.update({
        where: { id },
        data: { isActive: false },
        include: { country: true, city: true, _count: { select: { lots: true } } },
      });
      await createAuditLog(user.userId, null, "consignees", id, "update", { isActive: existing.isActive }, { isActive: false }, getClientIP(request), tx);
      return row;
    });

    return successResponse(formatConsignee(archived), existing._count.lots > 0 ? "Consignee archived; historical lots preserved" : "Consignee archived");
  } catch (error) {
    console.error("Archive consignee error:", error);
    return serverError();
  }
});
