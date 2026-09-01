export type AttributionParticipantType = "manager" | "investor";
export type CapitalEventType = "opening" | "capital_contribution" | "capital_withdrawal" | "profit_reinvestment" | "full_exit";

export type AttributionCapitalEvent = {
  participantId: string;
  participantName: string;
  participantType: AttributionParticipantType;
  effectiveDate: string;
  amountPkr: number;
  eventType: CapitalEventType;
  investorProfitSharePercent?: number | null;
};

export type AttributionBusinessResult = {
  netBusinessProfitPkr: number;
};

export type AttributionProfitShareEvent = {
  participantId: string;
  effectiveDate: string;
  investorProfitSharePercent: number;
  managerProfitSharePercent: number;
};

export type AttributionSegmentInput = {
  segmentStart: string;
  segmentEnd: string;
  result: AttributionBusinessResult;
};

export type AttributionLine = {
  participantId: string;
  participantName: string;
  participantType: AttributionParticipantType;
  segmentStart: string;
  segmentEnd: string;
  capitalPkr: number;
  capitalPercent: number;
  poolProfitPkr: number;
  attributablePkr: number;
  investorProfitSharePercent: number;
  managerProfitSharePercent: number;
  investorEntitlementPkr: number;
  managerOwnCapitalProfitPkr: number;
  managerSharePkr: number;
  allocatedLossPkr: number;
  totalAttributedPkr: number;
};

export type AttributionPreview = {
  periodStart: string;
  periodEnd: string;
  totalBusinessProfitPkr: number;
  totalAttributedPkr: number;
  totalManagerOwnCapitalProfitPkr: number;
  totalManagerSharePkr: number;
  reconciliationDifferencePkr: number;
  reconciliationStatus: "RECONCILED" | "OUT_OF_BALANCE";
  finalizationEnabled: false;
  finalizationDisabledReasons: string[];
  segments: Array<{
    segmentStart: string;
    segmentEnd: string;
    totalCapitalPkr: number;
    businessProfitPkr: number;
    lines: AttributionLine[];
  }>;
  participantSummary: Array<{
    participantId: string;
    participantName: string;
    participantType: AttributionParticipantType;
    capitalPkr: number;
    investorEntitlementPkr: number;
    managerOwnCapitalProfitPkr: number;
    managerSharePkr: number;
    allocatedLossPkr: number;
    totalAttributedPkr: number;
  }>;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${toDateOnly(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compareDate(a: string, b: string): number {
  return toDateOnly(a).localeCompare(toDateOnly(b));
}

function normalizeShare(value: number | null | undefined, participantType: AttributionParticipantType): number {
  if (participantType === "manager") return 100;
  const share = Number(value);
  if (!Number.isFinite(share)) return 0;
  return Math.max(0, Math.min(100, share));
}

function buildBoundaries(periodStart: string, periodEnd: string, events: AttributionCapitalEvent[], shareEvents: AttributionProfitShareEvent[]) {
  const start = toDateOnly(periodStart);
  const end = toDateOnly(periodEnd);
  const boundarySet = new Set<string>([start, addDays(end, 1)]);
  for (const event of events) {
    const date = toDateOnly(event.effectiveDate);
    if (compareDate(date, start) > 0 && compareDate(date, end) <= 0) boundarySet.add(date);
  }
  for (const event of shareEvents) {
    const date = toDateOnly(event.effectiveDate);
    if (compareDate(date, start) > 0 && compareDate(date, end) <= 0) boundarySet.add(date);
  }
  return [...boundarySet].sort(compareDate);
}

function capitalAt(events: AttributionCapitalEvent[], shareEvents: AttributionProfitShareEvent[], segmentStart: string) {
  const byParticipant = new Map<string, {
    participantId: string;
    participantName: string;
    participantType: AttributionParticipantType;
    capitalPkr: number;
    investorProfitSharePercent: number;
  }>();

  for (const event of [...events].sort((a, b) => compareDate(a.effectiveDate, b.effectiveDate))) {
    if (compareDate(event.effectiveDate, segmentStart) > 0) continue;
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
    if (compareDate(event.effectiveDate, segmentStart) > 0) continue;
    const existing = byParticipant.get(event.participantId);
    if (!existing) continue;
    existing.investorProfitSharePercent = normalizeShare(event.investorProfitSharePercent, existing.participantType);
  }

  return [...byParticipant.values()].filter((row) => row.capitalPkr > 0);
}

export async function buildInvestorAttributionPreview(input: {
  periodStart: string;
  periodEnd: string;
  capitalEvents: AttributionCapitalEvent[];
  profitShareEvents?: AttributionProfitShareEvent[];
  missingRequiredRates?: string[];
  getBusinessResult: (segmentStart: string, segmentEnd: string) => Promise<AttributionBusinessResult>;
}): Promise<AttributionPreview> {
  const periodStart = toDateOnly(input.periodStart);
  const periodEnd = toDateOnly(input.periodEnd);
  const profitShareEvents = input.profitShareEvents || [];
  const boundaries = buildBoundaries(periodStart, periodEnd, input.capitalEvents, profitShareEvents);
  const segments: AttributionPreview["segments"] = [];
  const disabledReasons = new Set<string>();

  if (input.capitalEvents.length === 0) {
    disabledReasons.add("No investor/manager capital events exist for this period.");
  }
  for (const missing of input.missingRequiredRates || []) {
    disabledReasons.add(missing);
  }
  for (const event of input.capitalEvents) {
    if (event.participantType !== "investor") continue;
    if (!Number.isFinite(Number(event.investorProfitSharePercent))) {
      disabledReasons.add(`${event.participantName} has no explicit investor profit-share percentage.`);
    }
  }
  for (const event of profitShareEvents) {
    if (!Number.isFinite(Number(event.investorProfitSharePercent))) {
      disabledReasons.add(`Participant ${event.participantId} has an invalid profit-share event.`);
    }
  }

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const segmentStart = boundaries[index];
    const segmentEnd = addDays(boundaries[index + 1], -1);
    const activeCapital = capitalAt(input.capitalEvents, profitShareEvents, segmentStart);
    const result = await input.getBusinessResult(segmentStart, segmentEnd);
    const businessProfit = Number(result.netBusinessProfitPkr || 0);
    const totalCapital = activeCapital.reduce((sum, row) => sum + row.capitalPkr, 0);

    if (totalCapital <= 0) {
      disabledReasons.add(`No participating capital for ${segmentStart} to ${segmentEnd}.`);
      segments.push({
        segmentStart,
        segmentEnd,
        totalCapitalPkr: 0,
        businessProfitPkr: round2(businessProfit),
        lines: [],
      });
      continue;
    }

    const lines = activeCapital.map((participant): AttributionLine => {
      const capitalPercent = participant.capitalPkr / totalCapital;
      const attributable = businessProfit * capitalPercent;
      const investorSharePercent = normalizeShare(participant.investorProfitSharePercent, participant.participantType);
      const managerSharePercent = participant.participantType === "manager" ? 0 : round6(100 - investorSharePercent);
      const isLoss = businessProfit < 0;
      const investorEntitlement = isLoss
        ? attributable
        : participant.participantType === "manager"
          ? attributable
          : attributable * (investorSharePercent / 100);
      const managerOwnCapitalProfit = !isLoss && participant.participantType === "manager" ? investorEntitlement : 0;
      const managerShare = isLoss || participant.participantType === "manager"
        ? 0
        : attributable - investorEntitlement;
      return {
        participantId: participant.participantId,
        participantName: participant.participantName,
        participantType: participant.participantType,
        segmentStart,
        segmentEnd,
        capitalPkr: round2(participant.capitalPkr),
        capitalPercent: round2(capitalPercent * 100),
        poolProfitPkr: round2(businessProfit),
        attributablePkr: round2(attributable),
        investorProfitSharePercent: round6(investorSharePercent),
        managerProfitSharePercent: managerSharePercent,
        investorEntitlementPkr: round2(investorEntitlement),
        managerOwnCapitalProfitPkr: round2(managerOwnCapitalProfit),
        managerSharePkr: round2(managerShare),
        allocatedLossPkr: isLoss ? round2(attributable) : 0,
        totalAttributedPkr: round2(investorEntitlement + managerShare),
      };
    });

    const roundedSegmentAttributed = lines.reduce((sum, line) => sum + line.totalAttributedPkr, 0);
    const roundingDifference = round2(businessProfit - roundedSegmentAttributed);
    if (Math.abs(roundingDifference) > 0 && lines.length > 0) {
      const managerLine = lines.find((line) => line.participantType === "manager") || lines[0];
      managerLine.totalAttributedPkr = round2(managerLine.totalAttributedPkr + roundingDifference);
      if (businessProfit < 0) {
        managerLine.investorEntitlementPkr = round2(managerLine.investorEntitlementPkr + roundingDifference);
        managerLine.allocatedLossPkr = round2(managerLine.allocatedLossPkr + roundingDifference);
      } else if (managerLine.participantType === "manager") {
        managerLine.investorEntitlementPkr = round2(managerLine.investorEntitlementPkr + roundingDifference);
        managerLine.managerOwnCapitalProfitPkr = round2(managerLine.managerOwnCapitalProfitPkr + roundingDifference);
      } else {
        managerLine.managerSharePkr = round2(managerLine.managerSharePkr + roundingDifference);
      }
    }

    segments.push({
      segmentStart,
      segmentEnd,
      totalCapitalPkr: round2(totalCapital),
      businessProfitPkr: round2(businessProfit),
      lines,
    });
  }

  const summaryMap = new Map<string, AttributionPreview["participantSummary"][number]>();
  for (const segment of segments) {
    for (const line of segment.lines) {
      const row = summaryMap.get(line.participantId) || {
        participantId: line.participantId,
        participantName: line.participantName,
        participantType: line.participantType,
        capitalPkr: line.capitalPkr,
        investorEntitlementPkr: 0,
        managerOwnCapitalProfitPkr: 0,
        managerSharePkr: 0,
        allocatedLossPkr: 0,
        totalAttributedPkr: 0,
      };
      row.capitalPkr = line.capitalPkr;
      row.investorEntitlementPkr = round2(row.investorEntitlementPkr + line.investorEntitlementPkr);
      row.managerOwnCapitalProfitPkr = round2(row.managerOwnCapitalProfitPkr + line.managerOwnCapitalProfitPkr);
      row.managerSharePkr = round2(row.managerSharePkr + line.managerSharePkr);
      row.allocatedLossPkr = round2(row.allocatedLossPkr + line.allocatedLossPkr);
      row.totalAttributedPkr = round2(row.totalAttributedPkr + line.totalAttributedPkr);
      summaryMap.set(line.participantId, row);
    }
  }

  const totalBusinessProfit = round2(segments.reduce((sum, segment) => sum + segment.businessProfitPkr, 0));
  const totalAttributed = round2(segments.reduce(
    (sum, segment) => sum + segment.lines.reduce((lineSum, line) => lineSum + line.totalAttributedPkr, 0),
    0
  ));
  const totalManagerOwnCapitalProfit = round2(segments.reduce(
    (sum, segment) => sum + segment.lines.reduce((lineSum, line) => lineSum + line.managerOwnCapitalProfitPkr, 0),
    0
  ));
  const totalManagerShare = round2(segments.reduce(
    (sum, segment) => sum + segment.lines.reduce((lineSum, line) => lineSum + line.managerSharePkr, 0),
    0
  ));
  const reconciliationDifference = round2(totalBusinessProfit - totalAttributed);

  if (Math.abs(reconciliationDifference) > 0) {
    disabledReasons.add("Investor attribution does not reconcile exactly with business profit/loss.");
  }
  return {
    periodStart,
    periodEnd,
    totalBusinessProfitPkr: totalBusinessProfit,
    totalAttributedPkr: totalAttributed,
    totalManagerOwnCapitalProfitPkr: totalManagerOwnCapitalProfit,
    totalManagerSharePkr: totalManagerShare,
    reconciliationDifferencePkr: reconciliationDifference,
    reconciliationStatus: Math.abs(reconciliationDifference) <= 0 ? "RECONCILED" : "OUT_OF_BALANCE",
    finalizationEnabled: false,
    finalizationDisabledReasons: [...disabledReasons],
    segments,
    participantSummary: [...summaryMap.values()],
  };
}
