import {
  buildHistoricalFxTransaction,
  type HistoricalPoolTransaction,
} from "./historical-pool-attribution";
import type {
  MonetaryPositionKind,
  NormalizedExchangeRateResult,
} from "./exchange-rate-provider";
import type { UnsupportedFxPosition } from "./investor-finalization-dry-run";

export type LiveFxPositionType =
  | "foreign_cash"
  | "customer_receivable"
  | "supplier_payable"
  | "intermediary_balance"
  | "shipper_balance"
  | "other_monetary_position";

export type ReliableLiveFxPosition = {
  sourceRecord: string;
  sourcePosition: string;
  positionType: LiveFxPositionType;
  positionKind: MonetaryPositionKind;
  currencyCode: string;
  foreignAmount: number;
  carryingPkrValue: number;
  historicalRate: number;
  historicalPoolDate: string;
  valuationDate: string;
  valuationRate: NormalizedExchangeRateResult;
};

export type UnsupportedLiveFxPosition = {
  sourceRecord: string;
  sourcePosition: string;
  positionType: LiveFxPositionType;
  positionKind: MonetaryPositionKind;
  currencyCode: string;
  foreignAmount: number;
  date: string;
  reason: string;
  material?: boolean;
};

export type LiveFxCoveragePreview = {
  supportedPositions: Array<{
    sourceRecord: string;
    sourcePosition: string;
    positionType: LiveFxPositionType;
    positionKind: MonetaryPositionKind;
    currencyCode: string;
    foreignAmount: number;
    carryingPkrValue: number;
    historicalRate: number;
    valuationDate: string;
    valuationRate: number | null;
    provider: string | null;
    market: string | null;
    selectedRateType: string | null;
    historicalPoolDate: string;
    fxGainLossPkr: number | null;
    conversionPath: string[];
  }>;
  unsupportedPositions: UnsupportedFxPosition[];
  historicalTransactions: HistoricalPoolTransaction[];
  coverageSummary: Array<{
    path: LiveFxPositionType;
    status: "SUPPORTED" | "BLOCKED";
    reason: string;
  }>;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function dateOnly(date: Date | string): string {
  return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
}

function summarizeCoverage(supported: ReliableLiveFxPosition[], unsupported: UnsupportedLiveFxPosition[]) {
  const paths: LiveFxPositionType[] = [
    "foreign_cash",
    "customer_receivable",
    "supplier_payable",
    "intermediary_balance",
    "shipper_balance",
    "other_monetary_position",
  ];
  return paths.map((path) => {
    const supportedCount = supported.filter((position) => position.positionType === path).length;
    const unsupportedReasons = unsupported
      .filter((position) => position.positionType === path && position.material !== false)
      .map((position) => position.reason);
    if (unsupportedReasons.length > 0) {
      return { path, status: "BLOCKED" as const, reason: unsupportedReasons[0] };
    }
    if (supportedCount > 0) {
      return { path, status: "SUPPORTED" as const, reason: `${supportedCount} reliable live position(s) traced.` };
    }
    return { path, status: "SUPPORTED" as const, reason: "No material live foreign-currency balance found in audited source path." };
  });
}

export function buildLiveFxCoveragePreview(input: {
  supportedPositions: ReliableLiveFxPosition[];
  unsupportedPositions?: UnsupportedLiveFxPosition[];
}): LiveFxCoveragePreview {
  const historicalTransactions = input.supportedPositions.map((position) => buildHistoricalFxTransaction({
    sourceId: position.sourceRecord,
    sourcePosition: position.sourcePosition,
    recognizedDate: dateOnly(position.valuationDate),
    originalPoolDate: dateOnly(position.historicalPoolDate),
    currencyCode: position.currencyCode,
    foreignAmount: Number(position.foreignAmount || 0),
    carryingRate: Number(position.historicalRate || 0),
    valuationRate: position.valuationRate.ok ? position.valuationRate.rate : null,
    valuationDate: dateOnly(position.valuationDate),
    provider: position.valuationRate.ok ? position.valuationRate.provider : position.valuationRate.provider,
    market: position.valuationRate.ok ? position.valuationRate.market : position.valuationRate.market,
    selectedRateType: position.valuationRate.ok ? position.valuationRate.selectedRateType : null,
    positionKind: position.positionKind,
    conversionPath: position.valuationRate.conversionPath,
    sourceRates: position.valuationRate.sourceRates,
    rateSource: position.valuationRate.ok ? `${position.valuationRate.provider} ${position.valuationRate.market}` : null,
    description: `FX revaluation · ${position.sourcePosition}`,
  }));

  const supportedPositions = input.supportedPositions.map((position, index) => {
    const tx = historicalTransactions[index].fx;
    return {
      sourceRecord: position.sourceRecord,
      sourcePosition: position.sourcePosition,
      positionType: position.positionType,
      positionKind: position.positionKind,
      currencyCode: position.currencyCode.toUpperCase(),
      foreignAmount: round6(Number(position.foreignAmount || 0)),
      carryingPkrValue: round2(Number(position.carryingPkrValue || 0)),
      historicalRate: round6(Number(position.historicalRate || 0)),
      valuationDate: dateOnly(position.valuationDate),
      valuationRate: tx?.valuationRate ?? null,
      provider: tx?.provider || null,
      market: tx?.market || null,
      selectedRateType: tx?.selectedRateType || null,
      historicalPoolDate: dateOnly(position.historicalPoolDate),
      fxGainLossPkr: tx?.fxGainLossPkr ?? null,
      conversionPath: tx?.conversionPath || [`${position.currencyCode.toUpperCase()}→PKR`],
    };
  });

  const unsupportedPositions = (input.unsupportedPositions || []).map((position) => ({
    sourcePosition: position.sourcePosition,
    currencyCode: position.currencyCode.toUpperCase(),
    foreignAmount: round6(Number(position.foreignAmount || 0)),
    date: dateOnly(position.date),
    reason: `${position.positionType}: ${position.reason}`,
    material: position.material,
  }));

  return {
    supportedPositions,
    unsupportedPositions,
    historicalTransactions,
    coverageSummary: summarizeCoverage(input.supportedPositions, input.unsupportedPositions || []),
  };
}
