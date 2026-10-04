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
import { autoActivateShortSales } from "@/lib/stock-activation";
import { getOpeningEditState } from "@/lib/openings-lock";
import { isSupportedForeignCurrency } from "@/lib/foreign-currency-carrying";
import { assertOpeningFxEvidence } from "@/lib/opening-fx-evidence";
import {
  foreignCurrencyOwnerKey,
  nextForeignCurrencyRecognitionLineKey,
  recordForeignCurrencyRecognition,
  reverseForeignCurrencyRecognition,
} from "@/lib/foreign-currency-carrying-db";

function parseOpeningDate(value: unknown, field = "Opening date"): Date {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new OpeningValidationError(`${field} is required`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new OpeningValidationError(`${field} is invalid`);
  }
  return date;
}

function getScopedCityId(user: JWTPayload, requestedCityId?: unknown): number | null {
  if (user.role === "city_admin") return user.cityId ?? null;
  const cityId = Number(requestedCityId || 0);
  return Number.isInteger(cityId) && cityId > 0 ? cityId : null;
}

const OPENINGS_SYNC_MODULE = "openings";
const OPENING_LIABILITY_SYNC_MODULE = "opening_liabilities";

class OpeningValidationError extends Error {}

async function lockOpeningScope(tx: Prisma.TransactionClient, scope: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`opening:${scope}`}))`;
}

async function ensureCityOpeningPackageEditable(tx: Prisma.TransactionClient, cutoverId: number, cityId: number, createdBy: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening-city-packages"}))`;
  const packageRow = await tx.openingCityPackage.upsert({
    where: { cutoverId_cityId: { cutoverId, cityId } },
    update: {},
    create: { cutoverId, cityId, createdBy },
    select: { status: true },
  });
  if (packageRow.status === "submitted" || packageRow.status === "approved") {
    throw new OpeningValidationError("OPENING_CITY_PACKAGE_LOCKED");
  }
}

async function attachOpeningToDraft(tx: Prisma.TransactionClient, entityType: string, entityId: number, createdBy: number, cityId?: number) {
  const cutover = await tx.openingCutover.findFirst({ where: { status: "draft" }, orderBy: { revision: "desc" }, select: { id: true } });
  if (!cutover) throw new OpeningValidationError("Create a draft opening cutover before entering opening balances");
  if (cityId) await ensureCityOpeningPackageEditable(tx, cutover.id, cityId, createdBy);
  const existing = await tx.openingCutoverEntry.findUnique({ where: { opening_cutover_entry_entity_key: { entityType, entityId } }, select: { cutoverId: true } });
  if (existing && existing.cutoverId !== cutover.id) {
    throw new OpeningValidationError("Opening record belongs to an earlier cutover revision and cannot be reassigned");
  }
  if (!existing) await tx.openingCutoverEntry.create({ data: { cutoverId: cutover.id, entityType, entityId, createdBy } });
}

async function detachOpening(tx: Prisma.TransactionClient, entityType: string, entityId: number, cityId?: number | null, createdBy?: number) {
  if (cityId && createdBy) {
    const cutover = await tx.openingCutover.findFirst({ where: { status: "draft" }, orderBy: { revision: "desc" }, select: { id: true } });
    if (!cutover) throw new OpeningValidationError("Create a draft opening cutover before changing opening balances");
    await ensureCityOpeningPackageEditable(tx, cutover.id, cityId, createdBy);
  }
  await tx.openingCutoverEntry.deleteMany({ where: { entityType, entityId } });
}

async function openingFxData(body: any, currencyCode: string, amount: number) {
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

  // A non-PKR opening becomes the immutable carrying basis for every later
  // settlement, so the rate must be backed by stored evidence. This never
  // substitutes or derives a rate: it only accepts or rejects.
  let evidenceProvider: string | null = null;
  const fxRateDate = currencyCode === "PKR" ? null : parseOpeningDate(body.fxRateDate, "Historical rate date");
  if (currencyCode !== "PKR") {
    try {
      evidenceProvider = await assertOpeningFxEvidence({
        currencyCode,
        rate: carrying.fxRateToPkr,
        rateDate: fxRateDate as Date,
        provider: String(body.fxRateSource || ""),
        reference: body.fxRateReference,
        approval: body.fxRateApproval,
      });
    } catch (error) {
      throw new OpeningValidationError(error instanceof Error ? error.message : "Invalid opening FX evidence");
    }
  }

  return {
    carryingAmountPkr: carrying.carryingAmountPkr,
    fxRateToPkr: carrying.fxRateToPkr,
    fxRateDate,
    fxRateSource: currencyCode === "PKR" ? null : evidenceProvider,
    fxRateMetadata: currencyCode === "PKR" ? Prisma.DbNull : {
      originalCurrency: currencyCode,
      originalAmount: amount,
      rate: carrying.fxRateToPkr,
      rateDate: fxRateDate?.toISOString().slice(0, 10) ?? null,
      source: evidenceProvider,
      reference: body.fxRateReference ? String(body.fxRateReference).trim() : null,
      approvedManualRate: evidenceProvider === "MANUAL_HISTORICAL_REMEDIATION" ? true : null,
    },
  };
}

async function recordOpeningForeignPosition(tx: Prisma.TransactionClient, input: {
  sourceType: string;
  sourceId: number;
  positionKind: Parameters<typeof recordForeignCurrencyRecognition>[1]["positionKind"];
  positionType: Parameters<typeof recordForeignCurrencyRecognition>[1]["positionType"];
  ownerKey: string;
  currencyCode: string;
  amount: number;
  carryingAmountPkr: number;
  fxRateToPkr: number;
  fxRateDate: Date | null;
  fxRateSource: string | null;
  openingDate: Date;
  createdBy: number;
}) {
  if (!isSupportedForeignCurrency(input.currencyCode)) return;
  await reverseForeignCurrencyRecognition(tx, {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    reversalDate: new Date(),
    createdBy: input.createdBy,
  });
  const sourceLineKey = await nextForeignCurrencyRecognitionLineKey(tx, input.sourceType, input.sourceId);
  await recordForeignCurrencyRecognition(tx, {
    positionKind: input.positionKind,
    positionType: input.positionType,
    ownerKey: input.ownerKey,
    currencyCode: input.currencyCode,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceLineKey,
    recognitionDate: input.openingDate,
    historicalPoolDate: input.openingDate,
    foreignAmount: Math.abs(input.amount),
    carryingAmountPkr: Math.abs(input.carryingAmountPkr),
    rate: {
      ratePkr: input.fxRateToPkr,
      rateType: "historical_opening",
      provider: input.fxRateSource || "MANUAL_OPENING",
      reference: input.fxRateDate ? `opening-rate:${input.fxRateDate.toISOString().slice(0, 10)}` : null,
      conversionPath: {
        from: input.currencyCode,
        to: "PKR",
        rateDate: input.fxRateDate?.toISOString().slice(0, 10) || null,
      },
    },
    createdBy: input.createdBy,
  });
}
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    if (user.role !== "city_admin" && user.role !== "super_admin") {
      return errorResponse("FORBIDDEN", "Only admins can access openings", 403);
    }

    const cityId = getScopedCityId(user, request.nextUrl.searchParams.get("city_id"));

    const [cities, currenciesRaw, customers, godowns, products, bankAccounts, openingCash, openingCustomerBalances, openingStocks, legacyStocks, ongoingLots, openingBankBalances, openingCheques, openingHajiBalances, liabilityCurrencies, suppliers, shippingLines, agents, intermediaries, openingLiabilities, cityLiabilityAccounts, openingCityLiabilities] = await Promise.all([
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
            include: { currency: { select: { code: true, symbol: true } }, customer: { select: { id: true, name: true } } },
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
    const legacyValuations = await prisma.openingInventoryValuation.findMany({
      where: { lotId: { in: legacyStocks.map((row) => row.legacyLotId) } },
      select: { id: true, lotId: true, productId: true, unitCostPkr: true, totalValuePkr: true, openingDate: true, notes: true },
    });
    const openingBalanceTotals = openingBalanceAccount
      ? await prisma.journalEntry.aggregate({
          where: { accountId: openingBalanceAccount.id, currencyCode: "PKR" },
          _sum: { debit: true, credit: true },
        })
      : null;
    const openingBalanceClearingPkr = Math.round((Number(openingBalanceTotals?._sum.credit || 0) - Number(openingBalanceTotals?._sum.debit || 0)) * 100) / 100;

    const editState = await getOpeningEditState(user.role);
    return successResponse({
      openingsLocked: editState.openingsLocked,
      canEditOpenings: editState.canEditOpenings,
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
        carryingAmountPkr: Math.abs(Number(o.carryingAmountPkr ?? o.amount)),
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
        amount: Math.abs(Number(o.amount)),
        balanceSide: Number(o.amount) < 0 ? "advance" : "receivable",
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
      legacyStocks: legacyStocks.map((o) => {
        const valuation = legacyValuations.find((row) => row.lotId === o.legacyLotId && row.productId === o.productId);
        return {
        id: o.id,
        godownId: o.godownId,
        godownName: o.godownName,
        productId: o.productId,
        productName: o.productName,
        qty: Number(o.qty),
        openingDate: o.openingDate,
        legacyLotId: o.legacyLotId,
        legacyLotNumber: o.legacyLotNumber,
        unitCostPkr: valuation ? Number(valuation.unitCostPkr) : null,
        totalValuePkr: valuation ? Math.round(Number(o.qty) * Number(valuation.unitCostPkr) * 100) / 100 : null,
        valuationDate: valuation?.openingDate.toISOString().split("T")[0] || null,
        valuationNotes: valuation?.notes || null,
      };
      }),
      ongoingLots: ongoingLots.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        lotDate: l.lotDate.toISOString().split("T")[0],
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
        customerId: o.customerId,
        customerName: o.customer.name,
        chequeStatus: o.chequeStatus,
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

    if (!(await getOpeningEditState(user.role)).canEditOpenings) {
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
      return successResponse(result, "Legacy opening stock removed");
    }

    if (syncMeta && cityId && (kind === "cash" || kind === "customer" || kind === "stock" || kind === "bank" || kind === "cheque")) {
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
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than zero");

      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId: scopedCityId, currencyId }, include: { currency: { select: { code: true } } } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const fxData = await openingFxData(body, cityCurrency.currency.code, amount);

      const existing = await prisma.openingCash.findFirst({ where: { cityId: scopedCityId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `cash:${scopedCityId}:${currencyId}`);
        const current = await tx.openingCash.findFirst({ where: { cityId: scopedCityId, currencyId } });
        const saved = current
          ? await tx.openingCash.update({
              where: { id: current.id },
              data: { amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCash.create({
              data: { cityId: scopedCityId, currencyId, amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            });
        const previousVersions = await reverseOpeningJournals("opening_cash", saved.id, `OPENCASH-${saved.id}`, user.userId, tx);
        await journalOpeningCashBalance({
          id: saved.id, cityId: scopedCityId, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: cityCurrency.currency.code,
          openingDate: saved.openingDate, createdBy: user.userId, journalVersion: previousVersions + 1,
        }, tx);
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_cash", sourceId: saved.id, positionKind: "asset", positionType: "city_cash",
          ownerKey: foreignCurrencyOwnerKey.cityCash(scopedCityId), currencyCode: cityCurrency.currency.code,
          amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        await attachOpeningToDraft(tx, "opening_cash", saved.id, user.userId, scopedCityId);
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
      const amountMagnitude = Number(body.amount);
      const customerBalanceSide = body.balanceSide === "advance" ? "advance" : "receivable";
      const signedAmount = customerBalanceSide === "advance" ? -amountMagnitude : amountMagnitude;
      if (!Number.isInteger(customerId) || customerId <= 0) return validationError("Customer is required");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amountMagnitude) || amountMagnitude <= 0) return validationError("Amount must be greater than zero");

      const customer = await prisma.customer.findFirst({ where: { id: customerId, cityId: scopedCityId } });
      if (!customer) return errorResponse("NOT_FOUND", "Customer not found in selected city");
      const cityCurrency = await prisma.cityCurrency.findFirst({ where: { cityId: scopedCityId, currencyId } });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");

      const existing = await prisma.openingCustomerBalance.findFirst({ where: { customerId, currencyId } });
      const currency = await prisma.currency.findUnique({ where: { id: currencyId }, select: { code: true } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");
      const fxData = await openingFxData(body, currency.code, signedAmount);
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `customer:${customerId}:${currencyId}`);
        const current = await tx.openingCustomerBalance.findFirst({ where: { customerId, currencyId } });
        const saved = current
          ? await tx.openingCustomerBalance.update({
              where: { id: current.id },
              data: { amount: signedAmount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCustomerBalance.create({
              data: { customerId, currencyId, amount: signedAmount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            });
        const previousVersions = await reverseOpeningCustomerBalanceJournals(saved.id, user.userId, tx);
        await journalOpeningCustomerBalance({
          id: saved.id,
          customerId,
          cityId: scopedCityId,
          amount: signedAmount,
          carryingAmountPkr: fxData.carryingAmountPkr,
          fxRateToPkr: fxData.fxRateToPkr,
          currencyCode: currency.code,
          openingDate: saved.openingDate,
          createdBy: user.userId,
          journalVersion: previousVersions + 1,
        }, tx);
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_customer_balance", sourceId: saved.id,
          positionKind: customerBalanceSide === "receivable" ? "asset" : "liability",
          positionType: customerBalanceSide === "receivable" ? "customer_receivable" : "other_payable",
          ownerKey: customerBalanceSide === "receivable" ? foreignCurrencyOwnerKey.customerReceivable(customerId) : foreignCurrencyOwnerKey.customerAdvance(customerId),
          currencyCode: currency.code, amount: signedAmount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        await attachOpeningToDraft(tx, "opening_customer_balance", saved.id, user.userId, scopedCityId);
        return saved;
      });

      await createAuditLog(
        user.userId,
        cityId,
        "opening_customer_balances",
        row.id,
        existing ? "update" : "create",
        existing ? { amount: Number(existing.amount) } : undefined,
        { amount: signedAmount, balanceSide: customerBalanceSide },
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
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than zero");
      const [currency, cityCurrency] = await Promise.all([
        prisma.currency.findUnique({ where: { id: currencyId } }),
        prisma.cityCurrency.findFirst({ where: { cityId: scopedCityId, currencyId } }),
      ]);
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const balanceSide = body.balanceSide === "receivable" ? "receivable" : "payable";
      const fxData = await openingFxData(body, currency.code, amount);
      const existing = await prisma.openingHajiBalance.findFirst({ where: { cityId: scopedCityId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `haji:${scopedCityId}:${currencyId}`);
        const current = await tx.openingHajiBalance.findFirst({ where: { cityId: scopedCityId, currencyId } });
        const saved = current
          ? await tx.openingHajiBalance.update({
              where: { id: current.id },
              data: { amount, balanceSide, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingHajiBalance.create({
              data: {
                cityId: scopedCityId,
                currencyId,
                amount,
                balanceSide,
                ...fxData,
                openingDate: parseOpeningDate(body.openingDate),
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
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_haji_balance", sourceId: saved.id,
          positionKind: balanceSide === "receivable" ? "asset" : "liability",
          positionType: balanceSide === "receivable" ? "other_receivable" : "other_payable",
          ownerKey: foreignCurrencyOwnerKey.haji(scopedCityId), currencyCode: currency.code,
          amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        // Opening Haji is historical bookkeeping only, not a cash-office transfer.
        await tx.hajiTransfer.deleteMany({
          where: {
            cityId: scopedCityId,
            currencyId,
            detail: { startsWith: "Opening Haji balance" },
          },
        });
        await attachOpeningToDraft(tx, "opening_haji_balance", saved.id, user.userId, scopedCityId);
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

    if (kind === "product_inventory") {
      if (!cityId) return validationError("City is required");
      const scopedCityId = cityId;
      const godownId = Number(body.godownId);
      const productId = Number(body.productId);
      const quantity = Number(body.quantity);
      const unitCostPkr = Number(body.unitCostPkr);
      const openingDate = parseOpeningDate(body.openingDate);
      if (!Number.isInteger(godownId) || godownId <= 0) return validationError("Godown is required");
      if (!Number.isInteger(productId) || productId <= 0) return validationError("Product is required");
      if (!Number.isFinite(quantity) || quantity <= 0) return validationError("Opening inventory quantity must be greater than zero");
      if (!Number.isFinite(unitCostPkr) || unitCostPkr <= 0) return validationError("PKR unit cost must be greater than zero");
      const [godown, product] = await Promise.all([
        prisma.godown.findFirst({ where: { id: godownId, cityId: scopedCityId } }),
        prisma.product.findFirst({ where: { id: productId, isActive: true } }),
      ]);
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in selected city");
      if (!product) return errorResponse("NOT_FOUND", "Product not found");

      const result = await prisma.$transaction(async (tx) => {
        const { lotId } = await setLegacyGodownStock({ cityId: scopedCityId, godownId, productId, qty: quantity, createdBy: user.userId }, tx);
        await lockOpeningScope(tx, `inventory:${lotId}:${productId}`);
        const lotProduct = await tx.lotProduct.findUnique({ where: { lotId_productId: { lotId, productId } } });
        const totalQuantity = Number(lotProduct?.totalQty || 0);
        const totalValuePkr = Math.round(totalQuantity * unitCostPkr * 100) / 100;
        const current = await tx.openingInventoryValuation.findUnique({ where: { unique_opening_inventory_lot_product: { lotId, productId } } });
        const nextVersion = (current?.journalVersion || 0) + 1;
        if (current) await reverseOpeningJournals("opening_inventory_valuation", current.id, `OPENINV-${current.id}`, user.userId, tx);
        const valuation = current
          ? await tx.openingInventoryValuation.update({
              where: { id: current.id },
              data: { quantity: totalQuantity, unitCostPkr, totalValuePkr, openingDate, notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId },
            })
          : await tx.openingInventoryValuation.create({
              data: { lotId, productId, quantity: totalQuantity, unitCostPkr, totalValuePkr, openingDate, notes: body.notes || null, journalVersion: 1, createdBy: user.userId },
            });
        await journalOpeningInventoryValuation({ id: valuation.id, lotId, productId, totalValuePkr, openingDate, createdBy: user.userId, journalVersion: valuation.journalVersion }, tx);
        const allocation = await tx.lotCityGodownAllocation.findFirst({ where: { godownId, productId, lotCityDistribution: { lotId } }, select: { id: true } });
        if (!allocation) throw new OpeningValidationError("Opening stock allocation was not created");
        await attachOpeningToDraft(tx, "opening_stock", allocation.id, user.userId, scopedCityId);
        await attachOpeningToDraft(tx, "opening_inventory_valuation", valuation.id, user.userId);
        return { lotId, valuationId: valuation.id, totalQuantity, totalValuePkr };
      });
      await createAuditLog(user.userId, cityId, "opening_inventory_valuations", result.valuationId, "update", undefined, { godownId, productId, quantity, unitCostPkr, totalValuePkr: result.totalValuePkr }, getClientIP(request));
      return successResponse(result, "Opening product inventory saved");
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
      if (!useLegacy && (!Number.isInteger(lotId) || lotId <= 0)) return validationError("Ongoing lot is required");

      const godown = await prisma.godown.findFirst({ where: { id: godownId, cityId } });
      if (!godown) return errorResponse("NOT_FOUND", "Godown not found in selected city");
      const product = await prisma.product.findFirst({ where: { id: productId, isActive: true } });
      if (!product) return errorResponse("NOT_FOUND", "Product not found");

      let resolvedLotId: number;
      try {
        resolvedLotId = await prisma.$transaction(async (tx) => {
          const result = useLegacy
            ? await setLegacyGodownStock({ cityId: Number(cityId), godownId, productId, qty, createdBy: user.userId }, tx)
            : await setLotGodownStock({ lotId: Number(lotId), cityId: Number(cityId), godownId, productId, qty }, tx);
          const allocation = await tx.lotCityGodownAllocation.findFirst({ where: { godownId, productId, lotCityDistribution: { lotId: result.lotId } }, select: { id: true } });
          if (!allocation) throw new OpeningValidationError("Opening stock quantity must be greater than zero");
          await attachOpeningToDraft(tx, "opening_stock", allocation.id, user.userId, Number(cityId));
          return result.lotId;
        });
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
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than zero");

      const bankAccount = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, cityId: scopedCityId, isActive: true } });
      if (!bankAccount) return errorResponse("NOT_FOUND", "Bank account not found in selected city");
      const cityCurrency = await prisma.cityCurrency.findFirst({
        where: { cityId: scopedCityId, currencyId },
        include: { currency: { select: { code: true } } },
      });
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      const fxData = await openingFxData(body, cityCurrency.currency.code, amount);

      const existing = await prisma.openingBankBalance.findFirst({ where: { bankAccountId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `bank:${bankAccountId}:${currencyId}`);
        const current = await tx.openingBankBalance.findFirst({ where: { bankAccountId, currencyId } });
        const saved = current
          ? await tx.openingBankBalance.update({
              where: { id: current.id },
              data: { amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingBankBalance.create({
              data: { cityId: scopedCityId, bankAccountId, currencyId, amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            });
        const previousVersions = await reverseOpeningJournals("opening_bank_balance", saved.id, `OPENBANK-${saved.id}`, user.userId, tx);
        await journalOpeningBankBalance({
          id: saved.id, cityId: scopedCityId, bankAccountId, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: cityCurrency.currency.code,
          openingDate: saved.openingDate, createdBy: user.userId, journalVersion: previousVersions + 1,
        }, tx);
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_bank_balance", sourceId: saved.id, positionKind: "asset", positionType: "city_bank",
          ownerKey: foreignCurrencyOwnerKey.cityBank(bankAccountId), currencyCode: cityCurrency.currency.code,
          amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        await attachOpeningToDraft(tx, "opening_bank_balance", saved.id, user.userId, scopedCityId);
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
      const id = body.id == null ? null : Number(body.id);
      const currencyId = Number(body.currencyId);
      const customerId = Number(body.customerId);
      const amount = Number(body.amount);
      const chequeNumber = String(body.chequeNumber || "").trim();
      if (id !== null && (!Number.isInteger(id) || id <= 0)) return validationError("Opening cheque id is invalid");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isInteger(customerId) || customerId <= 0) return validationError("Customer is required");
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount is required");
      if (!chequeNumber) return validationError("Cheque number is required");

      const [cityCurrency, customer] = await Promise.all([
        prisma.cityCurrency.findFirst({ where: { cityId: scopedCityId, currencyId }, include: { currency: { select: { code: true } } } }),
        prisma.customer.findFirst({ where: { id: customerId, cityId: scopedCityId, isActive: true } }),
      ]);
      if (!cityCurrency) return errorResponse("VALIDATION_ERROR", "Currency not available for this city");
      if (!customer) return errorResponse("VALIDATION_ERROR", "Customer not found in this city");
      const fxData = await openingFxData(body, cityCurrency.currency.code, amount);
      const existing = id === null ? null : await prisma.openingCheque.findFirst({ where: { id, cityId: scopedCityId } });
      if (id !== null && !existing) return errorResponse("NOT_FOUND", "Opening cheque not found", 404);
      if (existing && existing.chequeStatus !== "in_hand") {
        return errorResponse("OPENING_CHEQUE_LOCKED", "Deposited or bounced opening cheques cannot be edited", 409);
      }

      const row = await prisma.$transaction(async (tx) => {
        if (id !== null) await lockOpeningScope(tx, `cheque:${scopedCityId}:${id}`);
        const current = id === null ? null : await tx.openingCheque.findFirst({ where: { id, cityId: scopedCityId } });
        if (id !== null && !current) throw new OpeningValidationError("Opening cheque not found");
        if (current && current.chequeStatus !== "in_hand") throw new OpeningValidationError("OPENING_CHEQUE_LOCKED");
        const previousVersions = current
          ? await reverseOpeningJournals("opening_cheque", current.id, `OPENCHEQUE-${current.id}`, user.userId, tx)
          : 0;
        if (current) {
          await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_cheque", sourceId: current.id, reversalDate: new Date(), createdBy: user.userId });
        }
        const data = {
            cityId: scopedCityId,
            customerId,
            currencyId,
            amount,
            ...fxData,
            chequeNumber,
            chequeBank: body.chequeBank ? String(body.chequeBank).trim() : null,
            chequeDueDate: body.chequeDueDate ? parseOpeningDate(body.chequeDueDate) : null,
            openingDate: parseOpeningDate(body.openingDate),
            notes: body.notes || null,
            createdBy: user.userId,
          };
        const saved = current
          ? await tx.openingCheque.update({ where: { id: current.id }, data })
          : await tx.openingCheque.create({ data });
        await journalOpeningCheque({
          id: saved.id, cityId: scopedCityId, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: cityCurrency.currency.code,
          openingDate: saved.openingDate, createdBy: user.userId, journalVersion: previousVersions + 1,
        }, tx);
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_cheque", sourceId: saved.id, positionKind: "asset", positionType: "other_receivable",
          ownerKey: foreignCurrencyOwnerKey.cityCheque(scopedCityId), currencyCode: cityCurrency.currency.code,
          amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        await attachOpeningToDraft(tx, "opening_cheque", saved.id, user.userId, scopedCityId);
        return saved;
      });

      await createAuditLog(user.userId, cityId, "opening_cheques", row.id, existing ? "update" : "create", existing || undefined, { amount, chequeNumber, customerId, currencyId }, getClientIP(request));
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
      return successResponse({ id: row.id }, existing ? "Opening cheque updated" : "Opening cheque saved");
    }

    if (kind === "liability") {
      if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only superadmin can manage opening liabilities", 403);

      const liabilityType = String(body.liabilityType || "") as OpeningLiabilityType;
      const currencyId = Number(body.currencyId);
      const amount = Number(body.amount);
      const partyId = Number(body.partyId);

      if (!["supplier", "shipping_line", "agent", "intermediary"].includes(liabilityType)) return validationError("Invalid liability type");
      if (!Number.isInteger(currencyId) || currencyId <= 0) return validationError("Currency is required");
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than zero");
      if (!Number.isInteger(partyId) || partyId <= 0) return validationError("Liability party is required");

      const currency = await prisma.currency.findFirst({ where: { id: currencyId } });
      if (!currency) return errorResponse("NOT_FOUND", "Currency not found");
      const balanceSide = body.balanceSide === "receivable" ? "receivable" : "payable";
      const fxData = await openingFxData(body, currency.code, amount);

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
        await lockOpeningScope(tx, `liability:${liabilityType}:${partyId}:${currencyId}`);
        const current = await tx.openingLiability.findFirst({ where });
        const saved = current
          ? await tx.openingLiability.update({
              where: { id: current.id },
              data: { liabilityType, amount, balanceSide, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingLiability.create({
              data: {
                liabilityType,
                currencyId,
                amount,
                balanceSide,
                ...fxData,
                openingDate: parseOpeningDate(body.openingDate),
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
        const openingLiabilityOwner = liabilityType === "supplier"
          ? (balanceSide === "payable" ? foreignCurrencyOwnerKey.supplierPayable(partyId) : foreignCurrencyOwnerKey.supplierAdvance(partyId))
          : liabilityType === "shipping_line"
            ? (balanceSide === "payable" ? foreignCurrencyOwnerKey.shippingPayable(partyId) : foreignCurrencyOwnerKey.shippingAdvance(partyId))
            : liabilityType === "agent"
              ? (balanceSide === "payable" ? foreignCurrencyOwnerKey.agentPayable(partyId) : foreignCurrencyOwnerKey.agentAdvance(partyId))
              : (balanceSide === "payable" ? foreignCurrencyOwnerKey.intermediaryPayable(partyId) : foreignCurrencyOwnerKey.intermediary(partyId));
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_liability", sourceId: saved.id,
          positionKind: balanceSide === "payable" ? "liability" : "asset",
          positionType: liabilityType === "supplier" && balanceSide === "payable"
            ? "supplier_payable"
            : liabilityType === "shipping_line" && balanceSide === "payable"
              ? "shipping_payable"
              : balanceSide === "payable" ? "other_payable" : "other_receivable",
          ownerKey: openingLiabilityOwner, currencyCode: currency.code, amount,
          carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });

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

        await attachOpeningToDraft(tx, "opening_liability", saved.id, user.userId);
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
      const fxData = await openingFxData(body, currency.code, amount);

      const existing = await prisma.openingCityLiability.findFirst({ where: { accountId, currencyId } });
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `city-liability:${accountId}:${currencyId}`);
        const current = await tx.openingCityLiability.findFirst({ where: { accountId, currencyId } });
        const saved = current
          ? await tx.openingCityLiability.update({
              where: { id: current.id },
              data: { amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, createdBy: user.userId },
            })
          : await tx.openingCityLiability.create({
              data: {
                accountId,
                cityId,
                currencyId,
                amount,
                ...fxData,
                openingDate: parseOpeningDate(body.openingDate),
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
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_city_liability", sourceId: saved.id, positionKind: "liability", positionType: "other_payable",
          ownerKey: foreignCurrencyOwnerKey.cityLiability(accountId), currencyCode: currency.code,
          amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        await attachOpeningToDraft(tx, "opening_city_liability", saved.id, user.userId, cityId);
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
      const openingDate = parseOpeningDate(body.openingDate);
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
        const fx = await openingFxData({ ...body, carryingAmountPkr: totalValuePkr }, currency.code, Number(originalAmount));
        fxRateToPkr = fx.fxRateToPkr;
        fxRateDate = fx.fxRateDate;
        fxRateSource = fx.fxRateSource;
        fxRateMetadata = fx.fxRateMetadata;
      }
      const existing = await prisma.openingInventoryValuation.findUnique({ where: { unique_opening_inventory_lot_product: { lotId, productId } } });
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `inventory:${lotId}:${productId}`);
        const current = await tx.openingInventoryValuation.findUnique({ where: { unique_opening_inventory_lot_product: { lotId, productId } } });
        const nextVersion = (current?.journalVersion || 0) + 1;
        if (current) await reverseOpeningJournals("opening_inventory_valuation", current.id, `OPENINV-${current.id}`, user.userId, tx);
        const saved = current
          ? await tx.openingInventoryValuation.update({
              where: { id: current.id },
              data: { quantity, unitCostPkr, totalValuePkr, originalCurrencyId, originalAmount, fxRateToPkr, fxRateDate, fxRateSource, fxRateMetadata, openingDate, notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId },
            })
          : await tx.openingInventoryValuation.create({
              data: { lotId, productId, quantity, unitCostPkr, totalValuePkr, originalCurrencyId, originalAmount, fxRateToPkr, fxRateDate, fxRateSource, fxRateMetadata, openingDate, notes: body.notes || null, journalVersion: 1, createdBy: user.userId },
            });
        await journalOpeningInventoryValuation({ id: saved.id, lotId, productId, totalValuePkr, openingDate, createdBy: user.userId, journalVersion: saved.journalVersion }, tx);
        await attachOpeningToDraft(tx, "opening_inventory_valuation", saved.id, user.userId);
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
      if (!Number.isFinite(amount) || amount <= 0) return validationError("Opening amount must be greater than zero");
      const account = await prisma.superAdminBankAccount.findFirst({ where: { id: accountId, isActive: true }, include: { currency: true } });
      if (!account) return errorResponse("NOT_FOUND", "Superadmin account not found");
      const fxData = await openingFxData(body, account.currency.code, amount);
      const existing = await prisma.openingSuperAdminAccountBalance.findFirst({ where: { accountId } });
      const row = await prisma.$transaction(async (tx) => {
        await lockOpeningScope(tx, `super-admin-account:${accountId}`);
        const current = await tx.openingSuperAdminAccountBalance.findFirst({ where: { accountId } });
        const nextVersion = (current?.journalVersion || 0) + 1;
        if (current) await reverseOpeningJournals("opening_super_admin_account_balance", current.id, `OPENSA-${current.id}`, user.userId, tx);
        const saved = current
          ? await tx.openingSuperAdminAccountBalance.update({ where: { id: current.id }, data: { amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId } })
          : await tx.openingSuperAdminAccountBalance.create({ data: { accountId, currencyId: account.currencyId, amount, ...fxData, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, journalVersion: 1, createdBy: user.userId } });
        await journalOpeningSuperAdminAccountBalance({ id: saved.id, accountId, accountKind: account.accountKind, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr, currencyCode: account.currency.code, openingDate: saved.openingDate, createdBy: user.userId, journalVersion: saved.journalVersion }, tx);
        await recordOpeningForeignPosition(tx, {
          sourceType: "opening_super_admin_account", sourceId: saved.id, positionKind: "asset",
          positionType: account.accountKind === "cash" ? "super_admin_cash" : "super_admin_bank",
          ownerKey: account.accountKind === "cash" ? foreignCurrencyOwnerKey.superAdminCash(accountId) : foreignCurrencyOwnerKey.superAdminBank(accountId),
          currencyCode: account.currency.code, amount, carryingAmountPkr: fxData.carryingAmountPkr, fxRateToPkr: fxData.fxRateToPkr,
          fxRateDate: fxData.fxRateDate, fxRateSource: fxData.fxRateSource, openingDate: saved.openingDate, createdBy: user.userId,
        });
        await attachOpeningToDraft(tx, "opening_super_admin_account_balance", saved.id, user.userId);
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
        await lockOpeningScope(tx, `equity:${equityType}:${label}`);
        const current = await tx.openingEquityAllocation.findUnique({ where: { unique_opening_equity_type_label: { equityType: equityType as any, label } } });
        const nextVersion = (current?.journalVersion || 0) + 1;
        if (current) await reverseOpeningJournals("opening_equity_allocation", current.id, `OPENEQ-${current.id}`, user.userId, tx);
        const saved = current
          ? await tx.openingEquityAllocation.update({ where: { id: current.id }, data: { amountPkr, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, journalVersion: nextVersion, createdBy: user.userId } })
          : await tx.openingEquityAllocation.create({ data: { equityType: equityType as any, label, amountPkr, openingDate: parseOpeningDate(body.openingDate), notes: body.notes || null, journalVersion: 1, createdBy: user.userId } });
        await journalOpeningEquityAllocation({ id: saved.id, equityType: equityType as any, label, amountPkr, openingDate: saved.openingDate, createdBy: user.userId, journalVersion: saved.journalVersion }, tx);
        await attachOpeningToDraft(tx, "opening_equity_allocation", saved.id, user.userId);
        return saved;
      });
      await createAuditLog(user.userId, null, "opening_equity_allocations", row.id, existing ? "update" : "create", existing || undefined, { equityType, label, amountPkr }, getClientIP(request));
      return successResponse({ id: row.id }, "Opening equity allocation saved");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    if (error instanceof OpeningValidationError) {
      if (error.message === "OPENING_CITY_PACKAGE_LOCKED") return errorResponse(error.message, "City opening package is submitted or approved and cannot be changed", 409);
      if (error.message === "OPENING_CHEQUE_LOCKED") return errorResponse(error.message, "Deposited or bounced opening cheques cannot be edited", 409);
      return validationError(error.message);
    }
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
      (kind === "cash" || kind === "customer" || kind === "stock" || kind === "bank" || kind === "cheque") &&
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
    if (!(await getOpeningEditState(user.role)).canEditOpenings) {
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_cash", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_cash", row.id, cityId, user.userId);
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_customer_balance", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_customer_balance", row.id, cityId, user.userId);
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_haji_balance", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await tx.hajiTransfer.deleteMany({
          where: {
            cityId,
            currencyId: row.currencyId,
            detail: { startsWith: "Opening Haji balance" },
          },
        });
        await detachOpening(tx, "opening_haji_balance", row.id, cityId, user.userId);
        await tx.openingHajiBalance.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_haji_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening Haji balance deleted");
    }

    if (kind === "product_inventory") {
      if (!cityId) return validationError("City is required");
      const scopedCityId = cityId;
      const allocation = await prisma.lotCityGodownAllocation.findFirst({
        where: { id, godown: { cityId: scopedCityId }, lotCityDistribution: { lot: { isLegacyStock: true } } },
        select: { id: true, godownId: true, productId: true, lotCityDistribution: { select: { lotId: true } } },
      });
      if (!allocation) return errorResponse("NOT_FOUND", "Opening product inventory row not found");
      await prisma.$transaction(async (tx) => {
        const lotId = allocation.lotCityDistribution.lotId;
        await lockOpeningScope(tx, `inventory:${lotId}:${allocation.productId}`);
        const current = await tx.openingInventoryValuation.findUnique({ where: { unique_opening_inventory_lot_product: { lotId, productId: allocation.productId } } });
        await detachOpening(tx, "opening_stock", allocation.id, cityId, user.userId);
        await setLegacyGodownStock({ cityId: scopedCityId, godownId: allocation.godownId, productId: allocation.productId, qty: 0, createdBy: user.userId }, tx);
        if (!current) return;
        await reverseOpeningJournals("opening_inventory_valuation", current.id, `OPENINV-${current.id}`, user.userId, tx);
        const lotProduct = await tx.lotProduct.findUnique({ where: { lotId_productId: { lotId, productId: allocation.productId } } });
        const remainingQuantity = Number(lotProduct?.totalQty || 0);
        if (remainingQuantity <= 0) {
          await detachOpening(tx, "opening_inventory_valuation", current.id);
          await tx.openingInventoryValuation.delete({ where: { id: current.id } });
          return;
        }
        const totalValuePkr = Math.round(remainingQuantity * Number(current.unitCostPkr) * 100) / 100;
        const valuation = await tx.openingInventoryValuation.update({ where: { id: current.id }, data: { quantity: remainingQuantity, totalValuePkr, journalVersion: current.journalVersion + 1, createdBy: user.userId } });
        await journalOpeningInventoryValuation({ id: valuation.id, lotId, productId: allocation.productId, totalValuePkr, openingDate: valuation.openingDate, createdBy: user.userId, journalVersion: valuation.journalVersion }, tx);
      });
      await createAuditLog(user.userId, scopedCityId, "opening_inventory_valuations", id, "delete", { godownId: allocation.godownId, productId: allocation.productId }, undefined, getClientIP(request));
      return successResponse({ id }, "Opening product inventory deleted");
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
        await prisma.$transaction(async (tx) => {
          await detachOpening(tx, "opening_stock", id, cityId, user.userId);
          await setLotGodownStock({
            lotId: alloc.lotCityDistribution.lotId,
            cityId: alloc.lotCityDistribution.cityId,
            godownId: alloc.godownId,
            productId: alloc.productId,
            qty: 0,
          }, tx);
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
      await prisma.$transaction(async (tx) => {
        await detachOpening(tx, "opening_stock", id, cityId, user.userId);
        await setLegacyGodownStock({
          cityId,
          godownId: legacyAlloc.godownId,
          productId: legacyAlloc.productId,
          qty: 0,
          createdBy: user.userId,
        }, tx);
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_bank_balance", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_bank_balance", row.id, cityId, user.userId);
        await tx.openingBankBalance.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, cityId, "opening_bank_balances", row.id, "delete", { amount: Number(row.amount) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening bank balance deleted");
    }

    if (kind === "cheque") {
      if (!cityId) return validationError("City is required");
      const row = await prisma.openingCheque.findFirst({ where: { id, cityId } });
      if (!row) return errorResponse("NOT_FOUND", "Opening cheque not found");
      if (row.chequeStatus !== "in_hand") return errorResponse("OPENING_CHEQUE_LOCKED", "Deposited or bounced opening cheques cannot be deleted", 409);
      await prisma.$transaction(async (tx) => {
        await reverseOpeningJournals("opening_cheque", row.id, `OPENCHEQUE-${row.id}`, user.userId, tx);
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_cheque", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_cheque", row.id, cityId, user.userId);
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_liability", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_liability", row.id);
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_city_liability", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_city_liability", row.id, cityId, user.userId);
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
        await detachOpening(tx, "opening_inventory_valuation", row.id);
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
        await reverseForeignCurrencyRecognition(tx, { sourceType: "opening_super_admin_account", sourceId: row.id, reversalDate: new Date(), createdBy: user.userId });
        await detachOpening(tx, "opening_super_admin_account_balance", row.id);
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
        await detachOpening(tx, "opening_equity_allocation", row.id);
        await tx.openingEquityAllocation.delete({ where: { id: row.id } });
      });
      await createAuditLog(user.userId, null, "opening_equity_allocations", row.id, "delete", { amountPkr: Number(row.amountPkr) }, undefined, getClientIP(request));
      return successResponse({ id: row.id }, "Opening equity allocation deleted");
    }

    return validationError("Invalid opening kind");
  } catch (error) {
    if (error instanceof OpeningValidationError) {
      if (error.message === "OPENING_CITY_PACKAGE_LOCKED") return errorResponse(error.message, "City opening package is submitted or approved and cannot be changed", 409);
      return validationError(error.message);
    }
    console.error("Delete opening error:", error);
    return serverError();
  }
});
