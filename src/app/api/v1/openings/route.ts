import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { OpeningLiabilityType, Prisma } from "@prisma/client";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import { journalOpeningBankBalance, journalOpeningCashBalance, journalOpeningCheque, journalOpeningCityLiability, journalOpeningCustomerBalance, journalOpeningEquityAllocation, journalOpeningHajiBalance, journalOpeningInventoryValuation, journalOpeningLiability, journalOpeningSuperAdminAccountBalance, resolveOpeningCarryingAmount, reverseOpeningCustomerBalanceJournals, reverseOpeningJournals } from "@/lib/accounting";
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

class OpeningValidationError extends Error {}

function openingFxData(body: any, currencyCode: string, amount: number) {
  if (currencyCode !== "PKR" && (!body.fxRateDate || !String(body.fxRateSource || "").trim())) {
    throw new OpeningValidationError(`Historical ${currencyCode} rate date and source are required.`);
  }
  let carrying: ReturnType<typeof resolveOpeningCarryingAmount>;
  try {
    carrying = resolveOpeningCarryingAmount({
      amount,
      currencyCode,
      carryingAmountPkr: body.carryingAmountPkr == null || body.carryingAmountPkr === "" ? null : Number(body.carryingAmountPkr),
      fxRateToPkr: body.fxRateToPkr == null || body.fxRateToPkr === "" ? null : Number(body.fxRateToPkr),
    });
  } catch (error) {
    throw new OpeningValidationError(error instanceof Error ? error.message : "Invalid opening FX data");
  }
  return {
    carryingAmountPkr: carrying.carryingAmountPkr,
    fxRateToPkr: carrying.fxRateToPkr,
    fxRateDate: currencyCode === "PKR" ? null : dateOnly(body.fxRateDate),
    fxRateSource: currencyCode === "PKR" ? null : String(body.fxRateSource || "").trim(),
    fxRateMetadata: currencyCode === "PKR" ? Prisma.DbNull : {
      originalCurrency: currencyCode,
      originalAmount: amount,
      rate: carrying.fxRateToPkr,
      rateDate: body.fxRateDate,
      source: String(body.fxRateSource || "").trim(),
    },
  };
}
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

    const [superAdminAccounts, openingSuperAdminAccounts, inventoryValuationOptions, openingInventoryValuations, openingEquityAllocations] = user.role === "super_admin"
      ? await Promise.all([
          prisma.superAdminBankAccount.findMany({
            where: { isActive: true },
            include: { currency: { select: { id: true, code: true, symbol: true } } },
            orderBy: [{ accountKind: "asc" }, { bankName: "asc" }],
          }),
          prisma.openingSuperAdminAccountBalance.findMany({
            include: { account: true, currency: true },
            orderBy: [{ openingDate: "asc" }, { id: "asc" }],
          }),
          prisma.lotProduct.findMany({
            include: { lot: { select: { id: true, lotNumber: true, lotDate: true, isLegacyStock: true } }, product: { select: { id: true, name: true } } },
            orderBy: [{ lotId: "asc" }, { productId: "asc" }],
          }),
          prisma.openingInventoryValuation.findMany({
            include: { lot: { select: { lotNumber: true } }, product: { select: { name: true } }, originalCurrency: true },
            orderBy: [{ openingDate: "asc" }, { id: "asc" }],
          }),
          prisma.openingEquityAllocation.findMany({ orderBy: [{ openingDate: "asc" }, { id: "asc" }] }),
        ])
      : [[], [], [], [], []] as any;
    const openingBalanceAccount = user.role === "super_admin"
      ? await prisma.account.findUnique({ where: { code: "3900" }, select: { id: true } })
      : null;
    const openingBalanceTotals = openingBalanceAccount
      ? await prisma.journalEntry.aggregate({
          where: { accountId: openingBalanceAccount.id, currencyCode: "PKR" },
          _sum: { debit: true, credit: true },
        })
      : null;
    const openingBalanceClearingPkr = Math.round((Number(openingBalanceTotals?._sum.credit || 0) - Number(openingBalanceTotals?._sum.debit || 0)) * 100) / 100;

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
      superAdminAccounts: superAdminAccounts.map((account: any) => ({
        id: account.id,
        name: account.bankName,
        accountKind: account.accountKind,
        currencyId: account.currencyId,
        currencyCode: account.currency.code,
      })),
      openingCash: openingCash.map((o) => ({
        id: o.id,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        currencySymbol: o.currency.symbol,
        amount: Number(o.amount),
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
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
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
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
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      openingCheques: openingCheques.map((o) => ({
        id: o.id,
        currencyId: o.currencyId,
        currencyCode: o.currency.code,
        amount: Number(o.amount),
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
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
        balanceSide: o.balanceSide,
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
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
        balanceSide: o.balanceSide,
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
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
        carryingAmountPkr: Number(o.carryingAmountPkr ?? o.amount),
        fxRateToPkr: o.fxRateToPkr ? Number(o.fxRateToPkr) : null,
        fxRateDate: o.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: o.fxRateSource,
        openingDate: o.openingDate.toISOString().split("T")[0],
        notes: o.notes,
      })),
      inventoryValuationOptions: inventoryValuationOptions.map((row: any) => ({
        lotId: row.lotId,
        lotNumber: row.lot.lotNumber,
        lotDate: row.lot.lotDate.toISOString().split("T")[0],
        isLegacyStock: row.lot.isLegacyStock,
        productId: row.productId,
        productName: row.product.name,
        quantity: Number(row.totalQty),
      })),
      openingInventoryValuations: openingInventoryValuations.map((row: any) => ({
        id: row.id,
        lotId: row.lotId,
        lotNumber: row.lot.lotNumber,
        productId: row.productId,
        productName: row.product.name,
        quantity: Number(row.quantity),
        unitCostPkr: Number(row.unitCostPkr),
        totalValuePkr: Number(row.totalValuePkr),
        originalCurrencyId: row.originalCurrencyId,
        originalCurrencyCode: row.originalCurrency?.code || "PKR",
        originalAmount: row.originalAmount ? Number(row.originalAmount) : null,
        fxRateToPkr: row.fxRateToPkr ? Number(row.fxRateToPkr) : null,
        fxRateDate: row.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: row.fxRateSource,
        openingDate: row.openingDate.toISOString().split("T")[0],
        notes: row.notes,
      })),
      openingSuperAdminAccounts: openingSuperAdminAccounts.map((row: any) => ({
        id: row.id,
        accountId: row.accountId,
        accountName: row.account.bankName,
        accountKind: row.account.accountKind,
        currencyId: row.currencyId,
        currencyCode: row.currency.code,
        amount: Number(row.amount),
        carryingAmountPkr: Number(row.carryingAmountPkr),
        fxRateToPkr: row.fxRateToPkr ? Number(row.fxRateToPkr) : null,
        fxRateDate: row.fxRateDate?.toISOString().split("T")[0] || null,
        fxRateSource: row.fxRateSource,
        openingDate: row.openingDate.toISOString().split("T")[0],
        notes: row.notes,
      })),
      openingEquityAllocations: openingEquityAllocations.map((row: any) => ({
        id: row.id,
        equityType: row.equityType,
        label: row.label,
        amountPkr: Number(row.amountPkr),
        openingDate: row.openingDate.toISOString().split("T")[0],
        notes: row.notes,
      })),
      openingEquityReconciliation: {
        clearingAccountCode: "3900",
        unallocatedPkr: openingBalanceClearingPkr,
        reconciled: Math.abs(openingBalanceClearingPkr) < 0.01,
      },
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
      const scopedCityId = cityId;
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const cityCurrency = await prisma.cityCurrency.findFirst({
        where: { cityId: scopedCityId, currencyId },
        include: { currency: { select: { code: true } } },
      });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const fxData = openingFxData(body, cityCurrency.currency.code, amount);

      const existing = await prisma.openingCash.findFirst({ where: { cityId: scopedCityId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingCash.update({
              where: { id: existing.id },
              data: { amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCash.create({
              data: { cityId: scopedCityId, currencyId, amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            });
        const previousVersions = await reverseOpeningJournals("opening_cash", saved.id, `OPENCASH-${saved.id}`, user.userId, tx);
        await journalOpeningCashBalance({
          id: saved.id, cityId: scopedCityId, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: cityCurrency.currency.code,
          openingDate: saved.openingDate, createdBy: user.userId, journalVersion: previousVersions + 1,
        }, tx);
        return saved;
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
      const scopedCityId = cityId;
      const customerId = Number(body.customerId);
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(customerId) || customerId <= 0) return validationError("Customer is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const customer = await prisma.customer.findFirst({ where: { id: customerId, cityId: scopedCityId } });
      if (!customer) return errorResponse("NOT_FOUND", "Customer not found in selected city");
      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId: scopedCityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const existing = await prisma.openingCustomerBalance.findFirst({ where: { customerId, currencyId } });
      const currency = await prisma.currency.findUnique({ where: { id: currencyId }, select: { code: true } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");
      const fxData = openingFxData(body, currency.code, amount);
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingCustomerBalance.update({
              where: { id: existing.id },
              data: { amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCustomerBalance.create({
              data: { customerId, currencyId, amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            });
        const previousVersions = await reverseOpeningCustomerBalanceJournals(saved.id, user.userId, tx);
        await journalOpeningCustomerBalance({
          id: saved.id,
          customerId,
          cityId: scopedCityId,
          amount,
          carryingAmountPkr: fxData.carryingAmountPkr,
          fxRateToPkr: fxData.fxRateToPkr,
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
          journalVersion: previousVersions + 1,
        }, tx);
        return saved;
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
      const balanceSide = body.balanceSide === "receivable" ? "receivable" : "payable";
      const fxData = openingFxData(body, currency.code, amount);
      const existing = await prisma.openingHajiBalance.findFirst({ where: { cityId: scopedCityId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingHajiBalance.update({
              where: { id: existing.id },
              data: { amount, balanceSide, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingHajiBalance.create({
              data: {
                cityId: scopedCityId,
                currencyId,
                amount,
                balanceSide,
                ...fxData,
                openingDate: dateOnly(body.openingDate),
                notes: body.notes || null,
                createdBy: user.userId,
              },
            });
        const previousVersions = await reverseOpeningJournals("opening_haji_balance", saved.id, `OPENHAJI-${saved.id}`, user.userId, tx);
        await journalOpeningHajiBalance({
          id: saved.id,
          cityId: scopedCityId,
          amount: Number(saved.amount),
          balanceSide,
          carryingAmountPkr: fxData.carryingAmountPkr,
          fxRateToPkr: fxData.fxRateToPkr,
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
          journalVersion: previousVersions + 1,
        }, tx);
        // Opening Haji is historical bookkeeping only, not a cash-office transfer.
        await tx.hajiTransfer.deleteMany({
          where: {
            cityId: scopedCityId,
            currencyId,
            detail: { startsWith: "Opening Haji balance" },
          },
        });
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
        lotNumber: (sale as any).lot.lotNumber,
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
      const scopedCityId = cityId;
      const bankAccountId = Number(body.bankAccountId);
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) return validationError("Bank account is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount)) return validationError("Amount is required");

      const bankAccount = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, cityId: scopedCityId, isActive: true } });
      if (!bankAccount) return errorResponse("NOT_FOUND", "Bank account not found in selected city");
      const cityCurrency = await prisma.cityCurrency.findFirst({
        where: { cityId: scopedCityId, currencyId },
        include: { currency: { select: { code: true } } },
      });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const fxData = openingFxData(body, cityCurrency.currency.code, amount);

      const existing = await prisma.openingBankBalance.findFirst({ where: { bankAccountId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingBankBalance.update({
              where: { id: existing.id },
              data: { amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingBankBalance.create({
              data: { cityId: scopedCityId, bankAccountId, currencyId, amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            });
        const previousVersions = await reverseOpeningJournals("opening_bank_balance", saved.id, `OPENBANK-${saved.id}`, user.userId, tx);
        await journalOpeningBankBalance({
          id: saved.id, cityId: scopedCityId, bankAccountId, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: cityCurrency.currency.code,
          openingDate: saved.openingDate, createdBy: user.userId, journalVersion: previousVersions + 1,
        }, tx);
        return saved;
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
      const scopedCityId = cityId;
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      const chequeNumber = String(body.chequeNumber || "").trim();
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount is required");
      if (!chequeNumber) return validationError("Cheque number is required");

      const cityCurrency = await prisma.cityCurrency.findFirst({
        where: { cityId: scopedCityId, currencyId },
        include: { currency: { select: { code: true } } },
      });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const fxData = openingFxData(body, cityCurrency.currency.code, amount);

      const row = await prisma.$transaction(async (tx) => {
        const saved = await tx.openingCheque.create({
          data: {
            cityId: scopedCityId,
            currencyId,
            amount,
            ...fxData,
            chequeNumber,
            chequeBank: body.chequeBank ? String(body.chequeBank).trim() : null,
            chequeDueDate: body.chequeDueDate ? dateOnly(body.chequeDueDate) : null,
            openingDate: dateOnly(body.openingDate),
            notes: body.notes || null,
            createdBy: user.userId,
          },
        });
        await journalOpeningCheque({
          id: saved.id, cityId: scopedCityId, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: cityCurrency.currency.code,
          openingDate: saved.openingDate, createdBy: user.userId, journalVersion: 1,
        }, tx);
        return saved;
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
      const balanceSide = body.balanceSide === "receivable" ? "receivable" : "payable";
      const fxData = openingFxData(body, currency.code, amount);

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
              data: { liabilityType, amount, balanceSide, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingLiability.create({
              data: {
                liabilityType,
                currencyId,
                amount,
                balanceSide,
                ...fxData,
                openingDate: dateOnly(body.openingDate),
                notes: body.notes || null,
                createdBy: user.userId,
                supplierId: liabilityType === "supplier" ? partyId : null,
                shippingLineId: liabilityType === "shipping_line" ? partyId : null,
                agentId: liabilityType === "agent" ? partyId : null,
                intermediaryId: liabilityType === "intermediary" ? partyId : null,
              },
            });

        const previousVersions = await reverseOpeningJournals("opening_liability", saved.id, `OPENLIAB-${saved.id}`, user.userId, tx);
        await journalOpeningLiability({
          id: saved.id,
          liabilityType,
          partyId,
          amount: Number(saved.amount),
          balanceSide,
          carryingAmountPkr: fxData.carryingAmountPkr,
          fxRateToPkr: fxData.fxRateToPkr,
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
          journalVersion: previousVersions + 1,
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
      const fxData = openingFxData(body, currency.code, amount);

      const existing = await prisma.openingCityLiability.findFirst({ where: { accountId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        const saved = existing
          ? await tx.openingCityLiability.update({
              where: { id: existing.id },
              data: { amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCityLiability.create({
              data: {
                accountId,
                cityId,
                currencyId,
                amount,
                ...fxData,
                openingDate: dateOnly(body.openingDate),
                notes: body.notes || null,
                createdBy: user.userId,
              },
            });

        const previousVersions = await reverseOpeningJournals("opening_city_liability", saved.id, `OPENCITYLIAB-${saved.id}`, user.userId, tx);
        await journalOpeningCityLiability({
          id: saved.id,
          accountId,
          cityId,
          amount: Number(saved.amount),
          carryingAmountPkr: fxData.carryingAmountPkr,
          fxRateToPkr: fxData.fxRateToPkr,
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
          journalVersion: previousVersions + 1,
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

    if (kind === "inventory_value") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can value opening inventory", 403);
      const lotId = Number(body.lotId);
      const productId = Number(body.productId);
      const quantity = Number(body.quantity);
      const unitCostPkr = Number(body.unitCostPkr);
      const totalValuePkr = Math.round(quantity * unitCostPkr * 100) / 100;
      const openingDate = dateOnly(body.openingDate);
      if (!Number.isInteger(lotId) || lotId <= 0) return validationError("Lot is required");
      if (!Number.isInteger(productId) || productId <= 0) return validationError("Product is required");
      if (!Number.isFinite(quantity) || quantity <= 0) return validationError("Opening inventory quantity must be greater than zero");
      if (!Number.isFinite(unitCostPkr) || unitCostPkr <= 0) return validationError("PKR unit cost must be greater than zero");
      const lotProduct = await prisma.lotProduct.findUnique({ where: { lotId_productId: { lotId, productId } }, include: { lot: true } });
      if (!lotProduct) return errorResponse("NOT_FOUND", "Lot/product stock record not found");
      if (quantity > Number(lotProduct.totalQty) + 0.0001) return validationError("Valuation quantity cannot exceed the lot/product quantity");
      const existingPurchaseJournal = await prisma.journalEntry.findFirst({
        where: { lotId, entityType: "lot_purchase", transactionId: { startsWith: `PURCH-${lotId}-` } },
        select: { id: true },
      });
      if (existingPurchaseJournal && !lotProduct.lot.isLegacyStock) {
        return validationError("This lot already has purchase-basis accounting; opening valuation would duplicate inventory value");
      }
      const originalCurrencyId = body.originalCurrencyId ? Number(body.originalCurrencyId) : null;
      const originalAmount = body.originalAmount == null || body.originalAmount === "" ? null : Number(body.originalAmount);
      let fxRateToPkr: number | null = null;
      let fxRateDate: Date | null = null;
      let fxRateSource: string | null = null;
      let fxRateMetadata: any = null;
      if (originalCurrencyId) {
        const currency = await prisma.currency.findUnique({ where: { id: originalCurrencyId } });
        if (!currency) return errorResponse("NOT_FOUND", "Original currency not found");
        if (!Number.isFinite(originalAmount) || Number(originalAmount) <= 0) return validationError("Original foreign amount is required");
        const fx = openingFxData({ ...body, carryingAmountPkr: totalValuePkr }, currency.code, Number(originalAmount));
        fxRateToPkr = fx.fxRateToPkr;
        fxRateDate = fx.fxRateDate;
        fxRateSource = fx.fxRateSource;
        fxRateMetadata = fx.fxRateMetadata;
      }
      const existing = await prisma.openingInventoryValuation.findUnique({ where: { unique_opening_inventory_lot_product: { lotId, productId } } });
      const row = await prisma.$transaction(async (tx) => {
        const nextVersion = (existing?.journalVersion || 0) + 1;
        if (existing) await reverseOpeningJournals("opening_inventory_valuation", existing.id, `OPENINV-${existing.id}`, user.userId, tx);
        const saved = existing
          ? await tx.openingInventoryValuation.update({
              where: { id: existing.id },
              data: { quantity, unitCostPkr, totalValuePkr, originalCurrencyId, originalAmount, fxRateToPkr, fxRateDate, fxRateSource, fxRateMetadata, openingDate, notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId },
            })
          : await tx.openingInventoryValuation.create({
              data: { lotId, productId, quantity, unitCostPkr, totalValuePkr, originalCurrencyId, originalAmount, fxRateToPkr, fxRateDate, fxRateSource, fxRateMetadata, openingDate, notes: body.notes || null, journalVersion: 1, createdBy: user.userId },
            });
        await journalOpeningInventoryValuation({ id: saved.id, lotId, productId, totalValuePkr, openingDate, createdBy: user.userId, journalVersion: saved.journalVersion }, tx);
        return saved;
      });
      await createAuditLog(user.userId, null, "opening_inventory_valuations", row.id, existing ? "update" : "create", existing || undefined, { lotId, productId, quantity, unitCostPkr, totalValuePkr }, getClientIP(request));
      return successResponse({ id: row.id }, "Opening inventory valuation saved");
    }

    if (kind === "super_admin_account") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can manage superadmin account openings", 403);
      const accountId = Number(body.accountId);
      const amount = Number(body.amount);
      if (!Number.isInteger(accountId) || accountId <= 0) return validationError("Superadmin cash/bank account is required");
      if (!Number.isFinite(amount) || amount === 0) return validationError("Opening amount must be non-zero");
      const account = await prisma.superAdminBankAccount.findFirst({ where: { id: accountId, isActive: true }, include: { currency: true } });
      if (!account) return errorResponse("NOT_FOUND", "Superadmin account not found");
      const fxData = openingFxData(body, account.currency.code, amount);
      const existing = await prisma.openingSuperAdminAccountBalance.findUnique({ where: { accountId } });
      const row = await prisma.$transaction(async (tx) => {
        const nextVersion = (existing?.journalVersion || 0) + 1;
        if (existing) await reverseOpeningJournals("opening_super_admin_account_balance", existing.id, `OPENSA-${existing.id}`, user.userId, tx);
        const saved = existing
          ? await tx.openingSuperAdminAccountBalance.update({ where: { id: existing.id }, data: { amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId } })
          : await tx.openingSuperAdminAccountBalance.create({ data: { accountId, currencyId: account.currencyId, amount, ...fxData, openingDate: dateOnly(body.openingDate), notes: body.notes || null, journalVersion: 1, createdBy: user.userId } });
        await journalOpeningSuperAdminAccountBalance({ id: saved.id, accountId, accountKind: account.accountKind, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: account.currency.code, openingDate: saved.openingDate, createdBy: user.userId, journalVersion: saved.journalVersion }, tx);
        return saved;
      });
      await createAuditLog(user.userId, null, "opening_super_admin_account_balances", row.id, existing ? "update" : "create", existing || undefined, { accountId, amount, carryingAmountPkr: fxData.carryingAmountPkr }, getClientIP(request));
      return successResponse({ id: row.id }, "Superadmin account opening saved");
    }

    if (kind === "equity") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can manage opening equity", 403);
      const equityType = String(body.equityType || "");
      const label = String(body.label || "").trim();
      const amountPkr = Number(body.amountPkr);
      if (!["manager_capital", "retained_earnings", "other"].includes(equityType)) return validationError("Opening equity type is required");
      if (!label) return validationError("Opening equity label is required");
      if (!Number.isFinite(amountPkr) || amountPkr === 0) return validationError("Opening equity amount must be non-zero");
      const existing = await prisma.openingEquityAllocation.findUnique({ where: { unique_opening_equity_type_label: { equityType: equityType as any, label } } });
      const row = await prisma.$transaction(async (tx) => {
        const nextVersion = (existing?.journalVersion || 0) + 1;
        if (existing) await reverseOpeningJournals("opening_equity_allocation", existing.id, `OPENEQ-${existing.id}`, user.userId, tx);
        const saved = existing
          ? await tx.openingEquityAllocation.update({ where: { id: existing.id }, data: { amountPkr, openingDate: dateOnly(body.openingDate), notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId } })
          : await tx.openingEquityAllocation.create({ data: { equityType: equityType as any, label, amountPkr, openingDate: dateOnly(body.openingDate), notes: body.notes || null, journalVersion: 1, createdBy: user.userId } });
        await journalOpeningEquityAllocation({ id: saved.id, equityType: equityType as any, label, amountPkr, openingDate: saved.openingDate, createdBy: user.userId, journalVersion: saved.journalVersion }, tx);
        return saved;
      });
      await createAuditLog(user.userId, null, "opening_equity_allocations", row.id, existing ? "update" : "create", existing || undefined, { equityType, label, amountPkr }, getClientIP(request));
      return successResponse({ id: row.id }, "Opening equity allocation saved");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    if (error instanceof OpeningValidationError) return validationError(error.message);
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
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_cash", row.id, `OPENCASH-${row.id}`, user.userId, tx);
        await tx.openingCash.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_cashes", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening cash deleted");
    }

    if (kind === "customer") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCustomerBalance.findFirst({
        where: { id, customer: { cityId } },
      });
      if (!row) return errorResponse("NOT_FOUND", "Opening customer balance not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningCustomerBalanceJournals(row.id, user.userId, tx);
        await tx.openingCustomerBalance.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_customer_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening customer balance deleted");
    }

    if (kind === "haji") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingHajiBalance.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening Haji balance not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_haji_balance", row.id, `OPENHAJI-${row.id}`, user.userId, tx);
        await tx.hajiTransfer.deleteMany({
          where: {
            cityId,
            currencyId: row.currencyId,
            detail: { startsWith: "Opening Haji balance" },
          },
        });
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
      const accountingEntry = await prisma.journalEntry.findFirst({
        where: {
          transactionId: {
            in: [`SALE-${id}`, `COGS-${id}`, `OPENING-STOCK-COST-${id}`],
          },
        },
        select: { id: true },
      });
      if (accountingEntry) {
        return errorResponse("VALIDATION_ERROR", "Historical opening sale has accounting entries; use a controlled reversal instead of deletion", 400);
      }
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
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_bank_balance", row.id, `OPENBANK-${row.id}`, user.userId, tx);
        await tx.openingBankBalance.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_bank_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening bank balance deleted");
    }

    if (kind === "cheque") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCheque.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening cheque not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_cheque", row.id, `OPENCHEQUE-${row.id}`, user.userId, tx);
        await tx.openingCheque.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_cheques", row.id, "delete", { amount: Number(row.amount), chequeNumber: row.chequeNumber }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening cheque deleted");
    }

    if (kind === "liability") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can delete opening liabilities", 403);
      const row = await prisma.openingLiability.findFirst({ where: { id } });
      if (!row) return errorResponse("NOT_FOUND", "Opening liability not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_liability", row.id, `OPENLIAB-${row.id}`, user.userId, tx);
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
        await reverseOpeningJournals("opening_city_liability", row.id, `OPENCITYLIAB-${row.id}`, user.userId, tx);
        await tx.openingCityLiability.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_city_liabilities", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening city liability deleted");
    }

    if (kind === "inventory_value") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can delete opening inventory valuations", 403);
      const row = await prisma.openingInventoryValuation.findUnique({ where: { id } });
      if (!row) return errorResponse("NOT_FOUND", "Opening inventory valuation not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_inventory_valuation", row.id, `OPENINV-${row.id}`, user.userId, tx);
        await tx.openingInventoryValuation.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, null, "opening_inventory_valuations", row.id, "delete", { totalValuePkr: Number(row.totalValuePkr) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening inventory valuation deleted");
    }

    if (kind === "super_admin_account") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can delete superadmin account openings", 403);
      const row = await prisma.openingSuperAdminAccountBalance.findUnique({ where: { id } });
      if (!row) return errorResponse("NOT_FOUND", "Superadmin account opening not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_super_admin_account_balance", row.id, `OPENSA-${row.id}`, user.userId, tx);
        await tx.openingSuperAdminAccountBalance.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, null, "opening_super_admin_account_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Superadmin account opening deleted");
    }

    if (kind === "equity") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can delete opening equity", 403);
      const row = await prisma.openingEquityAllocation.findUnique({ where: { id } });
      if (!row) return errorResponse("NOT_FOUND", "Opening equity allocation not found");
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_equity_allocation", row.id, `OPENEQ-${row.id}`, user.userId, tx);
        await tx.openingEquityAllocation.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, null, "opening_equity_allocations", row.id, "delete", { amountPkr: Number(row.amountPkr) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening equity allocation deleted");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    console.error("Delete opening error:", error);
    return serverError();
  }
});
