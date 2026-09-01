import prisma from "@/lib/prisma";

export type ParticipantActionType =
  | "profit_withdrawal"
  | "capital_withdrawal"
  | "mixed_withdrawal"
  | "profit_reinvestment"
  | "full_exit"
  | "reversal";

export type ParticipantBalance = {
  participantId: number;
  openingCapitalPkr: number;
  capitalAddedPkr: number;
  participatingCapitalPkr: number;
  finalizedUndistributedProfitPkr: number;
  finalizedAllocatedLossPkr: number;
  profitWithdrawnPkr: number;
  capitalWithdrawnPkr: number;
  profitReinvestedPkr: number;
  currentAvailableProfitPkr: number;
  currentParticipatingCapitalPkr: number;
  finalizedProfitSources: Array<{ periodId: number; category: string; postingType: string; availablePkr: number }>;
  capitalReconciliation: {
    openingCapitalPkr: number;
    capitalAddedAndReinvestedPkr: number;
    capitalWithdrawnPkr: number;
    allocatedCapitalLossPkr: number;
    currentParticipatingCapitalPkr: number;
    differencePkr: number;
  };
  profitReconciliation: {
    finalizedProfitEntitlementPkr: number;
    profitWithdrawnPkr: number;
    profitReinvestedPkr: number;
    reversalAdjustmentPkr: number;
    availableFinalizedProfitPkr: number;
    differencePkr: number;
  };
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amount(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? round2(parsed) : 0;
}

function isProfitLedgerEntry(entry: any): boolean {
  if (entry.category === "investor_profit") return true;
  if (entry.category === "manager_profit_share") return true;
  if (entry.category === "manager_residual") return String(entry.postingType || "") === "exited_residual_gain";
  if (entry.category === "manager_own_capital") return entry.postingType === "manager_own_capital_profit";
  return false;
}

function isLossLedgerEntry(entry: any): boolean {
  if (entry.category === "investor_capital_loss") return true;
  if (entry.category === "manager_residual") return String(entry.postingType || "") === "exited_residual_loss";
  if (entry.category === "manager_own_capital") return entry.postingType === "manager_own_capital_loss";
  return false;
}

export function buildParticipantBalance(input: {
  participantId: number;
  capitalEvents: any[];
  finalizationLedgerEntries: any[];
  actionLedgerEntries: any[];
}): ParticipantBalance {
  const openingCapitalPkr = round2(input.capitalEvents.filter((event) => event.eventType === "opening").reduce((sum, event) => sum + amount(event.amountPkr), 0));
  const capitalAddedPkr = round2(input.capitalEvents
    .filter((event) => ["capital_contribution", "profit_reinvestment"].includes(String(event.eventType)))
    .reduce((sum, event) => sum + amount(event.amountPkr), 0));
  const rawParticipatingCapitalPkr = round2(input.capitalEvents.reduce((sum, event) => sum + amount(event.amountPkr), 0));
  const activeActions = input.actionLedgerEntries.filter((entry) => entry.action?.status === "active" && entry.action?.actionType !== "reversal");
  const consumedBySource = new Map<string, number>();
  for (const entry of activeActions) {
    if (!["finalized_profit_withdrawal", "profit_reinvestment", "full_exit_profit"].includes(String(entry.category))) continue;
    const sources = Array.isArray(entry.sourceFinalizationIds) ? entry.sourceFinalizationIds : [];
    for (const source of sources) {
      const key = `${source.periodId}:${source.category}:${source.postingType}`;
      consumedBySource.set(key, round2((consumedBySource.get(key) || 0) + amount(source.amountPkr)));
    }
  }
  const finalizedProfitTotalPkr = round2(input.finalizationLedgerEntries.filter(isProfitLedgerEntry).reduce((sum, entry) => sum + amount(entry.amountPkr), 0));
  const finalizedProfitSources = input.finalizationLedgerEntries
    .filter(isProfitLedgerEntry)
    .map((entry) => ({
      periodId: Number(entry.periodId),
      category: String(entry.category),
      postingType: String(entry.postingType),
      availablePkr: round2(amount(entry.amountPkr) - (consumedBySource.get(`${entry.periodId}:${entry.category}:${entry.postingType}`) || 0)),
    }))
    .filter((entry) => entry.availablePkr > 0);
  const currentAvailableProfitFromSourcesPkr = round2(finalizedProfitSources.reduce((sum, row) => sum + row.availablePkr, 0));
  const finalizedAllocatedLossPkr = round2(input.finalizationLedgerEntries.filter(isLossLedgerEntry).reduce((sum, entry) => sum + amount(entry.amountPkr), 0));

  const profitWithdrawnPkr = round2(activeActions
    .filter((entry) => ["finalized_profit_withdrawal", "full_exit_profit"].includes(String(entry.category)))
    .reduce((sum, entry) => sum + amount(entry.amountPkr), 0));
  const capitalWithdrawnPkr = round2(Math.abs(input.capitalEvents
    .filter((event) => ["capital_withdrawal", "full_exit"].includes(String(event.eventType)))
    .reduce((sum, event) => sum + Math.min(0, amount(event.amountPkr)), 0)));
  const profitReinvestedPkr = round2(activeActions
    .filter((entry) => String(entry.category) === "profit_reinvestment")
    .reduce((sum, entry) => sum + amount(entry.amountPkr), 0));
  const currentParticipatingCapitalPkr = round2(rawParticipatingCapitalPkr - finalizedAllocatedLossPkr);
  const capitalFormulaPkr = round2(openingCapitalPkr + capitalAddedPkr - capitalWithdrawnPkr - finalizedAllocatedLossPkr);
  const profitFormulaPkr = round2(finalizedProfitTotalPkr - profitWithdrawnPkr - profitReinvestedPkr);

  return {
    participantId: input.participantId,
    openingCapitalPkr,
    capitalAddedPkr,
    participatingCapitalPkr: rawParticipatingCapitalPkr,
    finalizedUndistributedProfitPkr: finalizedProfitTotalPkr,
    finalizedAllocatedLossPkr,
    profitWithdrawnPkr,
    capitalWithdrawnPkr,
    profitReinvestedPkr,
    currentAvailableProfitPkr: currentAvailableProfitFromSourcesPkr,
    currentParticipatingCapitalPkr,
    finalizedProfitSources,
    capitalReconciliation: {
      openingCapitalPkr,
      capitalAddedAndReinvestedPkr: capitalAddedPkr,
      capitalWithdrawnPkr,
      allocatedCapitalLossPkr: finalizedAllocatedLossPkr,
      currentParticipatingCapitalPkr,
      differencePkr: round2(capitalFormulaPkr - currentParticipatingCapitalPkr),
    },
    profitReconciliation: {
      finalizedProfitEntitlementPkr: finalizedProfitTotalPkr,
      profitWithdrawnPkr,
      profitReinvestedPkr,
      reversalAdjustmentPkr: 0,
      availableFinalizedProfitPkr: currentAvailableProfitFromSourcesPkr,
      differencePkr: round2(profitFormulaPkr - currentAvailableProfitFromSourcesPkr),
    },
  };
}

export async function loadParticipantBalance(participantId: number, client: any = prisma): Promise<ParticipantBalance> {
  const [capitalEvents, finalizationLedgerEntries, actionLedgerEntries] = await Promise.all([
    client.investmentCapitalEvent.findMany({ where: { participantId }, orderBy: { effectiveDate: "asc" } }),
    (client as any).investorAttributionLedgerEntry.findMany({
      where: { participantId, period: { status: "finalized" } },
      include: { period: { select: { id: true, periodEnd: true, status: true } } },
      orderBy: [{ periodId: "asc" }, { id: "asc" }],
    }),
    (client as any).investmentParticipantActionLedgerEntry.findMany({
      where: { participantId },
      include: { action: { select: { id: true, actionType: true, status: true } } },
      orderBy: [{ id: "asc" }],
    }),
  ]);
  return buildParticipantBalance({ participantId, capitalEvents, finalizationLedgerEntries, actionLedgerEntries });
}

export function consumeProfitSources(sources: ParticipantBalance["finalizedProfitSources"], requestedPkr: number) {
  let remaining = round2(requestedPkr);
  const consumed: Array<{ periodId: number; category: string; postingType: string; amountPkr: number }> = [];
  for (const source of sources) {
    if (remaining <= 0) break;
    const take = round2(Math.min(source.availablePkr, remaining));
    if (take <= 0) continue;
    consumed.push({ ...source, amountPkr: take });
    remaining = round2(remaining - take);
  }
  return { consumed, remainingPkr: remaining };
}

export function validateParticipantAction(input: {
  actionType: ParticipantActionType;
  profitAmountPkr: number;
  capitalAmountPkr: number;
  balance: ParticipantBalance;
  participantIsActive: boolean;
}) {
  const { actionType, profitAmountPkr, capitalAmountPkr, balance } = input;
  if (!input.participantIsActive && actionType !== "reversal") {
    return "Participant is already fully exited";
  }
  if (actionType === "profit_withdrawal") {
    if (profitAmountPkr <= 0) return "Profit withdrawal amount must be greater than 0";
    if (profitAmountPkr > balance.currentAvailableProfitPkr) return "Profit withdrawal exceeds available finalized undistributed profit";
  }
  if (actionType === "capital_withdrawal") {
    if (capitalAmountPkr <= 0) return "Capital withdrawal amount must be greater than 0";
    if (capitalAmountPkr > balance.currentParticipatingCapitalPkr) return "Capital withdrawal exceeds current participating capital";
  }
  if (actionType === "mixed_withdrawal") {
    if (profitAmountPkr <= 0 && capitalAmountPkr <= 0) return "Mixed withdrawal requires an explicit profit or capital amount";
    if (profitAmountPkr > balance.currentAvailableProfitPkr) return "Profit portion exceeds available finalized undistributed profit";
    if (capitalAmountPkr > balance.currentParticipatingCapitalPkr) return "Capital portion exceeds current participating capital";
  }
  if (actionType === "profit_reinvestment") {
    if (profitAmountPkr <= 0) return "Profit reinvestment amount must be greater than 0";
    if (profitAmountPkr > balance.currentAvailableProfitPkr) return "Reinvestment exceeds available finalized undistributed profit";
  }
  if (actionType === "full_exit") {
    if (balance.currentParticipatingCapitalPkr < 0) return "Current participating capital is invalid";
    if (balance.currentParticipatingCapitalPkr !== 0) return "Full exit requires current participating capital to be zero";
    if (balance.currentAvailableProfitPkr !== 0) return "Full exit requires available finalized profit to be zero";
  }
  return null;
}

export function calculateSettlementStatus(obligationPkr: number, settlements: Array<{ pkrEquivalent: unknown; status?: string; idempotencyKey?: string }>) {
  const activeSettlements = settlements.filter((settlement) => settlement.status !== "reversed");
  const seen = new Set<string>();
  for (const settlement of activeSettlements) {
    if (!settlement.idempotencyKey) continue;
    if (seen.has(settlement.idempotencyKey)) return { ok: false as const, message: "Duplicate settlement idempotency key", settledAmountPkr: 0, remainingAmountPkr: obligationPkr, status: "unsettled" };
    seen.add(settlement.idempotencyKey);
  }
  const settledAmountPkr = round2(activeSettlements.reduce((sum, settlement) => sum + amount(settlement.pkrEquivalent), 0));
  if (settledAmountPkr > round2(obligationPkr)) {
    return { ok: false as const, message: "Settlement exceeds investor action obligation", settledAmountPkr, remainingAmountPkr: round2(obligationPkr - settledAmountPkr), status: "partially_settled" };
  }
  const remainingAmountPkr = round2(obligationPkr - settledAmountPkr);
  const status = settledAmountPkr <= 0 ? "unsettled" : remainingAmountPkr === 0 ? "settled" : "partially_settled";
  return { ok: true as const, message: null, settledAmountPkr, remainingAmountPkr, status };
}

export function validateSettlementAllocation(input: {
  actionType: ParticipantActionType;
  settlementPkrEquivalent: number;
  profitComponentPkr: number;
  capitalComponentPkr: number;
}) {
  const settlementPkrEquivalent = round2(input.settlementPkrEquivalent);
  const profitComponentPkr = round2(input.profitComponentPkr);
  const capitalComponentPkr = round2(input.capitalComponentPkr);
  if (settlementPkrEquivalent <= 0) return "Settlement amount must be greater than 0";
  if (profitComponentPkr < 0 || capitalComponentPkr < 0) return "Settlement components cannot be negative";
  if (input.actionType === "mixed_withdrawal" || input.actionType === "full_exit") {
    if (profitComponentPkr <= 0 && capitalComponentPkr <= 0) return "Mixed withdrawal settlement requires explicit profit/capital allocation";
    if (round2(profitComponentPkr + capitalComponentPkr) !== settlementPkrEquivalent) return "Settlement allocation must equal PKR equivalent";
  } else if (input.actionType === "profit_withdrawal") {
    if (profitComponentPkr !== settlementPkrEquivalent || capitalComponentPkr !== 0) return "Profit withdrawal settlement must allocate fully to profit";
  } else if (input.actionType === "capital_withdrawal") {
    if (capitalComponentPkr !== settlementPkrEquivalent || profitComponentPkr !== 0) return "Capital withdrawal settlement must allocate fully to capital";
  }
  return null;
}
