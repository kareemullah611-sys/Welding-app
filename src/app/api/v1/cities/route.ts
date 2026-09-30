import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createCitySchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { isAfghanistanCountry } from "@/lib/country-code";
import { checkCarryingLayerWired } from "@/lib/foreign-currency-carrying";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const countryId = searchParams.get("country_id") ? parseInt(searchParams.get("country_id")!) : undefined;
    const isActive = searchParams.get("is_active");

    const where: any = {};
    const showAll = searchParams.get("all") === "true";
    if (user.role === "city_admin" && !showAll) {
      where.id = user.cityId;
    } else {
      if (countryId) where.countryId = countryId;
    }
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const cities = await prisma.city.findMany({
      where,
      include: {
        country: true,
        cityCurrencies: { include: { currency: true } },
        _count: { select: { godowns: true, customers: true, users: true } },
      },
      orderBy: { name: "asc" },
    });

    return successResponse(
      cities.map((c) => ({
        id: c.id, name: c.name, isActive: c.isActive,
        countryId: c.countryId, countryName: c.country.name, countryCode: c.country.code,
        currencies: c.cityCurrencies.map((cc) => ({
          id: cc.currency.id, code: cc.currency.code, name: cc.currency.name, symbol: cc.currency.symbol,
        })),
        godownsCount: c._count.godowns,
        customersCount: c._count.customers,
        usersCount: c._count.users,
      }))
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createCitySchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid city data", parsed.error.errors);

    const { countryId, name, currencyIds } = parsed.data;

    const country = await prisma.country.findUnique({ where: { id: countryId } });
    if (!country) return errorResponse("NOT_FOUND", "Country not found", 404);

    const existing = await prisma.city.findFirst({ where: { countryId, name } });
    if (existing) return errorResponse("DUPLICATE", "City already exists in this country", 409);

    const currencies = await prisma.currency.findMany({ where: { id: { in: currencyIds } } });
    if (currencies.length !== currencyIds.length) return errorResponse("NOT_FOUND", "One or more currencies not found");
    const invalidCodes = currencies.filter((c) => !checkCarryingLayerWired(isAfghanistanCountry(country), c.code).ok).map((c) => c.code);
    if (invalidCodes.length > 0) {
      return errorResponse(
        "FOREIGN_CARRYING_LAYER_REQUIRED",
        `Currencies ${invalidCodes.join(", ")} have no wired immutable PKR carrying layer for ${country.name} and cannot be attached to this city.`,
        409,
      );
    }

    const city = await prisma.city.create({
      data: {
        countryId, name,
        cityCurrencies: { create: currencyIds.map((cid) => ({ currencyId: cid })) },
      },
      include: {
        country: true,
        cityCurrencies: { include: { currency: true } },
      },
    });
    // Create voucher sequence
    await prisma.voucherSequence.create({ data: { cityId: city.id, currentNumber: 0 } });

    await createAuditLog(user.userId, city.id, "cities", city.id, "create", undefined, { name, countryId }, getClientIP(request));

    return successResponse({
      id: city.id, name: city.name, isActive: city.isActive,
      countryId: city.countryId, countryName: city.country.name,
      currencies: city.cityCurrencies.map((cc) => ({
        id: cc.currency.id, code: cc.currency.code, symbol: cc.currency.symbol,
      })),
    }, "City created", 201);
  } catch (error) {
    return serverError();
  }
});
