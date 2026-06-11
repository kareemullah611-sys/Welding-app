import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { OpeningLiabilityType } from "@prisma/client";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { journalOpeningLiability, reverseJournalEntries } from "@/lib/accounting";

function dateOnly(value?: string | null): Date {
  if (!value) return new Date();
  return new Date(value);
}

function getScopedCityId(user: JWTPayload, requestedCityId?: unknown): number | null {
  if (user.role === "city_admin") return user.cityId ?? null;
  const cityId = Number(requestedCityId || 0);
  return Number.isInteger(cityId) && cityId > 0 ? cityId : null;
}

const OPENINGS_SYNC_MODULE = "openings";
const OPENING_LIABILITY_SYNC_MODULE = "opening_liabilities";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" && user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only admins can access openings", 403);
    }

    const cityId = getScopedCityId(user, request.nextUrl.searchParams.get("city_id"));

    const [cities, currenciesRaw, customers, godowns, products, openingCash, openingCustomerBalances, openingStocks, liabilityCurrencies, suppliers, shippingLines, agents, intermediaries, openingLiabilities] = await Promise.all([
      user.role === "super_admin"
        ? prisma.city.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      cityId
        ? prisma.cityCurrency.findMany({
            where: { cityId },
            select: { currency: { select: { id: true, code: true, symbol: true } } },
            orderBy: { currencyId: "asc" },
          })
        : Promise.resolve([]),
      cityId
        ? prisma.customer.findMany({ where: { cityId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      cityId
        ? prisma.godown.findMany({ where: { cityId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      cityId
        ? prisma.openingCash.findMany({
            where: { cityId },
            include: { currency: { select: { code: true, symbol: true } } },
            orderBy: { currencyId: "asc" },
          })
        : Promise.resolve([]),
      cityId
        ? prisma.openingCustomerBalance.findMany({
            where: { customer: { cityId } },
            include: {
              customer: { select: { id: true, name: true } },
              currency: { select: { code: true, symbol: true } },
            },
            orderBy: [{ customerId: "asc" }, { currencyId: "asc" }],
          })
        : Promise.resolve([]),
      cityId
        ? prisma.openingStock.findMany({
            where: { cityId },
            include: { godown: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } },
            orderBy: [{ godownId: "asc" }, { productId: "asc" }],
          })
        : Promise.resolve([]),
      user.role === "super_admin"
        ? prisma.currency.findMany({ select: { id: true, code: true, symbol: true }, orderBy: { code: "asc" } })
        : Promise.resolve([]),
      user.role === "super_admin"
        ? prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      user.role === "super_admin"
        ? prisma.shippingLine.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      user.role === "super_admin"
        ? prisma.agent.findMany({ where: { isActive: true }, select: { id: true, name: true, agentType: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      user.role === "super_admin"
        ? prisma.intermediary.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
      user.role === "super_admin"
        ? prisma.openingLiability.findMany({
            include: {
              currency: { select: { id: true, code: true, symbol: true } },
              supplier: { select: { id: true, name: true } },
              shippingLine: { select: { id: true, name: true } },
              agent: { select: { id: true, name: true } },
              intermediary: { select: { id: true, name: true } },
            },
            orderBy: [{ liabilityType: "asc" }, { openingDate: "asc" }],
          })
        : Promise.resolve([]),
    ]);

    return successResponse({
      cities,
      selectedCityId: cityId,
      currencies: currenciesRaw.map((c) => c.currency),
      customers,
      godowns,
      products,
      openingCash: openingCash.map((o) => ({
        id: o.id,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        currencySymbol: o.currency.symbol,
        amount: Number(o.amount),
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      openingCustomerBalances: openingCustomerBalances.map((o) => ({
        id: o.id,
        customerId: o.customerId,
        customerName: o.customer.name,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        currencySymbol: o.currency.symbol,
        amount: Number(o.amount),
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      openingStocks: openingStocks.map((o) => ({
        id: o.id,
        godownId: o.godownId,
        godownName: o.godown.name,
        productId: o.productId,
        productName: o.product.name,
        qty: Number(o.qty),
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      liabilityOptions: {
        currencies: liabilityCurrencies,
        suppliers,
        shippingLines,
        agents,
        intermediaries,
      },
      openingLiabilities: openingLiabilities.map((o) => ({
        id: o.id,
        liabilityType: o.liabilityType,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        amount: Number(o.amount),
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
        partyId: o.supplierId || o.shippingLineId || o.agentId || o.intermediaryId,
        partyName: o.supplier?.name || o.shippingLine?.name || o.agent?.name || o.intermediary?.name || "-",
      })),
    });
  } catch (error) {
    console.error("List openings error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  let body: any = null;
  let kind = "";
  let cityId: number | null = null;
  try {
    if (user.role !== "city_admin" && user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only admins can manage openings", 403);
    }

    body = await request.json();
    kind = String(body?.kind || "");
    cityId = getScopedCityId(user, body?.cityId);

    if (syncMeta && cityId && (kind === "cash" || kind === "customer" || kind === "stock")) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Opening already synced");
      }
    }

    if (kind === "cash") {
      if (!cityId) return validationError("City is required");
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const existing = await prisma.openingCash.findFirst({ where: { cityId, currencyId } });
      const row = existing
        ? await prisma.openingCash.update({
            where: { id: existing.id },
            data: { amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          })
        : await prisma.openingCash.create({
            data: { cityId, currencyId, amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          });

      await createAuditLog(user.userId, cityId, "opening_cashes", row.id, "update", undefined, { amount }, getClientIP(request));
      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_cashes",
            entityId: row.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: row.id }, "Opening cash saved");
    }

    if (kind === "customer") {
      if (!cityId) return validationError("City is required");
      const customerId = Number(body.customerId);
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(customerId) || customerId <= 0) return validationError("Customer is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const customer = await prisma.customer.findFirst({ where: { id: customerId, cityId } });
      if (!customer) return errorResponse("NOT_FOUND", "Customer not found in selected city");
      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const existing = await prisma.openingCustomerBalance.findFirst({ where: { customerId, currencyId } });
      const row = existing
        ? await prisma.openingCustomerBalance.update({
            where: { id: existing.id },
            data: { amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          })
        : await prisma.openingCustomerBalance.create({
            data: { customerId, currencyId, amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          });

      await createAuditLog(user.userId, cityId, "opening_customer_balances", row.id, "update", undefined, { amount }, getClientIP(request));
      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_customer_balances",
            entityId: row.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: row.id }, "Opening customer balance saved");
    }

    if (kind === "stock") {
      if (!cityId) return validationError("City is required");
      const godownId = Number(body.godownId);
      const productId = Number(body.productId);
      const qty = Number(body.qty);
      if (!Number.isInteger(godownId) || godownId <= 0) return validationError("Godown is required");
      if (!Number.isInteger(productId) || productId <= 0) return validationError("Product is required");
      if (!Number.isFinite(qty)) return validationError("Quantity is required");

      const godown = await prisma.godown.findFirst({ where: { id: godownId, cityId } });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in selected city");
      const product = await prisma.product.findFirst({ where: { id: productId, isActive: true } });
      if (!product) return errorResponse("NOT_FOUND", "Product not found");

      const existing = await prisma.openingStock.findFirst({ where: { godownId, productId } });
      const row = existing
        ? await prisma.openingStock.update({
            where: { id: existing.id },
            data: { cityId, qty, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          })
        : await prisma.openingStock.create({
            data: { cityId, godownId, productId, qty, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          });

      await createAuditLog(user.userId, cityId, "opening_stocks", row.id, "update", undefined, { qty }, getClientIP(request));
      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_stocks",
            entityId: row.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: row.id }, "Opening stock saved");
    }

    if (kind === "liability") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can manage opening liabilities", 403);

      const liabilityType = String(body.liabilityType || "") as OpeningLiabilityType;
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      const partyId = Number(body.partyId);

      if (!["supplier", "shipping_line", "agent", "intermediary"].includes(liabilityType)) return validationError("Invalid liability type");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");
      if (!Number.isInteger(partyId) || partyId <= 0) return validationError("Liability party is required");

      const currency = await prisma.currency.findFirst({ where: { id: currencyId } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");

      const partyField =
        liabilityType === "supplier" ? "supplierId" :
        liabilityType === "shipping_line" ? "shippingLineId" :
        liabilityType === "agent" ? "agentId" : "intermediaryId";

      if (liabilityType === "supplier") {
        const party = await prisma.supplier.findFirst({ where: { id: partyId, isActive: true } });
        if (!party) return errorResponse("NOT_FOUND", "Supplier not found");
      } else if (liabilityType === "shipping_line") {
        const party = await prisma.shippingLine.findFirst({ where: { id: partyId, isActive: true } });
        if (!party) return errorResponse("NOT_FOUND", "Shipping line not found");
      } else if (liabilityType === "agent") {
        const party = await prisma.agent.findFirst({ where: { id: partyId, isActive: true } });
        if (!party) return errorResponse("NOT_FOUND", "Agent not found");
      } else {
        const party = await prisma.intermediary.findFirst({ where: { id: partyId, isActive: true } });
        if (!party) return errorResponse("NOT_FOUND", "Intermediary not found");
      }

      const where: any = { currencyId, [partyField]: partyId };
      const existing = await prisma.openingLiability.findFirst({ where });

      if (syncMeta) {
        const existingSync = await prisma.syncRequest.findUnique({
          where: {
            unique_sync_request_per_city_module: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: OPENING_LIABILITY_SYNC_MODULE,
              requestId: syncMeta.requestId,
            },
          },
        });
        if (existingSync?.entityId) {
          return successResponse({ id: existingSync.entityId }, "Opening liability already synced");
        }
      }

      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingLiability.update({
              where: { id: existing.id },
              data: { liabilityType, amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingLiability.create({
              data: {
                liabilityType,
                currencyId,
                amount,
                openingDate: dateOnly(body.openingDate),
                notes: body.notes || null,
                createdBy: user.userId,
                supplierId: liabilityType === "supplier" ? partyId : null,
                shippingLineId: liabilityType === "shipping_line" ? partyId : null,
                agentId: liabilityType === "agent" ? partyId : null,
                intermediaryId: liabilityType === "intermediary" ? partyId : null,
              },
            });

        await reverseJournalEntries(`OPENLIAB-${saved.id}`, user.userId, tx);
        await journalOpeningLiability({
          id: saved.id,
          liabilityType,
          partyId,
          amount: Number(saved.amount),
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
        }, tx);

        if (syncMeta) {
          await tx.syncRequest.create({
            data: {
              cityId: SUPERADMIN_SYNC_CITY_ID,
              module: OPENING_LIABILITY_SYNC_MODULE,
              requestId: syncMeta.requestId,
              deviceId: syncMeta.deviceId,
              entityType: "opening_liabilities",
              entityId: saved.id,
              createdBy: user.userId,
            },
          });
        }

        return saved;
      });

      await createAuditLog(user.userId, null, "opening_liabilities", row.id, "update", undefined, { liabilityType, amount }, getClientIP(request));
      return successResponse({ id: row.id }, "Opening liability saved");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    if (syncMeta && kind === "liability" && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: OPENING_LIABILITY_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Opening liability already synced");
      }
    }
    if (
      syncMeta &&
      cityId &&
      (kind === "cash" || kind === "customer" || kind === "stock") &&
      isSyncRequestDuplicateError(error)
    ) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Opening already synced");
      }
    }
    console.error("Save opening error:", error);
    return serverError();
  }
});
