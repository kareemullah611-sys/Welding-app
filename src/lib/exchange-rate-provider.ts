export type ExchangeRateProviderCode = "MANUAL_OPEN_MARKET" | "SARAFI_AF" | "FUTURE_PROVIDER";

export type MonetaryPositionKind = "asset" | "liability";

export type ExchangeRateSourceRate = {
  provider: ExchangeRateProviderCode;
  market: string;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  buyRate: number | null;
  sellRate: number | null;
  referenceRate: number | null;
  sourceTimestamp: string | null;
  fetchedTimestamp: string | null;
  providerReference: string | null;
  entryMethod: "manual" | "api";
};

export type NormalizedExchangeRateResult = {
  ok: true;
  provider: ExchangeRateProviderCode;
  market: string;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  rate: number;
  selectedRateType: "buy" | "sell" | "reference";
  positionKind: MonetaryPositionKind;
  sourceTimestamp: string | null;
  fetchedTimestamp: string | null;
  providerReference: string | null;
  entryMethod: "manual" | "api";
  conversionPath: string[];
  sourceRates: ExchangeRateSourceRate[];
} | {
  ok: false;
  provider: ExchangeRateProviderCode | null;
  market: string | null;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  positionKind: MonetaryPositionKind;
  missingReason: string;
  conversionPath: string[];
  sourceRates: ExchangeRateSourceRate[];
};

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeExchangeRateRow(input: {
  provider: ExchangeRateProviderCode;
  market?: string | null;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  buyRate?: number | null;
  sellRate?: number | null;
  referenceRate?: number | null;
  sourceTimestamp?: string | Date | null;
  fetchedTimestamp?: string | Date | null;
  providerReference?: string | null;
  entryMethod?: "manual" | "api";
}): ExchangeRateSourceRate {
  const toIso = (value: string | Date | null | undefined) => {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : String(value);
  };
  return {
    provider: input.provider,
    market: input.market || "open_market",
    fromCurrencyCode: normalizeCode(input.fromCurrencyCode),
    toCurrencyCode: normalizeCode(input.toCurrencyCode),
    buyRate: input.buyRate == null ? null : Number(input.buyRate),
    sellRate: input.sellRate == null ? null : Number(input.sellRate),
    referenceRate: input.referenceRate == null ? null : Number(input.referenceRate),
    sourceTimestamp: toIso(input.sourceTimestamp),
    fetchedTimestamp: toIso(input.fetchedTimestamp),
    providerReference: input.providerReference || null,
    entryMethod: input.entryMethod || "manual",
  };
}

export function selectRateForPosition(
  sourceRate: ExchangeRateSourceRate,
  positionKind: MonetaryPositionKind
): NormalizedExchangeRateResult {
  const selectedRateType = positionKind === "asset" ? "buy" : "sell";
  const directRate = selectedRateType === "buy" ? sourceRate.buyRate : sourceRate.sellRate;
  const rate = directRate || sourceRate.referenceRate;
  if (!rate || rate <= 0) {
    return {
      ok: false,
      provider: sourceRate.provider,
      market: sourceRate.market,
      fromCurrencyCode: sourceRate.fromCurrencyCode,
      toCurrencyCode: sourceRate.toCurrencyCode,
      positionKind,
      missingReason: `Missing ${sourceRate.fromCurrencyCode}→${sourceRate.toCurrencyCode} ${selectedRateType} rate for ${positionKind} valuation.`,
      conversionPath: [`${sourceRate.fromCurrencyCode}→${sourceRate.toCurrencyCode}`],
      sourceRates: [sourceRate],
    };
  }
  return {
    ok: true,
    provider: sourceRate.provider,
    market: sourceRate.market,
    fromCurrencyCode: sourceRate.fromCurrencyCode,
    toCurrencyCode: sourceRate.toCurrencyCode,
    rate: round6(rate),
    selectedRateType: directRate ? selectedRateType : "reference",
    positionKind,
    sourceTimestamp: sourceRate.sourceTimestamp,
    fetchedTimestamp: sourceRate.fetchedTimestamp,
    providerReference: sourceRate.providerReference,
    entryMethod: sourceRate.entryMethod,
    conversionPath: [`${sourceRate.fromCurrencyCode}→${sourceRate.toCurrencyCode}`],
    sourceRates: [sourceRate],
  };
}

export function buildCrossRateToPkr(input: {
  fromCurrencyCode: string;
  viaCurrencyCode: string;
  toCurrencyCode?: string;
  firstLeg: NormalizedExchangeRateResult;
  secondLeg: NormalizedExchangeRateResult;
  positionKind: MonetaryPositionKind;
}): NormalizedExchangeRateResult {
  const toCurrencyCode = normalizeCode(input.toCurrencyCode || "PKR");
  const fromCurrencyCode = normalizeCode(input.fromCurrencyCode);
  const viaCurrencyCode = normalizeCode(input.viaCurrencyCode);
  const conversionPath = [`${fromCurrencyCode}→${viaCurrencyCode}`, `${viaCurrencyCode}→${toCurrencyCode}`];
  if (!input.firstLeg.ok || !input.secondLeg.ok) {
    return {
      ok: false,
      provider: null,
      market: null,
      fromCurrencyCode,
      toCurrencyCode,
      positionKind: input.positionKind,
      missingReason: `Missing cross-rate path ${conversionPath.join(" → ")}.`,
      conversionPath,
      sourceRates: [...input.firstLeg.sourceRates, ...input.secondLeg.sourceRates],
    };
  }
  return {
    ok: true,
    provider: input.firstLeg.provider,
    market: `${input.firstLeg.market}+${input.secondLeg.market}`,
    fromCurrencyCode,
    toCurrencyCode,
    rate: round6(input.firstLeg.rate * input.secondLeg.rate),
    selectedRateType: input.firstLeg.selectedRateType,
    positionKind: input.positionKind,
    sourceTimestamp: input.firstLeg.sourceTimestamp || input.secondLeg.sourceTimestamp,
    fetchedTimestamp: input.firstLeg.fetchedTimestamp || input.secondLeg.fetchedTimestamp,
    providerReference: [input.firstLeg.providerReference, input.secondLeg.providerReference].filter(Boolean).join(" + ") || null,
    entryMethod: input.firstLeg.entryMethod === "api" || input.secondLeg.entryMethod === "api" ? "api" : "manual",
    conversionPath,
    sourceRates: [...input.firstLeg.sourceRates, ...input.secondLeg.sourceRates],
  };
}

export function normalizeSarafiAfRate(input: {
  market: string;
  fromCurrencyCode: string;
  toCurrencyCode?: string;
  buyRate: number;
  sellRate: number;
  sourceTimestamp?: string | Date | null;
  fetchedTimestamp?: string | Date | null;
  providerReference?: string | null;
}): ExchangeRateSourceRate {
  return normalizeExchangeRateRow({
    provider: "SARAFI_AF",
    market: input.market,
    fromCurrencyCode: input.fromCurrencyCode,
    toCurrencyCode: input.toCurrencyCode || "AFN",
    buyRate: input.buyRate,
    sellRate: input.sellRate,
    referenceRate: null,
    sourceTimestamp: input.sourceTimestamp || null,
    fetchedTimestamp: input.fetchedTimestamp || null,
    providerReference: input.providerReference || null,
    entryMethod: "api",
  });
}

export function sarafiAfIntegrationStatus() {
  return {
    provider: "SARAFI_AF" as const,
    status: "FOUNDATION_ONLY",
    authoritative: false,
    automaticIngestionEnabled: false,
    reason: "No documented supported Sarafi.af API/feed has been approved; do not scrape HTML as authoritative accounting data.",
  };
}
