import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createCustomerSchema, updateCustomerSchema } from "@/lib/validations";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/customers
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const search = searchParams.get("search");
    const isActive = searchParams.get("is_active");

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: { city: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    // Compute per-currency balance for each customer (group by customerId + currencyId)
    const customerIds = customers.map((c) => c.id);
    const [salesAgg, paymentsAgg] = await Promise.all([
      prisma.sale.groupBy({
        by: ["customerId", "currencyId"],
        where: { customerId: { in: customerIds }, status: { not: "cancelled" } },
        _sum: { totalAmount: true },
      }),
      prisma.payment.groupBy({
        by: ["customerId", "currencyId"],
        where: { customerId: { in: customerIds }, status: { not: "cancelled" } },
        _sum: { amount: true },
      }),
    ]);

    // Fetch currency codes for all referenced currencies
    const uniqueCurrencyIds = [...new Set([...salesAgg.map((s) => s.currencyId), ...paymentsAgg.map((p) => p.currencyId)])];
    const currencyRows = uniqueCurrencyIds.length > 0
      ? await prisma.currency.findMany({ where: { id: { in: uniqueCurrencyIds } }, select: { id: true, code: true } })
      : [];
    const currencyCodeMap = Object.fromEntries(currencyRows.map((c) => [c.id, c.code]));

    // Build per-customer, per-currency balance map
    const balanceMap: Record<number, Record<string, number>> = {};
    for (const s of salesAgg) {
      if (!balanceMap[s.customerId]) balanceMap[s.customerId] = {};
      const code = currencyCodeMap[s.currencyId] || `CUR${s.currencyId}`;
      balanceMap[s.customerId][code] = (balanceMap[s.customerId][code] || 0) + Number(s._sum.totalAmount ?? 0);
    }
    for (const p of paymentsAgg) {
      if (!balanceMap[p.customerId]) balanceMap[p.customerId] = {};
      const code = currencyCodeMap[p.currencyId] || `CUR${p.currencyId}`;
      balanceMap[p.customerId][code] = (balanceMap[p.customerId][code] || 0) - Number(p._sum.amount ?? 0);
    }

    return paginatedResponse(
      customers.map((c) => {
        const raw = balanceMap[c.id] || {};
        const balanceByCurrency = Object.fromEntries(
          Object.entries(raw).map(([cc, amt]) => [cc, Math.round(amt * 100) / 100])
        );
        return {
          id: c.id, cityId: c.cityId, cityName: c.city.name,
          name: c.name, phone: c.phone, address: c.address, isActive: c.isActive,
          balanceByCurrency,
          balance: Math.round(Object.values(raw).reduce((s, v) => s + v, 0) * 100) / 100,
        };
      }),
      total, page, limit
    );
  } catch (error) {
    console.error("List customers error:", error);
    return serverError();
  }
});

// POST /api/v1/customers
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    if (!body.name || !body.name.trim()) return validationError("Customer name is required");

    const cityId = user.role === "city_admin" ? user.cityId! : (body.cityId || user.cityId);
    if (!cityId) return validationError("City is required");

    const city = await prisma.city.findFirst({ where: { id: cityId, isActive: true } });
    if (!city) return errorResponse("NOT_FOUND", "City not found");

    const customer = await prisma.customer.create({
      data: { cityId, name: body.name.trim(), phone: body.phone || null, address: body.address || null },
      include: { city: { select: { id: true, name: true } } },
    });

    await createAuditLog(user.userId, cityId, "customers", customer.id, "create", undefined, {
      name: customer.name,
    }, getClientIP(request));

    return successResponse({
      id: customer.id, cityId: customer.cityId, cityName: customer.city.name,
      name: customer.name, phone: customer.phone, address: customer.address, isActive: customer.isActive,
    }, "Customer created successfully", 201);
  } catch (error) {
    console.error("Create customer error:", error);
    return serverError();
  }
});
