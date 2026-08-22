import {
  type AttributionCapitalEvent,
  type AttributionParticipantType,
  type AttributionProfitShareEvent,
} from "./investor-attribution";
import type { ExchangeRateProviderCode, MonetaryPositionKind, ExchangeRateSourceRate } from "./exchange-rate-provider";

type PoolParticipant = {
  participantId: string;
  participantName: string;
  participantType: AttributionParticipantType;
  capitalPkr: number;
  capitalPercent: number;
  investorProfitSharePercent: number;
  managerProfitSharePercent: number;
};

export type HistoricalPoolTransaction = {
  sourceType:
    | "sale_profit"
    | "discount"
    | "price_increase"
    | "price_reduction"
    | "return"
    | "default"
    | "recovery"
    | "other_adjustment"
    | "fx_gain_loss";
  sourceId: string | number;
  recognizedDate: string;
  originalPoolDate: string;
  amountPkr: number;
  description?: string | null;
  fx?: HistoricalPoolFxDetails | null;
};

export type HistoricalPoolFxDetails = {
  currencyCode: string;
  foreignAmount: number;
  carryingAmountPkr: number;
  carryingRate: number;
  valuationDate: string;
  valuationRate: number | null;
  valuationAmountPkr: number | null;
  fxGainLossPkr: number | null;
  sourcePosition: string;
  provider?: ExchangeRateProviderCode | null;
  market?: string | null;
  selectedRateType?: "buy" | "sell" | "reference" | null;
  positionKind?: MonetaryPositionKind | null;
  conversionPath?: string[];
  sourceRates?: ExchangeRateSourceRate[];
  rateSource?: string | null;
  missingRateReason?: string | null;
};

export type HistoricalPoolPreview = {
  pools: Array<{
    poolId: string;
    segmentStart: string;
    segmentEnd: string;
    totalCapitalPkr: number;
    participants: PoolParticipant[];
  }>;
  transactionLinks: Array<HistoricalPoolTransaction & {
    poolId: string | null;
    poolSegmentStart: string | null;
    poolSegmentEnd: string | null;
    originalRecognizedAmountPkr: number;
    activeParticipantAttributionPkr: number;
    residualAttributionPkr: number;
    finalRecipientAttributionPkr: number;
    reconciliationDifferencePkr: number;
    attribution: Array<{
      participantId: string;
      participantName: string;
      participantType: AttributionParticipantType;
      capitalPercent: number;
      attributablePkr: number;
      assumedByManager: boolean;
      participantStatus: "active" | "exited";
      residualAmountPkr: number;
      managerAssumedAmountPkr: number;
      finalRecipientParticipantId: string;
      finalRecipientName: string;
      finalAttributionPkr: number;
    }>;
  }>;
  residualTransfers: Array<{
    poolId: string;
    sourceType: HistoricalPoolTransaction["sourceType"];
    sourceId: string | number;
    originalParticipantId: string;
    originalParticipantName: string;
    managerParticipantId: string;
    managerParticipantName: string;
    originalCapitalPercent: number;
    originalAttributablePkr: number;
    managerAssumptionPkr: number;
    recognizedDate: string;
    reason: string;
  }>;
  aggregateReconciliation: {
    recognizedAmountPkr: number;
    activeParticipantAttributionPkr: number;
    residualAttributionPkr: number;
    finalRecipientAttributionPkr: number;
    reconciliationDifferencePkr: number;
  };
  blockedReasons: string[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function compareDate(a: string, b: string): number {
  return dateOnly(a).localeCompare(dateOnly(b));
}

function addDays(value: string, days: number): string {
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeShare(value: number | null | undefined, participantType: AttributionParticipantType): number {
  if (participantType === "manager") return 100;
  const share = Number(value);
  if (!Number.isFinite(share)) return 100;
  return Math.max(0, Math.min(100, share));
}

export function buildHistoricalFxTransaction(input: {
  sourceId: string | number;
  sourcePosition: string;
  recognizedDate: string;
  originalPoolDate: string;
  currencyCode: string;
  foreignAmount: number;
  carryingRate: number;
  valuationRate: number | null | undefined;
  valuationDate: string;
  provider?: ExchangeRateProviderCode | null;
  market?: string | null;
  selectedRateType?: "buy" | "sell" | "reference" | null;
  positionKind?: MonetaryPositionKind | null;
  conversionPath?: string[];
  sourceRates?: ExchangeRateSourceRate[];
  rateSource?: string | null;
  description?: string | null;
}): HistoricalPoolTransaction {
  const foreignAmount = Number(input.foreignAmount || 0);
  const carryingRate = Number(input.carryingRate || 0);
  const valuationRate = input.valuationRate == null ? null : Number(input.valuationRate);
  const carryingAmountPkr = round2(foreignAmount * carryingRate);
  const valuationAmountPkr = valuationRate == null ? null : round2(foreignAmount * valuationRate);
  const fxGainLossPkr = valuationAmountPkr == null ? null : round2(valuationAmountPkr - carryingAmountPkr);
  const currencyCode = input.currencyCode.toUpperCase();
  const valuationDate = dateOnly(input.valuationDate);
  const missingRateReason = valuationRate == null
    ? `Missing ${currencyCode}→PKR valuation rate for ${input.sourcePosition} on ${valuationDate}.`
    : null;

  return {
    sourceType: "fx_gain_loss",
    sourceId: input.sourceId,
    recognizedDate: dateOnly(input.recognizedDate),
    originalPoolDate: dateOnly(input.originalPoolDate),
    amountPkr: fxGainLossPkr ?? 0,
    description: input.description || input.sourcePosition,
    fx: {
      currencyCode,
      foreignAmount: round6(foreignAmount),
      carryingAmountPkr,
      carryingRate: round6(carryingRate),
      valuationDate,
      valuationRate: valuationRate == null ? null : round6(valuationRate),
      valuationAmountPkr,
      fxGainLossPkr,
      sourcePosition: input.sourcePosition,
      provider: input.provider || null,
      market: input.market || null,
      selectedRateType: input.selectedRateType || null,
      positionKind: input.positionKind || null,
      conversionPath: input.conversionPath || [`${currencyCode}→PKR`],
      sourceRates: input.sourceRates || [],
      rateSource: input.rateSource || null,
      missingRateReason,
    },
  };
}

function stablePoolId(segmentStart: string, segmentEnd: string, participants: PoolParticipant[]): string {
  const fingerprint = participants
    .map((participant) => [
      participant.participantId,
      participant.participantType,
      participant.capitalPkr,
      participant.investorProfitSharePercent,
      participant.managerProfitSharePercent,
    ].join(":"))
    .sort()
    .join("|");
  return `pool:${segmentStart}:${segmentEnd}:${fingerprint}`;
}

function buildBoundaries(periodStart: string, periodEnd: string, events: AttributionCapitalEvent[], shareEvents: AttributionProfitShareEvent[]) {
  const boundarySet = new Set<string>([dateOnly(periodStart), addDays(periodEnd, 1)]);
  for (const event of events) {
    const date = dateOnly(event.effectiveDate);
    if (compareDate(date, periodStart) > 0 && compareDate(date, periodEnd) <= 0) boundarySet.add(date);
  }
  for (const event of shareEvents) {
    const date = dateOnly(event.effectiveDate);
    if (compareDate(date, periodStart) > 0 && compareDate(date, periodEnd) <= 0) boundarySet.add(date);
  }
  return [...boundarySet].sort(compareDate);
}

function capitalAt(events: AttributionCapitalEvent[], shareEvents: AttributionProfitShareEvent[], asOfDate: string) {
  const byParticipant = new Map<string, {
    participantId: string;
    participantName: string;
    participantType: AttributionParticipantType;
    capitalPkr: number;
    investorProfitSharePercent: number;
  }>();
  for (const event of [...events].sort((a, b) => compareDate(a.effectiveDate, b.effectiveDate))) {
    if (compareDate(event.effectiveDate, asOfDate) > 0) continue;
    const existing = byParticipant.get(event.participantId) || {
      participantId: event.participantId,
      participantName: event.participantName,
      participantType: event.participantType,
      capitalPkr: 0,
      investorProfitSharePercent: normalizeShare(event.investorProfitSharePercent, event.participantType),
    };
    existing.capitalPkr += Number(event.amountPkr || 0);
    existing.investorProfitSharePercent = normalizeShare(event.investorProfitSharePercent, event.participantType);
    byParticipant.set(event.participantId, existing);
  }
  for (const event of [...shareEvents].sort((a, b) => compareDate(a.effectiveDate, b.effectiveDate))) {
    if (compareDate(event.effectiveDate, asOfDate) > 0) continue;
    const existing = byParticipant.get(event.participantId);
    if (!existing) continue;
    existing.investorProfitSharePercent = normalizeShare(event.investorProfitSharePercent, existing.participantType);
  }
  return [...byParticipant.values()].filter((participant) => participant.capitalPkr > 0);
}

export function buildHistoricalPoolPreview(input: {
  periodStart: string;
  periodEnd: string;
  capitalEvents: AttributionCapitalEvent[];
  profitShareEvents?: AttributionProfitShareEvent[];
  transactions: HistoricalPoolTransaction[];
}): HistoricalPoolPreview {
  const profitShareEvents = input.profitShareEvents || [];
  const boundaries = buildBoundaries(input.periodStart, input.periodEnd, input.capitalEvents, profitShareEvents);
  const pools: HistoricalPoolPreview["pools"] = [];
  const blockedReasons = new Set<string>();

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const segmentStart = boundaries[index];
    const segmentEnd = addDays(boundaries[index + 1], -1);
    const activeCapital = capitalAt(input.capitalEvents, profitShareEvents, segmentStart);
    const totalCapital = activeCapital.reduce((sum, participant) => sum + participant.capitalPkr, 0);
    const participants = activeCapital.map((participant): PoolParticipant => {
      const investorProfitSharePercent = normalizeShare(participant.investorProfitSharePercent, participant.participantType);
      return {
        participantId: participant.participantId,
        participantName: participant.participantName,
        participantType: participant.participantType,
        capitalPkr: round2(participant.capitalPkr),
        capitalPercent: totalCapital > 0 ? round6((participant.capitalPkr / totalCapital) * 100) : 0,
        investorProfitSharePercent: round6(investorProfitSharePercent),
        managerProfitSharePercent: participant.participantType === "manager" ? 0 : round6(100 - investorProfitSharePercent),
      };
    });
    if (participants.length === 0) {
      blockedReasons.add(`No historical pool capital exists for ${segmentStart} to ${segmentEnd}.`);
    }
    pools.push({
      poolId: stablePoolId(segmentStart, segmentEnd, participants),
      segmentStart,
      segmentEnd,
      totalCapitalPkr: round2(totalCapital),
      participants,
    });
  }

  const findPool = (poolDate: string) => pools.find((pool) =>
    compareDate(pool.segmentStart, poolDate) <= 0 && compareDate(pool.segmentEnd, poolDate) >= 0
  ) || null;
  const managerForDate = (recognizedDate: string) => (
    capitalAt(input.capitalEvents, profitShareEvents, recognizedDate)
      .find((participant) => participant.participantType === "manager")
  );
  const activeParticipantIdsAt = (recognizedDate: string) => new Set(
    capitalAt(input.capitalEvents, profitShareEvents, recognizedDate).map((participant) => participant.participantId)
  );

  const residualTransfers: HistoricalPoolPreview["residualTransfers"] = [];
  const transactionLinks = input.transactions.map((transaction) => {
    if (transaction.fx?.missingRateReason) blockedReasons.add(transaction.fx.missingRateReason);
    const pool = findPool(transaction.originalPoolDate);
    if (!pool) {
      blockedReasons.add(`No historical pool found for ${transaction.sourceType}:${transaction.sourceId} on ${transaction.originalPoolDate}.`);
      return {
        ...transaction,
        poolId: null,
        poolSegmentStart: null,
        poolSegmentEnd: null,
        originalRecognizedAmountPkr: round2(transaction.amountPkr || 0),
        activeParticipantAttributionPkr: 0,
        residualAttributionPkr: 0,
        finalRecipientAttributionPkr: 0,
        reconciliationDifferencePkr: round2(transaction.amountPkr || 0),
        attribution: [],
      };
    }
    const activeNow = activeParticipantIdsAt(transaction.recognizedDate);
    const currentManager = managerForDate(transaction.recognizedDate);
    const recognizedAmountPkr = round2(Number(transaction.amountPkr || 0));
    const rawAttribution = pool.participants.map((participant) => ({
      participant,
      attributablePkr: round2(recognizedAmountPkr * (participant.capitalPercent / 100)),
    }));
    const roundedTotal = rawAttribution.reduce((sum, line) => round2(sum + line.attributablePkr), 0);
    const roundingDifference = round2(recognizedAmountPkr - roundedTotal);
    if (rawAttribution.length > 0 && roundingDifference !== 0) {
      const managerIndex = rawAttribution.findIndex((line) => line.participant.participantType === "manager");
      const adjustmentIndex = managerIndex >= 0 ? managerIndex : 0;
      rawAttribution[adjustmentIndex].attributablePkr = round2(rawAttribution[adjustmentIndex].attributablePkr + roundingDifference);
    }
    let activeParticipantAttributionPkr = 0;
    let residualAttributionPkr = 0;
    let finalRecipientAttributionPkr = 0;
    const attribution = rawAttribution.map(({ participant, attributablePkr }) => {
      const assumedByManager = participant.participantType === "investor" && !activeNow.has(participant.participantId);
      const participantStatus: "active" | "exited" = activeNow.has(participant.participantId) ? "active" : "exited";
      const residualAmountPkr = assumedByManager ? attributablePkr : 0;
      const finalRecipientParticipantId = assumedByManager && currentManager ? currentManager.participantId : participant.participantId;
      const finalRecipientName = assumedByManager && currentManager ? currentManager.participantName : participant.participantName;
      const managerAssumedAmountPkr = assumedByManager ? attributablePkr : 0;
      const finalAttributionPkr = attributablePkr;
      if (assumedByManager) {
        if (!currentManager) {
          blockedReasons.add(`No active manager can assume residual ${transaction.sourceType}:${transaction.sourceId}.`);
        } else {
          residualTransfers.push({
            poolId: pool.poolId,
            sourceType: transaction.sourceType,
            sourceId: transaction.sourceId,
            originalParticipantId: participant.participantId,
            originalParticipantName: participant.participantName,
            managerParticipantId: currentManager.participantId,
            managerParticipantName: currentManager.participantName,
            originalCapitalPercent: participant.capitalPercent,
            originalAttributablePkr: attributablePkr,
            managerAssumptionPkr: attributablePkr,
            recognizedDate: transaction.recognizedDate,
            reason: "Exited investor residual gain/loss assumed by manager for original historical pool.",
          });
        }
        residualAttributionPkr = round2(residualAttributionPkr + attributablePkr);
      } else {
        activeParticipantAttributionPkr = round2(activeParticipantAttributionPkr + attributablePkr);
      }
      finalRecipientAttributionPkr = round2(finalRecipientAttributionPkr + finalAttributionPkr);
      return {
        participantId: participant.participantId,
        participantName: participant.participantName,
        participantType: participant.participantType,
        capitalPercent: participant.capitalPercent,
        attributablePkr,
        assumedByManager,
        participantStatus,
        residualAmountPkr,
        managerAssumedAmountPkr,
        finalRecipientParticipantId,
        finalRecipientName,
        finalAttributionPkr,
      };
    });
    const reconciliationDifferencePkr = round2(recognizedAmountPkr - activeParticipantAttributionPkr - residualAttributionPkr);
    return {
      ...transaction,
      poolId: pool.poolId,
      poolSegmentStart: pool.segmentStart,
      poolSegmentEnd: pool.segmentEnd,
      originalRecognizedAmountPkr: recognizedAmountPkr,
      activeParticipantAttributionPkr,
      residualAttributionPkr,
      finalRecipientAttributionPkr,
      reconciliationDifferencePkr,
      attribution,
    };
  });
  const aggregateReconciliation = transactionLinks.reduce((summary, row) => ({
    recognizedAmountPkr: round2(summary.recognizedAmountPkr + row.originalRecognizedAmountPkr),
    activeParticipantAttributionPkr: round2(summary.activeParticipantAttributionPkr + row.activeParticipantAttributionPkr),
    residualAttributionPkr: round2(summary.residualAttributionPkr + row.residualAttributionPkr),
    finalRecipientAttributionPkr: round2(summary.finalRecipientAttributionPkr + row.finalRecipientAttributionPkr),
    reconciliationDifferencePkr: round2(summary.reconciliationDifferencePkr + row.reconciliationDifferencePkr),
  }), {
    recognizedAmountPkr: 0,
    activeParticipantAttributionPkr: 0,
    residualAttributionPkr: 0,
    finalRecipientAttributionPkr: 0,
    reconciliationDifferencePkr: 0,
  });

  return {
    pools,
    transactionLinks,
    residualTransfers,
    aggregateReconciliation,
    blockedReasons: [...blockedReasons],
  };
}
