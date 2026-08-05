import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { updateCitySchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PATCH = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid city id");

    const body = await request.json();
    const parsed = updateCitySchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid city data", parsed.error.errors);

    const city = await prisma.city.findUnique({ where: { id } });
    if (!city) return errorResponse("NOT_FOUND", "City not found", 404);

    const data: any = {};
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.trim();
      const existing = await prisma.city.findFirst({
        where: { countryId: city.countryId, name, id: { not: id } },
      });
      if (existing) return errorResponse("DUPLICATE", "Another city with this name already exists in this country", 409);
      data.name = name;
    }
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;

    const oldValues = {
      name: city.name,
      isActive: city.isActive,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.city.update({ where: { id }, data });
      if (parsed.data.currencyIds !== undefined) {
        await tx.cityCurrency.deleteMany({ where: { cityId: id } });
        await tx.cityCurrency.createMany({
          data: parsed.data.currencyIds.map((currencyId) => ({ cityId: id, currencyId })),
        });
      }
      await createAuditLog(user.userId, id, "cities", id, "update", oldValues, { ...data, ...(parsed.data.currencyIds ? { currencyIds: parsed.data.currencyIds } : {}) }, getClientIP(request), tx);
      return result;
    });

    const full = await prisma.city.findUnique({
      where: { id },
      include: { country: true, cityCurrencies: { include: { currency: true } } },
    });

    return successResponse({
      id: full!.id, name: full!.name, isActive: full!.isActive,
      countryId: full!.countryId, countryName: full!.country.name,
      currencies: full!.cityCurrencies.map((cc) => ({
        id: cc.currency.id, code: cc.currency.code, symbol: cc.currency.symbol,
      })),
    }, "City updated");
  } catch (error) {
    console.error("Update city error:", error);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    if (isNaN(id)) return errorResponse("VALIDATION_ERROR", "Invalid city id");

    const city = await prisma.city.findUnique({ where: { id } });
    if (!city) return errorResponse("NOT_FOUND", "City not found", 404);

    if (!city.isActive) return errorResponse("VALIDATION_ERROR", "City is already deactivated");

    // Do not allow deactivating a city that still has active users.
    const activeUsers = await prisma.user.count({ where: { cityId: id, isActive: true } });
    if (activeUsers > 0) {
      return errorResponse("VALIDATION_ERROR", "Deactivate or reassign the city's active admins before deactivating the city");
    }

    await prisma.$transaction(async (tx) => {
      await tx.city.update({ where: { id }, data: { isActive: false } });
      await createAuditLog(user.userId, id, "cities", id, "delete", { name: city.name, isActive: true }, { isActive: false }, getClientIP(request), tx);
    });

    return successResponse({ id }, "City deactivated");
  } catch (error) {
    console.error("Deactivate city error:", error);
    return serverError();
  }
});
