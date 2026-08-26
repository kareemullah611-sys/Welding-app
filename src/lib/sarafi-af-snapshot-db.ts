import prisma from "@/lib/prisma";
import {
  normalizeSarafiAfSnapshot,
  resolveAfghanistanFxRate,
  SARAFI_AF_MARKET,
  type NormalizedSarafiAfSnapshot,
  type SarafiAfQuoteInput,
} from "@/lib/sarafi-af-snapshot";

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function currencyCode(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized === "RMB" ? "CNY" : normalized;
}

export async function listSarafiAfFxSnapshots(limit = 30) {
  const rows = await (prisma as any).sarafiAfFxSnapshot.findMany({
    take: Math.min(Math.max(limit, 1), 100),
    orderBy: [{ snapshotDate: "desc" }, { createdAt: "desc" }],
    include: {
      quotes: {
        include: {
          baseCurrency: { select: { code: true } },
          quoteCurrency: { select: { code: true } },
        },
        orderBy: [{ baseCurrencyId: "asc" }],
      },
      derivedRates: {
        include: {
          fromCurrency: { select: { code: true } },
          toCurrency: { select: { code: true } },
        },
        orderBy: [{ fromCurrencyId: "asc" }],
      },
    },
  });

  return rows.map((snapshot: any) => ({
    id: snapshot.id,
    snapshotDate: snapshot.snapshotDate.toISOString().split("T")[0],
    scheduledTime: snapshot.scheduledTime,
    timezone: snapshot.timezone,
    provider: snapshot.provider,
    market: snapshot.market,
    providerMode: snapshot.providerMode,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    sourceTimestamp: snapshot.sourceTimestamp?.toISOString() || null,
    sourceAgeMinutes: snapshot.sourceAgeMinutes,
    status: snapshot.status,
    rawReference: snapshot.rawReference,
    rawPayloadHash: snapshot.rawPayloadHash,
    validationWarnings: snapshot.validationWarningsJson || [],
    quotes: snapshot.quotes.map((quote: any) => ({
      baseCurrencyCode: quote.baseCurrency.code,
      quoteCurrencyCode: quote.quoteCurrency.code,
      rawBuyRate: Number(quote.rawBuyRate),
      rawSellRate: Number(quote.rawSellRate),
      rawUnit: quote.rawUnit,
      normalizationFactor: Number(quote.normalizationFactor),
      normalizedBuyRate: Number(quote.normalizedBuyRate),
      normalizedSellRate: Number(quote.normalizedSellRate),
    })),
    derivedRates: snapshot.derivedRates.map((rate: any) => ({
      fromCurrencyCode: rate.fromCurrency.code,
      toCurrencyCode: rate.toCurrency.code,
      buyRate: Number(rate.buyRate),
      sellRate: Number(rate.sellRate),
      conversionPath: rate.conversionPathJson || [],
      sourceRates: rate.sourceRatesJson || [],
    })),
  }));
}

export async function createSarafiAfFxSnapshot(input: {
  snapshotDate: string;
  fetchedAt?: Date;
  sourceTimestamp?: Date | string | null;
  rawReference?: string | null;
  rawPayload?: unknown;
  quotes: SarafiAfQuoteInput[];
  createdBy?: number | null;
}) {
  const normalized = normalizeSarafiAfSnapshot({
    snapshotDate: input.snapshotDate,
    fetchedAt: input.fetchedAt || new Date(),
    sourceTimestamp: input.sourceTimestamp || null,
    rawReference: input.rawReference || "manual-sarafi-af-snapshot",
    rawPayload: input.rawPayload || input.quotes,
    providerMode: "MANUAL",
    quotes: input.quotes,
  });
  if (normalized.status === "VALIDATION_FAILED") {
    return { ok: false as const, snapshot: normalized };
  }

  return prisma.$transaction(async (tx) => {
    const currencyRows = await tx.currency.findMany({
      where: {
        code: { in: ["AFN", "PKR", "USD", "CNY"] },
      },
      select: { id: true, code: true },
    });
    const currencies = new Map(currencyRows.map((currency) => [currency.code, currency.id]));
    const required = new Set<string>();
    for (const quote of normalized.quotes) {
      required.add(quote.baseCurrencyCode);
      required.add(quote.quoteCurrencyCode);
    }
    for (const rate of normalized.derivedRates) {
      required.add(rate.fromCurrencyCode);
      required.add(rate.toCurrencyCode);
    }
    const missingCurrency = [...required].find((code) => !currencies.has(code));
    if (missingCurrency) throw new Error(`Missing currency ${missingCurrency}`);

    const idempotencyKey = `sarafi-af:${normalized.snapshotDate}:${normalized.provider}:${normalized.market}:${normalized.scheduledTime}`;
    const existing = await (tx as any).sarafiAfFxSnapshot.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return { ok: true as const, snapshot: normalized, id: existing.id, duplicate: true };

    const saved = await (tx as any).sarafiAfFxSnapshot.create({
      data: {
        snapshotDate: dateOnly(normalized.snapshotDate),
        scheduledTime: normalized.scheduledTime,
        timezone: normalized.timezone,
        provider: normalized.provider,
        market: normalized.market,
        providerMode: normalized.providerMode,
        fetchedAt: new Date(normalized.fetchedAt),
        sourceTimestamp: normalized.sourceTimestamp ? new Date(normalized.sourceTimestamp) : null,
        sourceAgeMinutes: normalized.sourceAgeMinutes,
        status: normalized.status,
        rawReference: normalized.rawReference,
        rawPayloadHash: normalized.rawPayloadHash,
        validationWarningsJson: normalized.validationWarnings,
        idempotencyKey,
        createdBy: input.createdBy || null,
        quotes: {
          create: normalized.quotes.map((quote) => ({
            baseCurrencyId: currencies.get(currencyCode(quote.baseCurrencyCode))!,
            quoteCurrencyId: currencies.get(currencyCode(quote.quoteCurrencyCode))!,
            rawBuyRate: quote.rawBuyRate,
            rawSellRate: quote.rawSellRate,
            rawUnit: quote.rawUnit,
            normalizationFactor: quote.normalizationFactor,
            normalizedBuyRate: quote.normalizedBuyRate,
            normalizedSellRate: quote.normalizedSellRate,
          })),
        },
        derivedRates: {
          create: normalized.derivedRates.map((rate) => ({
            fromCurrencyId: currencies.get(currencyCode(rate.fromCurrencyCode))!,
            toCurrencyId: currencies.get("PKR")!,
            buyRate: rate.buyRate,
            sellRate: rate.sellRate,
            conversionPathJson: rate.conversionPath,
            sourceRatesJson: rate.sourceRates,
          })),
        },
      },
      select: { id: true },
    });

    return { ok: true as const, snapshot: normalized, id: saved.id, duplicate: false };
  });
}

export function summarizeSarafiAfSnapshot(snapshot: NormalizedSarafiAfSnapshot) {
  return {
    snapshotDate: snapshot.snapshotDate,
    scheduledTime: snapshot.scheduledTime,
    timezone: snapshot.timezone,
    provider: snapshot.provider,
    market: snapshot.market,
    providerMode: snapshot.providerMode,
    status: snapshot.status,
    validationWarnings: snapshot.validationWarnings,
    derivedRates: snapshot.derivedRates,
  };
}

export async function resolveAfghanistanFxRateFromDb(input: {
  tx?: any;
  currencyCode: string;
  transactionDate: Date;
  purpose: "lot_initial_recognition" | "sale_recognition" | "settlement" | "revaluation";
  positionKind: "asset" | "liability";
  actualDocumentedRate?: { rate: number; reference?: string | null } | null;
}) {
  const db = input.tx || prisma;
  const transactionDate = input.transactionDate.toISOString().split("T")[0];
  const normalizedCurrency = currencyCode(input.currencyCode);
  const [currency, pkr] = await Promise.all([
    db.currency.findUnique({ where: { code: normalizedCurrency } }),
    db.currency.findUnique({ where: { code: "PKR" } }),
  ]);
  if (!currency || !pkr) {
    return resolveAfghanistanFxRate({
      currencyCode: normalizedCurrency,
      transactionDate,
      purpose: input.purpose,
      positionKind: input.positionKind,
      actualDocumentedRate: input.actualDocumentedRate,
      sarafiRates: [],
      manualRates: [],
    });
  }

  const snapshotDate = dateOnly(transactionDate);
  const [sarafiRates, manualRates] = await Promise.all([
    (db as any).sarafiAfFxDerivedRate.findMany({
      where: {
        fromCurrencyId: currency.id,
        toCurrencyId: pkr.id,
        snapshot: {
          snapshotDate: { lte: snapshotDate },
          provider: "SARAFI_AF",
          market: SARAFI_AF_MARKET,
        },
      },
      include: { snapshot: true },
      orderBy: [{ snapshot: { snapshotDate: "desc" } }, { id: "desc" }],
      take: 30,
    }),
    db.exchangeRate.findMany({
      where: {
        fromCurrencyId: currency.id,
        toCurrencyId: pkr.id,
        rateDate: { lte: snapshotDate },
        source: { in: ["manual_open_market", "MANUAL_OPEN_MARKET"] },
      },
      orderBy: [{ rateDate: "desc" }, { id: "desc" }],
      take: 5,
    }),
  ]);

  return resolveAfghanistanFxRate({
    currencyCode: normalizedCurrency,
    transactionDate,
    purpose: input.purpose,
    positionKind: input.positionKind,
    actualDocumentedRate: input.actualDocumentedRate,
    sarafiRates: sarafiRates.map((rate: any) => ({
      snapshotId: rate.snapshotId,
      snapshotDate: rate.snapshot.snapshotDate.toISOString().split("T")[0],
      providerReference: `sarafi_af_fx_derived_rates:${rate.id}`,
      fromCurrencyCode: normalizedCurrency,
      toCurrencyCode: "PKR",
      buyRate: Number(rate.buyRate),
      sellRate: Number(rate.sellRate),
      sourceTimestamp: rate.snapshot.sourceTimestamp?.toISOString() || null,
      fetchedTimestamp: rate.snapshot.fetchedAt?.toISOString() || null,
      conversionPath: rate.conversionPathJson || [],
      status: rate.snapshot.status,
    })),
    manualRates: manualRates.map((rate: any) => ({
      rate: Number(rate.referenceRate),
      effectiveFrom: rate.rateDate.toISOString().split("T")[0],
      providerReference: `exchange_rates:${rate.id}`,
    })),
  });
}
