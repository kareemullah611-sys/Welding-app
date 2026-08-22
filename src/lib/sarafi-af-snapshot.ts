import { createHash } from "node:crypto";

export const SARAFI_AF_AUTO_SNAPSHOT_FLAG = "SARAFI_AF_AUTO_SNAPSHOT_ENABLED";
export const SARAFI_AF_TIMEZONE = "Asia/Kabul";
export const SARAFI_AF_SCHEDULED_TIME = "08:30";
export const SARAFI_AF_MARKET = "sarai_shahzada";

export type SarafiAfSnapshotStatus =
  | "VALID_CURRENT"
  | "STALE_SOURCE_RATE"
  | "FETCH_FAILED"
  | "VALIDATION_FAILED"
  | "MANUAL_FALLBACK";

export type SarafiAfProviderMode =
  | "FOUNDATION_ONLY"
  | "HTML_FETCH"
  | "OFFICIAL_API"
  | "MANUAL";

export type SarafiAfQuoteInput = {
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  rawBuyRate: number;
  rawSellRate: number;
  rawUnit?: string | null;
};

export type NormalizedSarafiAfQuote = {
  baseCurrencyCode: string;
  quoteCurrencyCode: string;
  rawBuyRate: number;
  rawSellRate: number;
  normalizedBuyRate: number;
  normalizedSellRate: number;
  rawUnit: string;
  normalizationFactor: number;
};

export type SarafiAfDerivedRate = {
  fromCurrencyCode: string;
  toCurrencyCode: "PKR";
  buyRate: number;
  sellRate: number;
  conversionPath: string[];
  sourceRates: string[];
};

export type NormalizedSarafiAfSnapshot = {
  snapshotDate: string;
  scheduledTime: string;
  timezone: string;
  provider: "SARAFI_AF";
  market: typeof SARAFI_AF_MARKET;
  providerMode: SarafiAfProviderMode;
  fetchedAt: string;
  sourceTimestamp: string | null;
  sourceAgeMinutes: number | null;
  status: SarafiAfSnapshotStatus;
  rawReference: string | null;
  rawPayloadHash: string | null;
  validationWarnings: string[];
  quotes: NormalizedSarafiAfQuote[];
  derivedRates: SarafiAfDerivedRate[];
};

export type SarafiAfStoredRateSource = {
  snapshotId?: number;
  snapshotDate: string;
  providerReference: string;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  buyRate: number;
  sellRate: number;
  sourceTimestamp: string | null;
  fetchedTimestamp: string | null;
  conversionPath: string[];
  status: SarafiAfSnapshotStatus;
};

export type AfghanistanFxPurpose = "sale_recognition" | "settlement" | "revaluation";

type ResolvedAfghanistanFxRate = {
  ok: true;
  provider: "ACTUAL_DOCUMENTED_TRANSACTION_RATE" | "SARAFI_AF" | "MANUAL_OPEN_MARKET";
  market: string;
  fromCurrencyCode: string;
  toCurrencyCode: "PKR";
  rate: number;
  selectedRateType: "buy" | "sell" | "reference";
  purpose: AfghanistanFxPurpose;
  positionKind: "asset" | "liability";
  providerReference: string | null;
  snapshotId?: number | null;
  sourceTimestamp: string | null;
  fetchedTimestamp: string | null;
  conversionPath: string[];
} | {
  ok: false;
  provider: "SARAFI_AF" | "MANUAL_OPEN_MARKET" | null;
  market: string | null;
  fromCurrencyCode: string;
  toCurrencyCode: "PKR";
  purpose: AfghanistanFxPurpose;
  positionKind: "asset" | "liability";
  missingReason: string;
  conversionPath: string[];
};

function round6(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function dateOnlyInKabul(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SARAFI_AF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function normalizeCurrencyCode(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized === "RMB" ? "CNY" : normalized;
}

function normalizationFactor(rawUnit?: string | null) {
  const normalized = String(rawUnit || "1").trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "1K" || normalized === "1000" || normalized === "PKR1K") return 1000;
  return 1;
}

function assertPositiveRate(value: number, label: string, warnings: string[]) {
  if (!Number.isFinite(value) || value <= 0) warnings.push(`${label} must be greater than zero.`);
}

export function isSarafiAfAutoSnapshotEnabled(env: Record<string, string | undefined> = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env[SARAFI_AF_AUTO_SNAPSHOT_FLAG] || "").trim().toLowerCase());
}

export function buildSarafiAfScheduledSnapshotDate(now = new Date()) {
  return {
    snapshotDate: dateOnlyInKabul(now),
    scheduledTime: SARAFI_AF_SCHEDULED_TIME,
    timezone: SARAFI_AF_TIMEZONE,
  };
}

export function normalizeSarafiAfSnapshot(input: {
  snapshotDate: string;
  fetchedAt: Date;
  sourceTimestamp?: Date | string | null;
  rawReference?: string | null;
  rawPayload?: unknown;
  providerMode?: SarafiAfProviderMode;
  maxSourceAgeMinutes?: number;
  abnormalChangeThresholdPercent?: number;
  previousDerivedRates?: Array<{
    fromCurrencyCode: string;
    buyRate: number;
    sellRate: number;
  }>;
  quotes: SarafiAfQuoteInput[];
}): NormalizedSarafiAfSnapshot {
  const warnings: string[] = [];
  const maxSourceAgeMinutes = input.maxSourceAgeMinutes ?? 120;
  const sourceTimestamp = input.sourceTimestamp ? new Date(input.sourceTimestamp) : null;
  const sourceAgeMinutes = sourceTimestamp
    ? Math.max(0, Math.round((input.fetchedAt.getTime() - sourceTimestamp.getTime()) / 60000))
    : null;

  const quotes = input.quotes.map((quote) => {
    const factor = normalizationFactor(quote.rawUnit);
    const rawUnit = String(quote.rawUnit || "1").trim() || "1";
    const normalized: NormalizedSarafiAfQuote = {
      baseCurrencyCode: normalizeCurrencyCode(quote.baseCurrencyCode),
      quoteCurrencyCode: normalizeCurrencyCode(quote.quoteCurrencyCode),
      rawBuyRate: Number(quote.rawBuyRate),
      rawSellRate: Number(quote.rawSellRate),
      normalizedBuyRate: roundRate(Number(quote.rawBuyRate) / factor),
      normalizedSellRate: roundRate(Number(quote.rawSellRate) / factor),
      rawUnit,
      normalizationFactor: factor,
    };
    assertPositiveRate(normalized.normalizedBuyRate, `${normalized.baseCurrencyCode}/${normalized.quoteCurrencyCode} buy`, warnings);
    assertPositiveRate(normalized.normalizedSellRate, `${normalized.baseCurrencyCode}/${normalized.quoteCurrencyCode} sell`, warnings);
    return normalized;
  });

  const quoteByPair = new Map(quotes.map((quote) => [`${quote.baseCurrencyCode}/${quote.quoteCurrencyCode}`, quote]));
  const pkrAfn = quoteByPair.get("PKR/AFN");
  const usdAfn = quoteByPair.get("USD/AFN");
  const cnyAfn = quoteByPair.get("CNY/AFN");
  if (!pkrAfn) warnings.push("PKR/AFN quote is required.");
  if (!usdAfn) warnings.push("USD/AFN quote is required.");
  if (!cnyAfn) warnings.push("CNY/AFN quote is required.");

  const derivedRates: SarafiAfDerivedRate[] = [];
  if (pkrAfn) {
    const afnPkrBuy = round6(1 / pkrAfn.normalizedSellRate);
    const afnPkrSell = round6(1 / pkrAfn.normalizedBuyRate);
    derivedRates.push({
      fromCurrencyCode: "AFN",
      toCurrencyCode: "PKR",
      buyRate: afnPkrBuy,
      sellRate: afnPkrSell,
      conversionPath: ["AFN→PKR"],
      sourceRates: ["PKR/AFN"],
    });
    if (usdAfn) {
      derivedRates.push({
        fromCurrencyCode: "USD",
        toCurrencyCode: "PKR",
        buyRate: round6(usdAfn.normalizedBuyRate * afnPkrBuy),
        sellRate: round6(usdAfn.normalizedSellRate * afnPkrSell),
        conversionPath: ["USD→AFN", "AFN→PKR"],
        sourceRates: ["USD/AFN", "PKR/AFN"],
      });
    }
    if (cnyAfn) {
      derivedRates.push({
        fromCurrencyCode: "CNY",
        toCurrencyCode: "PKR",
        buyRate: round6(cnyAfn.normalizedBuyRate * afnPkrBuy),
        sellRate: round6(cnyAfn.normalizedSellRate * afnPkrSell),
        conversionPath: ["CNY→AFN", "AFN→PKR"],
        sourceRates: ["CNY/AFN", "PKR/AFN"],
      });
    }
  }

  for (const rate of derivedRates) {
    assertPositiveRate(rate.buyRate, `${rate.fromCurrencyCode}→PKR buy`, warnings);
    assertPositiveRate(rate.sellRate, `${rate.fromCurrencyCode}→PKR sell`, warnings);
    const previous = input.previousDerivedRates?.find((row) => normalizeCurrencyCode(row.fromCurrencyCode) === rate.fromCurrencyCode);
    const threshold = input.abnormalChangeThresholdPercent;
    if (previous && threshold && threshold > 0) {
      const buyChange = Math.abs((rate.buyRate - previous.buyRate) / previous.buyRate) * 100;
      const sellChange = Math.abs((rate.sellRate - previous.sellRate) / previous.sellRate) * 100;
      if (buyChange > threshold || sellChange > threshold) {
        warnings.push(`${rate.fromCurrencyCode}→PKR changed more than ${threshold}% from previous valid snapshot.`);
      }
    }
  }

  const isStale = sourceAgeMinutes != null && sourceAgeMinutes > maxSourceAgeMinutes;
  const status: SarafiAfSnapshotStatus = warnings.length > 0
    ? "VALIDATION_FAILED"
    : isStale
      ? "STALE_SOURCE_RATE"
      : "VALID_CURRENT";

  return {
    snapshotDate: input.snapshotDate,
    scheduledTime: SARAFI_AF_SCHEDULED_TIME,
    timezone: SARAFI_AF_TIMEZONE,
    provider: "SARAFI_AF",
    market: SARAFI_AF_MARKET,
    providerMode: input.providerMode || "HTML_FETCH",
    fetchedAt: input.fetchedAt.toISOString(),
    sourceTimestamp: sourceTimestamp ? sourceTimestamp.toISOString() : null,
    sourceAgeMinutes,
    status,
    rawReference: input.rawReference || null,
    rawPayloadHash: input.rawPayload == null
      ? null
      : createHash("sha256").update(JSON.stringify(input.rawPayload)).digest("hex"),
    validationWarnings: warnings,
    quotes,
    derivedRates,
  };
}

export function resolveAfghanistanFxRate(input: {
  currencyCode: string;
  transactionDate: string;
  purpose: AfghanistanFxPurpose;
  positionKind: "asset" | "liability";
  actualDocumentedRate?: { rate: number; reference?: string | null } | null;
  sarafiRates: SarafiAfStoredRateSource[];
  manualRates: Array<{ rate: number; effectiveFrom: string; providerReference?: string | null }>;
}): ResolvedAfghanistanFxRate {
  const fromCurrencyCode = normalizeCurrencyCode(input.currencyCode);
  const selectedRateType = input.positionKind === "asset" ? "buy" : "sell";
  if (fromCurrencyCode === "PKR") {
    return {
      ok: true,
      provider: "ACTUAL_DOCUMENTED_TRANSACTION_RATE",
      market: "pkr",
      fromCurrencyCode: "PKR",
      toCurrencyCode: "PKR",
      rate: 1,
      selectedRateType: "reference",
      purpose: input.purpose,
      positionKind: input.positionKind,
      providerReference: "PKR",
      sourceTimestamp: null,
      fetchedTimestamp: null,
      conversionPath: ["PKR→PKR"],
    };
  }
  if (input.actualDocumentedRate?.rate && input.actualDocumentedRate.rate > 0) {
    return {
      ok: true,
      provider: "ACTUAL_DOCUMENTED_TRANSACTION_RATE",
      market: "documented_transaction",
      fromCurrencyCode,
      toCurrencyCode: "PKR",
      rate: round6(input.actualDocumentedRate.rate),
      selectedRateType: "reference",
      purpose: input.purpose,
      positionKind: input.positionKind,
      providerReference: input.actualDocumentedRate.reference || null,
      sourceTimestamp: null,
      fetchedTimestamp: null,
      conversionPath: [`${fromCurrencyCode}→PKR`],
    };
  }

  const sarafi = input.sarafiRates.find((rate) =>
    rate.snapshotDate === input.transactionDate &&
    normalizeCurrencyCode(rate.fromCurrencyCode) === fromCurrencyCode &&
    normalizeCurrencyCode(rate.toCurrencyCode) === "PKR"
  );
  if (sarafi) {
    if (sarafi.status !== "VALID_CURRENT") {
      return {
        ok: false,
        provider: "SARAFI_AF",
        market: SARAFI_AF_MARKET,
        fromCurrencyCode,
        toCurrencyCode: "PKR",
        purpose: input.purpose,
        positionKind: input.positionKind,
        missingReason: `Sarafi.af snapshot for ${input.transactionDate} is ${sarafi.status.toLowerCase().replace(/_/g, " ")}.`,
        conversionPath: sarafi.conversionPath,
      };
    }
    const rate = selectedRateType === "buy" ? sarafi.buyRate : sarafi.sellRate;
    if (rate > 0) {
      return {
        ok: true,
        provider: "SARAFI_AF",
        market: SARAFI_AF_MARKET,
        fromCurrencyCode,
        toCurrencyCode: "PKR",
        rate: round6(rate),
        selectedRateType,
        purpose: input.purpose,
        positionKind: input.positionKind,
        providerReference: sarafi.providerReference,
        snapshotId: sarafi.snapshotId || null,
        sourceTimestamp: sarafi.sourceTimestamp,
        fetchedTimestamp: sarafi.fetchedTimestamp,
        conversionPath: sarafi.conversionPath,
      };
    }
  }

  const manual = input.manualRates
    .filter((rate) => rate.effectiveFrom <= input.transactionDate && rate.rate > 0)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  if (manual) {
    return {
      ok: true,
      provider: "MANUAL_OPEN_MARKET",
      market: "manual_open_market",
      fromCurrencyCode,
      toCurrencyCode: "PKR",
      rate: round6(manual.rate),
      selectedRateType: "reference",
      purpose: input.purpose,
      positionKind: input.positionKind,
      providerReference: manual.providerReference || null,
      sourceTimestamp: null,
      fetchedTimestamp: null,
      conversionPath: [`${fromCurrencyCode}→PKR`],
    };
  }

  return {
    ok: false,
    provider: null,
    market: null,
    fromCurrencyCode,
    toCurrencyCode: "PKR",
    purpose: input.purpose,
    positionKind: input.positionKind,
    missingReason: `Missing ${fromCurrencyCode}→PKR ${input.purpose} rate for Afghanistan on ${input.transactionDate}. Tried actual documented transaction rate, SARAFI_AF daily snapshot, then MANUAL_OPEN_MARKET.`,
    conversionPath: fromCurrencyCode === "AFN" ? ["AFN→PKR"] : [`${fromCurrencyCode}→AFN`, "AFN→PKR"],
  };
}
