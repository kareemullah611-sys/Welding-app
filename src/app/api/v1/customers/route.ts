import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope, createAuditLog, getClientIP } from "@/lib/middleware";
import { createCustomerSchema, updateCustomerSchema } from "@/lib/validations";
import {
  successResponse, paginatedResponse, validationError, errorResponse, serverError,
  getPaginationParams,
} from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";

const CUSTOMER_SYNC_MODULE = "customers.create";

// GET /api/v1/customers
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const query = (searchParams.get("q") || searchParams.get("search") || "").trim();
    const normalizedQuery = query.toLowerCase();
    const shouldApplySearch = normalizedQuery.length >= 2;
    const numericQuery = Number(normalizedQuery.replace(/,/g, ""));
    const hasNumericQuery = Number.isFinite(numericQuery);
    const isActive = searchParams.get("is_active");

    const where: any = {};
    if (cityId) where.cityId = cityId;
    if (shouldApplySearch) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { phone: { contains: query, mode: "insensitive" } },
        { address: { contains: query, mode: "insensitive" } },
        { city: { name: { contains: query, mode: "insensitive" } } },
        ...(hasNumericQuery ? [{ id: Math.trunc(numericQuery) }] : []),
      ];
    }
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: { city: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      prisma.customer.count({ where }),
    ]);

    // Compute per-currency balance for each customer (group by customerId + currencyId)
    const customerIds = customers.map((c) => c.id);
    const [salesAgg, paymentsAgg, openingAgg] = await Promise.all([
      prisma.sale.groupBy({
        by: ["customerId", "currencyId"],
        where: { customerId: { in: customerIds }, status: { not: "cancelled" }, isOpeningImport: false },
        _sum: { totalAmount: true },
      }),
      prisma.payment.groupBy({
        by: ["customerId", "currencyId"],
        where: { customerId: { in: customerIds }, status: { not: "cancelled" } },
        _sum: { amount: true },
      }),
      prisma.openingCustomerBalance.groupBy({
        by: ["customerId", "currencyId"],
        where: { customerId: { in: customerIds } },
        _sum: { amount: true },
      }),
    ]);

    // Fetch currency codes for all referenced currencies
    const uniqueCurrencyIds = Array.from(
      new Set([
        ...salesAgg.map((s) => s.currencyId),
        ...paymentsAgg.map((p) => p.currencyId),
        ...openingAgg.map((o) => o.currencyId),
      ])
    );
    const currencyRows = uniqueCurrencyIds.length > 0
      ? await prisma.currency.findMany({ where: { id: { in: uniqueCurrencyIds } }, select: { id: true, code: true } })
      : [];
    const currencyCodeMap = Object.fromEntries(currencyRows.map((c) => [c.id, c.code]));

    // Build per-customer, per-currency balance map
    const balanceMap: Record<number, Record<string, number>> = {};
    for (const o of openingAgg) {
      if (!balanceMap[o.customerId]) balanceMap[o.customerId] = {};
      const code = currencyCodeMap[o.currencyId] || `CUR${o.currencyId}`;
      balanceMap[o.customerId][code] = (balanceMap[o.customerId][code] || 0) + Number(o._sum.amount ?? 0);
    }
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
          portalAccessEnabled: c.portalAccessEnabled,
          portalUsername: c.portalUsername,
          portalLastLoginAt: c.portalLastLoginAt,
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
    const syncMeta = getSyncRequestMeta(request);
    const body = await request.json();

    // Fix C6: activate the Zod schema.
    const parsed = createCustomerSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid customer data", parsed.error.errors);
    const { name, phone, address, portalAccessEnabled, portalUsername, portalPassword } = parsed.data;

    // Fix C6: validate cityId type explicitly.
    let cityId: number | null = null;
    if (user.role === "city_admin") {
      cityId = user.cityId ?? null;
    } else if (typeof parsed.data.cityId === "number" && Number.isInteger(parsed.data.cityId) && parsed.data.cityId > 0) {
      cityId = parsed.data.cityId;
    } else if (typeof user.cityId === "number") {
      cityId = user.cityId;
    }
    if (!cityId) return validationError("City is required");

    const city = await prisma.city.findFirst({ where: { id: cityId, isActive: true } });
    if (!city) return errorResponse("NOT_FOUND", "City not found");

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: CUSTOMER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingCustomer = await prisma.customer.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: { city: { select: { id: true, name: true } } },
        });
        if (existingCustomer) {
          return successResponse({
            id: existingCustomer.id, cityId: existingCustomer.cityId, cityName: existingCustomer.city.name,
            name: existingCustomer.name, phone: existingCustomer.phone, address: existingCustomer.address, isActive: existingCustomer.isActive,
            portalAccessEnabled: existingCustomer.portalAccessEnabled,
            portalUsername: existingCustomer.portalUsername,
            portalLastLoginAt: existingCustomer.portalLastLoginAt,
          }, "Customer already synced");
        }
      }
    }

    const normalizedPortalUsername = portalUsername?.trim().toLowerCase() || null;
    if (portalAccessEnabled) {
      if (!normalizedPortalUsername || !portalPassword) {
        return validationError("Portal username and password are required when portal access is enabled");
      }
      const existingPortalUser = await prisma.customer.findFirst({ where: { portalUsername: normalizedPortalUsername } });
      if (existingPortalUser) return errorResponse("CONFLICT", "Portal username already exists", 409);
    }
    const portalPasswordHash = portalAccessEnabled && portalPassword
      ? await hashPassword(portalPassword)
      : null;

    const customer = await prisma.$transaction(async (tx) => {
      const createdCustomer = await tx.customer.create({
        data: {
          cityId,
          name: name.trim(),
          phone: phone || null,
          address: address || null,
          portalAccessEnabled: Boolean(portalAccessEnabled),
          portalUsername: portalAccessEnabled ? normalizedPortalUsername : null,
          portalPasswordHash,
        },
        include: { city: { select: { id: true, name: true } } },
      });

      await createAuditLog(user.userId, cityId, "customers", createdCustomer.id, "create", undefined, {
        name: createdCustomer.name,
      }, getClientIP(request), tx);

      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId,
            module: CUSTOMER_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "customers",
            entityId: createdCustomer.id,
            createdBy: user.userId,
          },
        });
      }
      return createdCustomer;
    });

    return successResponse({
      id: customer.id, cityId: customer.cityId, cityName: customer.city.name,
      name: customer.name, phone: customer.phone, address: customer.address, isActive: customer.isActive,
      portalAccessEnabled: customer.portalAccessEnabled,
      portalUsername: customer.portalUsername,
      portalLastLoginAt: customer.portalLastLoginAt,
    }, "Customer created successfully", 201);
  } catch (error: any) {
    const syncMeta = getSyncRequestMeta(request);
    const cityId = user.role === "city_admin" ? user.cityId! : null;
    if (syncMeta && cityId && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: CUSTOMER_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        const existingCustomer = await prisma.customer.findFirst({
          where: { id: existingSync.entityId, cityId },
          include: { city: { select: { id: true, name: true } } },
        });
        if (existingCustomer) {
          return successResponse({
            id: existingCustomer.id, cityId: existingCustomer.cityId, cityName: existingCustomer.city.name,
            name: existingCustomer.name, phone: existingCustomer.phone, address: existingCustomer.address, isActive: existingCustomer.isActive,
            portalAccessEnabled: existingCustomer.portalAccessEnabled,
            portalUsername: existingCustomer.portalUsername,
            portalLastLoginAt: existingCustomer.portalLastLoginAt,
          }, "Customer already synced");
        }
      }
    }
    console.error("Create customer error:", error);
    return serverError();
  }
});
