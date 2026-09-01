import prisma from "@/lib/prisma";
import { lockIntermediaryUsdFifo } from "@/lib/financial-locks";
import type { Prisma, PrismaClient } from "@prisma/client";
import { COUNTRY_CODES } from "@/lib/country-code";

type DbClient = PrismaClient | Prisma.TransactionClient;
type PaymentTarget =
  | { supplierPaymentId: number; shippingLinePaymentId?: never }
  | { supplierPaymentId?: never; shippingLinePaymentId: number };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function getCurrencyByCode(code: string, db: DbClient) {
  return db.currency.findUnique({ where: { code: code.toUpperCase() } });
}

async function resolveCountryIdForCurrencyCode(currencyCode: string, db: DbClient): Promise<number | null> {
  const code = currencyCode.toUpperCase();
  if (code === "PKR") {
    const country = await db.country.findUnique({ where: { code: COUNTRY_CODES.PAKISTAN }, select: { id: true } });
    return country?.id ?? null;
  }
  if (code === "AFN") {
    const country = await db.country.findUnique({ where: { code: COUNTRY_CODES.AFGHANISTAN }, select: { id: true } });
    return country?.id ?? null;
  }

  const cityCurrency = await db.cityCurrency.findFirst({
    where: { currency: { code } },
    select: { city: { select: { countryId: true } } },
    orderBy: { cityId: "asc" },
  });
  return cityCurrency?.city.countryId ?? null;
}

export async function getCountryFallbackRateToPkr(
  input: { countryId: number; fromCurrencyCode: string; asOf?: Date },
  db: DbClient = prisma
): Promise<number | null> {
  const fromCode = input.fromCurrencyCode.toUpperCase();
  if (fromCode === "PKR") return 1;

  const [fromCurrency, pkrCurrency] = await Promise.all([
    getCurrencyByCode(fromCode, db),
    getCurrencyByCode("PKR", db),
  ]);
  if (!fromCurrency || !pkrCurrency) return null;

  const rate = await db.countryFallbackExchangeRate.findFirst({
    where: {
      countryId: input.countryId,
      fromCurrencyId: fromCurrency.id,
      toCurrencyId: pkrCurrency.id,
      isActive: true,
      effectiveFrom: { lte: input.asOf || new Date() },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });

  return rate ? Number(rate.rate) : null;
}

export async function getLotFallbackUsdToPkrRate(
  lotId: number | null | undefined,
  db: DbClient = prisma
): Promise<number | null> {
  if (!lotId) return null;
  const lot = await db.lot.findUnique({
    where: { id: lotId },
    select: { countryId: true, lotDate: true, pkrExchangeRate: true },
  });
  if (!lot) return null;
  const lotRate = Number(lot.pkrExchangeRate || 0);
  if (lotRate > 0) return lotRate;
  return getCountryFallbackRateToPkr({ countryId: lot.countryId, fromCurrencyCode: "USD", asOf: lot.lotDate }, db);
}

export async function assertIntermediaryUsdLayerUnused(
  sourceType: string,
  sourceId: number,
  db: DbClient = prisma
) {
  const layer = await db.intermediaryUsdCostLayer.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    include: { usages: { select: { id: true }, take: 1 } },
  });
  if (layer?.usages.length) {
    throw new Error("This intermediary USD acquisition has already been used in FIFO costing and cannot be edited or deleted.");
  }
}

export async function removeUnusedIntermediaryUsdLayer(
  sourceType: string,
  sourceId: number,
  db: DbClient = prisma
) {
  await assertIntermediaryUsdLayerUnused(sourceType, sourceId, db);
  await db.intermediaryUsdCostLayer.deleteMany({ where: { sourceType, sourceId } });
}

export async function createIntermediaryUsdLayerFromExchange(
  input: {
    exchangeId: number;
    intermediaryId: number;
    exchangeDate: Date;
    fromCurrencyCode: string;
    fromAmount: number;
    toCurrencyCode: string;
    toAmount: number;
  },
  db: DbClient = prisma
) {
  const toCode = input.toCurrencyCode.toUpperCase();
  const fromCode = input.fromCurrencyCode.toUpperCase();
  if (toCode !== "USD") return null;

  const usdCurrency = await getCurrencyByCode("USD", db);
  if (!usdCurrency) throw new Error("USD currency is required before recording intermediary USD FIFO layers.");

  let pkrCost = 0;
  let isFallbackRate = false;
  if (fromCode === "PKR") {
    pkrCost = input.fromAmount;
  } else {
    const countryId = await resolveCountryIdForCurrencyCode(fromCode, db);
    if (!countryId) throw new Error(`Country fallback rate is required for ${fromCode}→PKR USD acquisition costing.`);
    const fallbackRate = await getCountryFallbackRateToPkr(
      { countryId, fromCurrencyCode: fromCode, asOf: input.exchangeDate },
      db
    );
    if (!fallbackRate) throw new Error(`Country fallback rate is required for ${fromCode}→PKR USD acquisition costing.`);
    pkrCost = input.fromAmount * fallbackRate;
    isFallbackRate = true;
  }

  const amountUsd = round2(input.toAmount);
  const costPkr = round2(pkrCost);
  const ratePkr = amountUsd > 0 ? round6(costPkr / amountUsd) : 0;
  if (amountUsd <= 0 || ratePkr <= 0) return null;

  return db.intermediaryUsdCostLayer.create({
    data: {
      intermediaryId: input.intermediaryId,
      currencyId: usdCurrency.id,
      sourceType: "intermediary_exchange",
      sourceId: input.exchangeId,
      acquiredDate: input.exchangeDate,
      originalAmountUsd: amountUsd,
      remainingAmountUsd: amountUsd,
      originalCostPkr: costPkr,
      remainingCostPkr: costPkr,
      ratePkr,
      isFallbackRate,
    },
  });
}

export async function reverseIntermediaryUsdCostUsages(
  target: PaymentTarget,
  db: DbClient = prisma
) {
  const usages = await db.intermediaryUsdCostUsage.findMany({ where: target });
  for (const usage of usages) {
    if (!usage.layerId) continue;
    await db.intermediaryUsdCostLayer.update({
      where: { id: usage.layerId },
      data: {
        remainingAmountUsd: { increment: usage.amountUsd },
        remainingCostPkr: { increment: usage.costPkr },
      },
    });
  }
  await db.intermediaryUsdCostUsage.deleteMany({ where: target });
}

export async function consumeIntermediaryUsdFifo(
  input: {
    intermediaryId: number;
    amountUsd: number;
    paymentDate: Date;
    fallbackCountryId?: number | null;
    fallbackRatePkr?: number | null;
  } & PaymentTarget,
  db: DbClient = prisma
): Promise<{ amountPkr: number; effectiveRatePkr: number; usedFallback: boolean }> {
  let remainingUsd = round2(input.amountUsd);
  if (remainingUsd <= 0) return { amountPkr: 0, effectiveRatePkr: 0, usedFallback: false };

  await lockIntermediaryUsdFifo(db, input.intermediaryId);
  const layers = await db.intermediaryUsdCostLayer.findMany({
    where: { intermediaryId: input.intermediaryId, remainingAmountUsd: { gt: 0 } },
    orderBy: [{ acquiredDate: "asc" }, { id: "asc" }],
  });

  let totalCostPkr = 0;
  let usedFallback = false;

  for (const layer of layers) {
    if (remainingUsd <= 0.001) break;
    const layerRemainingUsd = Number(layer.remainingAmountUsd);
    if (layerRemainingUsd <= 0) continue;

    const useUsd = Math.min(remainingUsd, layerRemainingUsd);
    const consumesWholeLayer = Math.abs(useUsd - layerRemainingUsd) <= 0.001;
    const layerRemainingCost = Number(layer.remainingCostPkr);
    const costPkr = consumesWholeLayer
      ? round2(layerRemainingCost)
      : round2(useUsd * (layerRemainingCost / layerRemainingUsd));
    const ratePkr = useUsd > 0 ? round6(costPkr / useUsd) : 0;

    await db.intermediaryUsdCostLayer.update({
      where: { id: layer.id },
      data: {
        remainingAmountUsd: round2(layerRemainingUsd - useUsd),
        remainingCostPkr: round2(layerRemainingCost - costPkr),
      },
    });
    await db.intermediaryUsdCostUsage.create({
      data: {
        layerId: layer.id,
        intermediaryId: input.intermediaryId,
        supplierPaymentId: "supplierPaymentId" in input ? input.supplierPaymentId : null,
        shippingLinePaymentId: "shippingLinePaymentId" in input ? input.shippingLinePaymentId : null,
        amountUsd: round2(useUsd),
        costPkr,
        ratePkr,
        isFallbackRate: layer.isFallbackRate,
      },
    });

    totalCostPkr += costPkr;
    remainingUsd = round2(remainingUsd - useUsd);
    usedFallback = usedFallback || layer.isFallbackRate;
  }

  if (remainingUsd > 0.001) {
    const fallbackRate = Number(input.fallbackRatePkr || 0) > 0
      ? Number(input.fallbackRatePkr)
      : input.fallbackCountryId
        ? await getCountryFallbackRateToPkr(
            { countryId: input.fallbackCountryId, fromCurrencyCode: "USD", asOf: input.paymentDate },
            db
          )
        : null;
    if (!fallbackRate || fallbackRate <= 0) {
      throw new Error("Intermediary USD FIFO layers are insufficient and no country USD→PKR fallback rate is available.");
    }
    const fallbackCostPkr = round2(remainingUsd * fallbackRate);
    await db.intermediaryUsdCostUsage.create({
      data: {
        layerId: null,
        intermediaryId: input.intermediaryId,
        supplierPaymentId: "supplierPaymentId" in input ? input.supplierPaymentId : null,
        shippingLinePaymentId: "shippingLinePaymentId" in input ? input.shippingLinePaymentId : null,
        amountUsd: remainingUsd,
        costPkr: fallbackCostPkr,
        ratePkr: round6(fallbackRate),
        isFallbackRate: true,
        notes: "Fallback rate used because legacy/intermediary USD balance had no FIFO acquisition layer.",
      },
    });
    totalCostPkr += fallbackCostPkr;
    usedFallback = true;
    remainingUsd = 0;
  }

  const amountPkr = round2(totalCostPkr);
  return {
    amountPkr,
    effectiveRatePkr: input.amountUsd > 0 ? round6(amountPkr / input.amountUsd) : 0,
    usedFallback,
  };
}
