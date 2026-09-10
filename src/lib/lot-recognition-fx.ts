export const PAKISTAN_USD_OPEN_MARKET_ADJUSTMENT_PKR = 3;

export type PakistanSbpRateSource = {
  rateDate: string;
  buyRate: number;
  sellRate: number;
  providerReference: string;
};

type ResolvedPakistanLotRate = {
  ok: true;
  provider: "SBP" | "COUNTRY_FALLBACK" | "ACTUAL_DOCUMENTED_TRANSACTION_RATE";
  market: "open_market_closing" | "country_fallback" | "documented_transaction";
  rate: number;
  rawBuyRate: number | null;
  rawSellRate: number | null;
  selectedRateType: "sell" | "reference";
  businessAdjustmentPkr: number;
  transactionDate: string;
  rateSourceDate: string;
  daysCarriedBackward: number;
  providerReference: string | null;
  reason: "TARGET_DATE_RATE" | "PREVIOUS_AVAILABLE_RATE" | "COUNTRY_FALLBACK_RATE" | "ACTUAL_DOCUMENTED_RATE";
} | {
  ok: false;
  missingReason: string;
};

function round6(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function daysBetween(previousDate: string, targetDate: string) {
  const previous = new Date(`${previousDate}T00:00:00.000Z`).getTime();
  const target = new Date(`${targetDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((target - previous) / 86_400_000));
}

export function resolvePakistanUsdLotRecognitionRate(input: {
  transactionDate: string;
  actualDocumentedRate?: { rate: number; reference?: string | null } | null;
  rates: PakistanSbpRateSource[];
  fallbackRates?: Array<{ effectiveFrom: string; rate: number; providerReference: string }>;
}): ResolvedPakistanLotRate {
  if (Number(input.actualDocumentedRate?.rate || 0) > 0) {
    return {
      ok: true,
      provider: "ACTUAL_DOCUMENTED_TRANSACTION_RATE",
      market: "documented_transaction",
      rate: round6(Number(input.actualDocumentedRate!.rate)),
      rawBuyRate: null,
      rawSellRate: null,
      selectedRateType: "reference",
      businessAdjustmentPkr: 0,
      transactionDate: input.transactionDate,
      rateSourceDate: input.transactionDate,
      daysCarriedBackward: 0,
      providerReference: input.actualDocumentedRate?.reference || null,
      reason: "ACTUAL_DOCUMENTED_RATE",
    };
  }

  const selected = input.rates
    .filter((rate) => rate.rateDate <= input.transactionDate && Number(rate.sellRate) > 0)
    .sort((a, b) => b.rateDate.localeCompare(a.rateDate))[0];
  if (!selected) {
    const fallback = (input.fallbackRates || [])
      .filter((rate) => rate.effectiveFrom <= input.transactionDate && Number(rate.rate) > 0)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (fallback) {
      return {
        ok: true,
        provider: "COUNTRY_FALLBACK",
        market: "country_fallback",
        rate: round6(Number(fallback.rate)),
        rawBuyRate: null,
        rawSellRate: null,
        selectedRateType: "reference",
        businessAdjustmentPkr: 0,
        transactionDate: input.transactionDate,
        rateSourceDate: fallback.effectiveFrom,
        daysCarriedBackward: daysBetween(fallback.effectiveFrom, input.transactionDate),
        providerReference: fallback.providerReference,
        reason: "COUNTRY_FALLBACK_RATE",
      };
    }
    return {
      ok: false,
      missingReason: `Missing SBP Open Market Closing USD/PKR selling rate on or before ${input.transactionDate}.`,
    };
  }
  const daysCarriedBackward = daysBetween(selected.rateDate, input.transactionDate);
  return {
    ok: true,
    provider: "SBP",
    market: "open_market_closing",
    rate: round6(Number(selected.sellRate) + PAKISTAN_USD_OPEN_MARKET_ADJUSTMENT_PKR),
    rawBuyRate: Number(selected.buyRate) > 0 ? Number(selected.buyRate) : null,
    rawSellRate: Number(selected.sellRate),
    selectedRateType: "sell",
    businessAdjustmentPkr: PAKISTAN_USD_OPEN_MARKET_ADJUSTMENT_PKR,
    transactionDate: input.transactionDate,
    rateSourceDate: selected.rateDate,
    daysCarriedBackward,
    providerReference: selected.providerReference,
    reason: daysCarriedBackward > 0 ? "PREVIOUS_AVAILABLE_RATE" : "TARGET_DATE_RATE",
  };
}

const PAKISTAN_MANUAL_HISTORICAL_LOTS = new Set(["195", "124", "260", "JBP306-26", "JBP305-26"]);
const AFGHANISTAN_MANUAL_HISTORICAL_LOTS = new Set(["JBP-013", "JBP-866", "JBP-112"]);

export function resolveHistoricalLotRemediationRate(input: { countryCode: string; lotNumber: string }) {
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  const lotNumber = String(input.lotNumber || "").trim().toUpperCase();
  if (countryCode === "PK" && PAKISTAN_MANUAL_HISTORICAL_LOTS.has(lotNumber)) {
    return { rate: 281, source: "MANUAL_HISTORICAL_REMEDIATION" as const };
  }
  if (countryCode === "AF" && AFGHANISTAN_MANUAL_HISTORICAL_LOTS.has(lotNumber)) {
    return { rate: 288, source: "MANUAL_HISTORICAL_REMEDIATION" as const };
  }
  return null;
}
