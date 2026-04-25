import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

function dateOnly(value?: string | null): Date {
  if (!value) return new Date();
  return new Date(value);
}

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can access openings", 403);

    const cityId = user.cityId!;
    const [currencies, customers, godowns, products, openingCash, openingCustomerBalances, openingStocks] = await Promise.all([
      prisma.cityCurrency.findMany({
        where: { cityId },
        select: { currency: { select: { id: true, code: true, symbol: true } } },
        orderBy: { currencyId: "asc" },
      }),
      prisma.customer.findMany({
        where: { cityId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.godown.findMany({
        where: { cityId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.openingCash.findMany({
        where: { cityId },
        include: { currency: { select: { code: true, symbol: true } } },
        orderBy: { currencyId: "asc" },
      }),
      prisma.openingCustomerBalance.findMany({
        where: { customer: { cityId } },
        include: {
          customer: { select: { id: true, name: true } },
          currency: { select: { code: true, symbol: true } },
        },
        orderBy: [{ customerId: "asc" }, { currencyId: "asc" }],
      }),
      prisma.openingStock.findMany({
        where: { cityId },
        include: {
          godown: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
        orderBy: [{ godownId: "asc" }, { productId: "asc" }],
      }),
    ]);

    return successResponse({
      currencies: currencies.map((c) => c.currency),
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
    });
  } catch (error) {
    console.error("List openings error:", error);
    return serverError();
  }
});

export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can manage openings", 403);
    const cityId = user.cityId!;
    const body = await request.json();
    const kind = String(body?.kind || "");

    if (kind === "cash") {
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
      return successResponse({ id: row.id }, "Opening cash saved");
    }

    if (kind === "customer") {
      const customerId = Number(body.customerId);
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(customerId) || customerId <= 0) return validationError("Customer is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const customer = await prisma.customer.findFirst({ where: { id: customerId, cityId } });
      if (!customer) return errorResponse("NOT_FOUND", "Customer not found in your city");
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
      return successResponse({ id: row.id }, "Opening customer balance saved");
    }

    if (kind === "stock") {
      const godownId = Number(body.godownId);
      const productId = Number(body.productId);
      const qty = Number(body.qty);
      if (!Number.isInteger(godownId) || godownId <= 0) return validationError("Godown is required");
      if (!Number.isInteger(productId) || productId <= 0) return validationError("Product is required");
      if (!Number.isFinite(qty)) return validationError("Quantity is required");

      const godown = await prisma.godown.findFirst({ where: { id: godownId, cityId } });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in your city");
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
      return successResponse({ id: row.id }, "Opening stock saved");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    console.error("Save opening error:", error);
    return serverError();
  }
});
