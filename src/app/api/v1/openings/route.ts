import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { OpeningLiabilityType } from "@prisma/client";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { journalOpeningCityLiability, journalOpeningHajiBalance, journalOpeningLiability, reverseJournalEntries } from "@/lib/accounting";
import { setLegacyGodownStock, listLegacyStockForCity, purgeLegacyOpeningStockData } from "@/lib/legacy-stock-lot";
import { listLotGodownStockForCity, setLotGodownStock } from "@/lib/lot-godown-stock";
import { createHistoricalSale } from "@/lib/historical-sale-import";
import { autoActivateShortSales } from "@/lib/stock-activation";
import { canEditOpenings, isOpeningsLocked } from "@/lib/openings-lock";

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

    const [cities, currenciesRaw, customers, godowns, products, bankAccounts, openingCash, openingCustomerBalances, openingStocks, legacyStocks, ongoingLots, historicalSales, openingBankBalances, openingCheques, openingHajiBalances, liabilityCurrencies, suppliers, shippingLines, agents, intermediaries, openingLiabilities, cityLiabilityAccounts, openingCityLiabilities] = await Promise.all([
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
        ? prisma.bankAccount.findMany({
            where: { cityId, isActive: true },
            select: { id: true, bankName: true, accountNumber: true },
            orderBy: { bankName: "asc" },
          })
        : Promise.resolve([]),
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
        ? listLotGodownStockForCity(cityId)
        : Promise.resolve([]),
      cityId
        ? listLegacyStockForCity(cityId)
        : Promise.resolve([]),
      cityId
        ? prisma.lot.findMany({
            where: {
              status: "ongoing",
              isLegacyStock: false,
              lotCityDistributions: { some: { cityId } },
            },
            select: { id: true, lotNumber: true, lotDate: true },
            orderBy: { lotDate: "asc" },
          })
        : Promise.resolve([]),
      cityId
        ? prisma.sale.findMany({
            where: { cityId, isOpeningImport: true },
            include: {
              customer: { select: { name: true } },
              lot: { select: { lotNumber: true } },
              godown: { select: { name: true } },
              currency: { select: { code: true } },
              items: { include: { product: { select: { name: true, unitOfMeasure: true, piecesPerCarton: true } } } },
            },
            orderBy: [{ saleDate: "desc" }, { id: "desc" }],
            take: 200,
          })
        : Promise.resolve([]),
      cityId
        ? prisma.openingBankBalance.findMany({
            where: { cityId },
            include: {
              bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
              currency: { select: { code: true, symbol: true } },
            },
            orderBy: [{ bankAccountId: "asc" }, { currencyId: "asc" }],
          })
        : Promise.resolve([]),
      cityId
        ? prisma.openingCheque.findMany({
            where: { cityId },
            include: { currency: { select: { code: true, symbol: true } } },
            orderBy: [{ openingDate: "asc" }, { id: "asc" }],
          })
        : Promise.resolve([]),
      cityId
        ? prisma.openingHajiBalance.findMany({
            where: { cityId },
            include: { currency: { select: { code: true, symbol: true } } },
            orderBy: [{ currencyId: "asc" }, { openingDate: "asc" }],
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
      cityId
        ? prisma.cityLiabilityAccount.findMany({
            where: { cityId, isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      cityId
        ? prisma.openingCityLiability.findMany({
            where: { cityId },
            include: {
              account: { select: { id: true, name: true } },
              currency: { select: { id: true, code: true, symbol: true } },
            },
            orderBy: [{ openingDate: "asc" }, { id: "asc" }],
          })
        : Promise.resolve([]),
    ]);

    return successResponse({
      openingsLocked: isOpeningsLocked(),
      canEditOpenings: canEditOpenings(user.role),
      cities,
      selectedCityId: cityId,
      currencies: currenciesRaw.map((c) => c.currency),
      customers,
      godowns,
      products,
      bankAccounts,
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
        lotId: o.lotId,
        lotNumber: o.lotNumber,
        godownId: o.godownId,
        godownName: o.godownName,
        productId: o.productId,
        productName: o.productName,
        qty: Number(o.qty),
        openingDate: o.openingDate,
      })),
      legacyStocks: legacyStocks.map((o) => ({
        id: o.id,
        godownId: o.godownId,
        godownName: o.godownName,
        productId: o.productId,
        productName: o.productName,
        qty: Number(o.qty),
        openingDate: o.openingDate,
        legacyLotId: o.legacyLotId,
        legacyLotNumber: o.legacyLotNumber,
      })),
      ongoingLots: ongoingLots.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        lotDate: l.lotDate.toISOString().split("T")[0],
      })),
      historicalSales: historicalSales.map((s) => ({
        id: s.id,
        voucherNo: s.voucherNo,
        saleDate: s.saleDate.toISOString().split("T")[0],
        customerName: s.customer.name,
        lotNumber: s.lot.lotNumber,
        godownName: s.godown.name,
        currencyCode: s.currency.code,
        totalAmount: Number(s.totalAmount),
        items: s.items.map((i) => ({
          productName: i.product.name,
          qty: i.product.unitOfMeasure === "PCS" && i.product.piecesPerCarton
            ? Number(i.cartonQty ?? Number(i.qty) / Number(i.product.piecesPerCarton))
            : Number(i.qty),
          amount: Number(i.amount),
        })),
      })),
      openingBankBalances: openingBankBalances.map((o) => ({
        id: o.id,
        bankAccountId: o.bankAccountId,
        bankName: o.bankAccount.bankName,
        accountNumber: o.bankAccount.accountNumber,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        amount: Number(o.amount),
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      openingCheques: openingCheques.map((o) => ({
        id: o.id,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        amount: Number(o.amount),
        chequeNumber: o.chequeNumber,
        chequeBank: o.chequeBank,
        chequeDueDate: o.chequeDueDate ? o.chequeDueDate.toISOString().split("T")[0] : null,
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      openingHajiBalances: openingHajiBalances.map((o) => ({
        id: o.id,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        currencySymbol: o.currency.symbol,
        amount: Number(o.amount),
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
      cityLiabilityOptions: {
        accounts: cityLiabilityAccounts,
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
      openingCityLiabilities: openingCityLiabilities.map((o) => ({
        id: o.id,
        accountId: o.accountId,
        accountName: o.account.name,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        currencySymbol: o.currency.symbol,
        amount: Number(o.amount),
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
  const syncMeta = getSyncRequestMeta(request);
  let body: any = null;
  let kind = "";
  let cityId: number | null = null;
  try {
    if (user.role !== "city_admin" && user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only admins can manage openings", 403);
    }

    if (!canEditOpenings(user.role)) {
      return errorResponse("FORBIDDEN", "Opening entries are locked after go-live", 403);
    }

    body = await request.json();
    kind = String(body?.kind || "");
    cityId = getScopedCityId(user, body?.cityId);

    if (kind === "purge_legacy_stock") {
      if (user.role !== "super_admin") {
        return errorResponse("FORBIDDEN", "Only super admin can purge legacy stock data", 403);
      }
      const result = await purgeLegacyOpeningStockData();
      await createAuditLog(
        user.userId,
        null,
        "legacy_stock",
        0,
        "delete",
        undefined,
        result,
        getClientIP(request),
      );
      return successResponse(result, "Legacy stock and historical opening sales removed");
    }

    if (syncMeta && cityId && (kind === "cash" || kind === "customer" || kind === "stock" || kind === "historical_sale" || kind === "bank" || kind === "cheque")) {
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

      await createAuditLog(
        user.userId,
        cityId,
        "opening_cashes",
        row.id,
        existing ? "update" : "create",
        existing ? { amount: Number(existing.amount) } : undefined,
        { amount },
        getClientIP(request),
      );
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

      await createAuditLog(
        user.userId,
        cityId,
        "opening_customer_balances",
        row.id,
        existing ? "update" : "create",
        existing ? { amount: Number(existing.amount) } : undefined,
        { amount },
        getClientIP(request),
      );
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

    if (kind === "haji") {
      if (!cityId) return validationError("City is required");
      const scopedCityId = cityId;
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");
      const [currency, cityCurrency] = await Promise.all([
        prisma.currency.findUnique({ where: { id: currencyId } }),
        prisma.cityCurrency.findFirst({ where: { cityId: scopedCityId, currencyId } }),
      ]);
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const existing = await prisma.openingHajiBalance.findFirst({ where: { cityId: scopedCityId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingHajiBalance.update({
              where: { id: existing.id },
              data: { amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingHajiBalance.create({
              data: {
                cityId: scopedCityId,
                currencyId,
                amount,
                openingDate: dateOnly(body.openingDate),
                notes: body.notes || null,
                createdBy: user.userId,
              },
            });
        await reverseJournalEntries(`OPENHAJI-${saved.id}`, user.userId, tx);
        await journalOpeningHajiBalance({
          id: saved.id,
          cityId: scopedCityId,
          amount: Number(saved.amount),
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
        }, tx);
        return saved;
      });
      await createAuditLog(
        user.userId,
        scopedCityId,
        "opening_haji_balances",
        row.id,
        existing ? "update" : "create",
        existing ? { amount: Number(existing.amount) } : undefined,
        { amount },
        getClientIP(request),
      );
      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId: scopedCityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_haji_balances",
            entityId: row.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: row.id }, "Opening Haji balance saved");
    }

    if (kind === "historical_sale") {
      if (!cityId) return validationError("City is required");
      const lotId = Number(body.lotId);
      const customerId = Number(body.customerId);
      const godownId = Number(body.godownId);
      const productId = Number(body.productId);
      const currencyId = Number(body.currencyId);
      const qty = Number(body.qty);
      const amount = Number(body.amount);
      if (!Number.isInteger(lotId) || lotId <= 0) return validationError("Lot is required");
      if (!Number.isInteger(customerId) || customerId <= 0) return validationError("Customer is required");
      if (!Number.isInteger(godownId) || godownId <= 0) return validationError("Godown is required");
      if (!Number.isInteger(productId) || productId <= 0) return validationError("Product is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(qty) || qty <= 0) return validationError("Quantity is required");
      if (!Number.isFinite(amount) || amount < 0) return validationError("Amount is required");

      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      let sale;
      try {
        sale = await createHistoricalSale({
          cityId,
          customerId,
          lotId,
          godownId,
          productId,
          qty,
          amount,
          currencyId,
          saleDate: dateOnly(body.saleDate),
          notes: body.notes || null,
          skipCustomerLedger: body.skipCustomerLedger !== false,
          createdBy: user.userId,
        });
      } catch (err) {
        return validationError(err instanceof Error ? err.message : "Failed to import historical sale");
      }

      await createAuditLog(user.userId, cityId, "sales", sale.id, "create", undefined, {
        openingImport: true,
        voucherNo: sale.voucherNo,
        lotNumber: sale.lot.lotNumber,
      }, getClientIP(request));

      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "historical_sales",
            entityId: sale.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: sale.id, voucherNo: sale.voucherNo }, "Historical sale imported");
    }

    if (kind === "stock") {
      if (!cityId) return validationError("City is required");
      const lotId = Number(body.lotId);
      const godownId = Number(body.godownId);
      const productId = Number(body.productId);
      const qty = Number(body.qty);
      const useLegacy = body.useLegacy === true;
      if (!Number.isInteger(godownId) || godownId <= 0) return validationError("Godown is required");
      if (!Number.isInteger(productId) || productId <= 0) return validationError("Product is required");
      if (!Number.isFinite(qty)) return validationError("Quantity is required");

      const godown = await prisma.godown.findFirst({ where: { id: godownId, cityId } });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in selected city");
      const product = await prisma.product.findFirst({ where: { id: productId, isActive: true } });
      if (!product) return errorResponse("NOT_FOUND", "Product not found");

      let resolvedLotId: number;
      try {
        if (useLegacy) {
          ({ lotId: resolvedLotId } = await setLegacyGodownStock({
            cityId,
            godownId,
            productId,
            qty,
            createdBy: user.userId,
          }));
        } else {
          if (!Number.isInteger(lotId) || lotId <= 0) return validationError("Ongoing lot is required");
          ({ lotId: resolvedLotId } = await setLotGodownStock({
            lotId,
            cityId,
            godownId,
            productId,
            qty,
          }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save godown stock";
        return validationError(message);
      }

      await createAuditLog(user.userId, cityId, "opening_stocks", resolvedLotId, "create", undefined, {
        godownId,
        productId,
        qty,
        lotId: resolvedLotId,
        useLegacy,
      }, getClientIP(request));

      const activated = await autoActivateShortSales(godownId);

      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_stocks",
            entityId: resolvedLotId,
            createdBy: user.userId,
          },
        });
      }
      return successResponse(
        { lotId: resolvedLotId, salesActivated: activated },
        activated > 0 ? `Godown stock saved — ${activated} short sale(s) activated` : "Godown stock saved"
      );
    }

    if (kind === "bank") {
      if (!cityId) return validationError("City is required");
      const bankAccountId = Number(body.bankAccountId);
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) return validationError("Bank account is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const bankAccount = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, cityId, isActive: true } });
      if (!bankAccount) return errorResponse("NOT_FOUND", "Bank account not found in selected city");
      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const existing = await prisma.openingBankBalance.findFirst({ where: { bankAccountId, currencyId } });
      const row = existing
        ? await prisma.openingBankBalance.update({
            where: { id: existing.id },
            data: { amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          })
        : await prisma.openingBankBalance.create({
            data: { cityId, bankAccountId, currencyId, amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
          });

      await createAuditLog(
        user.userId,
        cityId,
        "opening_bank_balances",
        row.id,
        existing ? "update" : "create",
        existing ? { amount: Number(existing.amount) } : undefined,
        { amount },
        getClientIP(request),
      );
      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_bank_balances",
            entityId: row.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: row.id }, "Opening bank balance saved");
    }

    if (kind === "cheque") {
      if (!cityId) return validationError("City is required");
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      const chequeNumber = String(body.chequeNumber || "").trim();
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount is required");
      if (!chequeNumber) return validationError("Cheque number is required");

      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const row = await prisma.openingCheque.create({
        data: {
          cityId,
          currencyId,
          amount,
          chequeNumber,
          chequeBank: body.chequeBank ? String(body.chequeBank).trim() : null,
          chequeDueDate: body.chequeDueDate ? dateOnly(body.chequeDueDate) : null,
          openingDate: dateOnly(body.openingDate),
          notes: body.notes || null,
          createdBy: user.userId,
        },
      });

      await createAuditLog(user.userId, cityId, "opening_cheques", row.id, "create", undefined, { amount, chequeNumber }, getClientIP(request));
      if (syncMeta) {
        await prisma.syncRequest.create({
          data: {
            cityId,
            module: OPENINGS_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "opening_cheques",
            entityId: row.id,
            createdBy: user.userId,
          },
        });
      }
      return successResponse({ id: row.id }, "Opening cheque saved");
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

      await createAuditLog(
        user.userId,
        null,
        "opening_liabilities",
        row.id,
        existing ? "update" : "create",
        existing ? { liabilityType: existing.liabilityType, amount: Number(existing.amount) } : undefined,
        { liabilityType, amount },
        getClientIP(request),
      );
      return successResponse({ id: row.id }, "Opening liability saved");
    }

    if (kind === "city_liability") {
      if (user.role !== "city_admin") return errorResponse("FORBIDDEN", "Only city admins can manage city opening liabilities", 403);
      const cityId = user.cityId!;
      const accountId = Number(body.accountId);
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(accountId) || accountId <= 0) return validationError("Liability account is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than zero");

      const [account, currency, cityCurrency] = await Promise.all([
        prisma.cityLiabilityAccount.findFirst({ where: { id: accountId, cityId, isActive: true } }),
        prisma.currency.findUnique({ where: { id: currencyId } }),
        prisma.cityCurrency.findFirst({ where: { cityId, currencyId } }),
      ]);
      if (!account) return errorResponse("NOT_FOUND", "Liability account not found");
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const existing = await prisma.openingCityLiability.findFirst({ where: { accountId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingCityLiability.update({
              where: { id: existing.id },
              data: { amount, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCityLiability.create({
              data: {
                accountId,
                cityId,
                currencyId,
                amount,
                openingDate: dateOnly(body.openingDate),
                notes: body.notes || null,
                createdBy: user.userId,
              },
            });

        await reverseJournalEntries(`OPENCITYLIAB-${saved.id}`, user.userId, tx);
        await journalOpeningCityLiability({
          id: saved.id,
          accountId,
          cityId,
          amount: Number(saved.amount),
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
        }, tx);
        return saved;
      });

      await createAuditLog(
        user.userId,
        cityId,
        "opening_city_liabilities",
        row.id,
        existing ? "update" : "create",
        existing ? { accountId: existing.accountId, amount: Number(existing.amount) } : undefined,
        { accountId, amount },
        getClientIP(request),
      );
      return successResponse({ id: row.id }, "Opening city liability saved");
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
      (kind === "cash" || kind === "customer" || kind === "stock" || kind === "historical_sale" || kind === "bank" || kind === "cheque") &&
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

export const DELETE = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" && user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only admins can manage openings", 403);
    }
    if (!canEditOpenings(user.role)) {
      return errorResponse("FORBIDDEN", "Opening entries are locked after go-live", 403);
    }

    const kind = String(request.nextUrl.searchParams.get("kind") || "");
    const id = Number(request.nextUrl.searchParams.get("id") || 0);
    const cityId = getScopedCityId(user, request.nextUrl.searchParams.get("city_id"));

    if (!kind) return validationError("kind is required");
    if (!Number.isInteger(id) || id <= 0) return validationError("id is required");

    if (kind === "cash") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCash.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening cash not found");
      await prisma.openingCash.delete({ where: { id: row.id } });
      await createAuditLog(user.userId, cityId, "opening_cashes", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening cash deleted");
    }

    if (kind === "customer") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCustomerBalance.findFirst({
        where: { id, customer: { cityId } },
      });
      if (!row) return errorResponse("NOT_FOUND", "Opening customer balance not found");
      await prisma.openingCustomerBalance.delete({ where: { id: row.id } });
      await createAuditLog(user.userId, cityId, "opening_customer_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening customer balance deleted");
    }

    if (kind === "haji") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingHajiBalance.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening Haji balance not found");
      await prisma.$transaction(async (tx) => {
        await reverseJournalEntries(`OPENHAJI-${row.id}`, user.userId, tx);
        await tx.openingHajiBalance.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_haji_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening Haji balance deleted");
    }

    if (kind === "historical_sale") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.sale.findFirst({
        where: { id, cityId, isOpeningImport: true },
      });
      if (!row) return errorResponse("NOT_FOUND", "Historical sale not found");
      await prisma.sale.delete({ where: { id: row.id } });
      await createAuditLog(user.userId, cityId, "sales", row.id, "delete", { voucherNo: row.voucherNo }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Historical sale deleted");
    }

    if (kind === "stock") {
      if (!cityId) return validationError("City is required");
      const alloc = await prisma.lotCityGodownAllocation.findFirst({
        where: {
          id,
          godown: { cityId },
          lotCityDistribution: { lot: { status: "ongoing", isLegacyStock: false } },
        },
        select: { godownId: true, productId: true, lotCityDistribution: { select: { lotId: true, cityId: true } } },
      });
      if (alloc) {
        await setLotGodownStock({
          lotId: alloc.lotCityDistribution.lotId,
          cityId: alloc.lotCityDistribution.cityId,
          godownId: alloc.godownId,
          productId: alloc.productId,
          qty: 0,
        });
        await createAuditLog(user.userId, cityId, "opening_stocks", id, "delete", { godownId: alloc.godownId, productId: alloc.productId }, undefined, getClientIP(request));
        return successResponse({ id }, "Godown stock cleared");
      }
      const legacyAlloc = await prisma.lotCityGodownAllocation.findFirst({
        where: {
          id,
          godown: { cityId },
          lotCityDistribution: { lot: { isLegacyStock: true } },
        },
        select: { godownId: true, productId: true },
      });
      if (!legacyAlloc) return errorResponse("NOT_FOUND", "Stock row not found");
      await setLegacyGodownStock({
        cityId,
        godownId: legacyAlloc.godownId,
        productId: legacyAlloc.productId,
        qty: 0,
        createdBy: user.userId,
      });
      await createAuditLog(user.userId, cityId, "opening_stocks", id, "delete", { godownId: legacyAlloc.godownId, productId: legacyAlloc.productId }, undefined, getClientIP(request));
      return successResponse({ id }, "Legacy stock cleared");
    }

    if (kind === "bank") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingBankBalance.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening bank balance not found");
      await prisma.openingBankBalance.delete({ where: { id: row.id } });
      await createAuditLog(user.userId, cityId, "opening_bank_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening bank balance deleted");
    }

    if (kind === "cheque") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCheque.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening cheque not found");
      await prisma.openingCheque.delete({ where: { id: row.id } });
      await createAuditLog(user.userId, cityId, "opening_cheques", row.id, "delete", { amount: Number(row.amount), chequeNumber: row.chequeNumber }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening cheque deleted");
    }

    if (kind === "liability") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can delete opening liabilities", 403);
      const row = await prisma.openingLiability.findFirst({ where: { id } });
      if (!row) return errorResponse("NOT_FOUND", "Opening liability not found");
      await prisma.$transaction(async (tx) => {
        await reverseJournalEntries(`OPENLIAB-${row.id}`, user.userId, tx);
        await tx.openingLiability.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, null, "opening_liabilities", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening liability deleted");
    }

    if (kind === "city_liability") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCityLiability.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening city liability not found");
      await prisma.$transaction(async (tx) => {
        await reverseJournalEntries(`OPENCITYLIAB-${row.id}`, user.userId, tx);
        await tx.openingCityLiability.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_city_liabilities", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening city liability deleted");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    console.error("Delete opening error:", error);
    return serverError();
  }
});
