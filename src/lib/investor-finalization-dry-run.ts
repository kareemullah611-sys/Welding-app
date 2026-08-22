import type { AttributionPreview } from "./investor-attribution";
import type { HistoricalPoolPreview } from "./historical-pool-attribution";

export type AttributionFinalizationStatus = "DRAFT" | "READY" | "BLOCKED" | "FINALIZED" | "REVERSED";

export type FinalizationDryRunBlockerCode =
  | "BLOCKED_RECONCILIATION"
  | "BLOCKED_MISSING_FX"
  | "BLOCKED_UNSUPPORTED_FX"
  | "BLOCKED_CAPITAL_SEGMENTS"
  | "BLOCKED_PROFIT_SHARE"
  | "BLOCKED_HISTORICAL_POOL"
  | "BLOCKED_RESIDUAL_RECONCILIATION"
  | "BLOCKED_DATA_INTEGRITY"
  | "BLOCKED_DUPLICATE_FINALIZATION"
  | "POST_FINALIZATION_ADJUSTMENT_REQUIRED";

export type UnsupportedFxPosition = {
  sourcePosition: string;
  currencyCode: string;
  foreignAmount: number;
  date: string;
  intermediaryName?: string | null;
  reason: string;
  material?: boolean;
};

export type ExistingFinalizationRecord = {
  periodStart: string;
  periodEnd: string;
  status: AttributionFinalizationStatus;
  finalizedAt?: string | null;
  reversedAt?: string | null;
};

export type SourceChangeSignal = {
  sourceType: string;
  sourceId: string | number;
  changedAt: string;
  reason: string;
};

export type PostingSimulationRequest = {
  postingType:
    | "investor_profit_withdrawal"
    | "capital_withdrawal"
    | "mixed_withdrawal"
    | "profit_reinvestment"
    | "full_exit";
  participantId: string;
  participantName: string;
  amountPkr: number;
  profitAmountPkr?: number;
  capitalAmountPkr?: number;
  sourcePoolId?: string | null;
  sourceAttributionLineId?: string | null;
  reference: string;
};

export type SimulatedPosting = {
  debitAccount: string;
  creditAccount: string;
  participantId: string;
  participantName: string;
  amountPkr: number;
  sourceFinalizationPeriod: string;
  sourcePool: string | null;
  sourceAttributionLine: string | null;
  postingType: string;
  reconciliationReference: string;
  dryRunOnly: true;
};

export type FinalizationDryRun = {
  status: AttributionFinalizationStatus;
  finalizationButtonEnabled: false;
  periodStart: string;
  periodEnd: string;
  blockers: Array<{ code: FinalizationDryRunBlockerCode; message: string }>;
  warnings: string[];
  snapshotDesign: {
    immutable: true;
    tables: string[];
    fields: string[];
    correctionWorkflow: "Original Finalization → Reversal → Corrected Finalization";
  };
  frozenPreview: {
    sourceFinancialReportResultPkr: number;
    sourceReportReference: string;
    historicalPoolCount: number;
    transactionLinkCount: number;
    residualTransferCount: number;
    reconciliationDifferencePkr: number;
  };
  proposedBalanceEffects: Array<{
    participantId: string;
    participantName: string;
    participantType: string;
    investorEntitlementPkr: number;
    managerOwnCapitalResultPkr: number;
    managerProfitSharePkr: number;
    managerExitedInvestorResidualPkr: number;
    lossAllocationPkr: number;
    netEffectPkr: number;
  }>;
  proposedPostingDesign: Array<{
    ledger: "Investor Capital Ledger" | "Investor Profit Ledger" | "Manager Profit Share Ledger" | "Residual Attribution Ledger";
    event: string;
    dryRunOnly: true;
    description: string;
  }>;
  postingSimulation: {
    dryRunOnly: true;
    chain: "Financial Report → Historical Pool → Investor Attribution → Finalization Snapshot → Proposed Postings";
    entries: SimulatedPosting[];
    reconciliation: {
      totalDebitsPkr: number;
      totalCreditsPkr: number;
      debitCreditDifferencePkr: number;
      postingSetResultPkr: number;
      finalizationSnapshotResultPkr: number;
      historicalAttributionResultPkr: number;
      financialReportResultPkr: number;
      postingToSnapshotDifferencePkr: number;
      snapshotToHistoricalDifferencePkr: number;
      historicalToFinancialReportDifferencePkr: number;
    };
  };
  reversalDesign: {
    directEditAllowed: false;
    workflow: "Original Finalization → Reversal → Corrected Finalization";
    preservesOriginalSnapshot: true;
  };
  concurrencyDesign: {
    idempotencyKey: string;
    uniquenessRules: string[];
    transactionRules: string[];
  };
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function samePeriod(a: ExistingFinalizationRecord, periodStart: string, periodEnd: string) {
  return a.periodStart === periodStart && a.periodEnd === periodEnd;
}

function addBlocker(
  blockers: FinalizationDryRun["blockers"],
  code: FinalizationDryRunBlockerCode,
  message: string
) {
  if (!blockers.some((blocker) => blocker.code === code && blocker.message === message)) {
    blockers.push({ code, message });
  }
}

function firstPoolId(input: HistoricalPoolPreview): string | null {
  return input.pools[0]?.poolId || null;
}

function addPosting(
  entries: SimulatedPosting[],
  input: {
    debitAccount: string;
    creditAccount: string;
    participantId: string;
    participantName: string;
    amountPkr: number;
    sourceFinalizationPeriod: string;
    sourcePool: string | null;
    sourceAttributionLine: string | null;
    postingType: string;
    reconciliationReference: string;
  }
) {
  const amountPkr = round2(Math.abs(Number(input.amountPkr || 0)));
  if (amountPkr <= 0) return;
  entries.push({ ...input, amountPkr, dryRunOnly: true });
}

function buildPostingSimulation(input: {
  attribution: AttributionPreview;
  historicalPoolPreview: HistoricalPoolPreview;
  proposedBalanceEffects: FinalizationDryRun["proposedBalanceEffects"];
  requests?: PostingSimulationRequest[];
}) {
  const sourceFinalizationPeriod = `${input.attribution.periodStart}:${input.attribution.periodEnd}`;
  const defaultPoolId = firstPoolId(input.historicalPoolPreview);
  const entries: SimulatedPosting[] = [];

  for (const effect of input.proposedBalanceEffects) {
    const sourceAttributionLine = `participant:${effect.participantId}`;
    if (effect.investorEntitlementPkr > 0 && effect.participantType !== "manager") {
      addPosting(entries, {
        debitAccount: "Profit Attribution Clearing",
        creditAccount: "Investor Profit Payable",
        participantId: effect.participantId,
        participantName: effect.participantName,
        amountPkr: effect.investorEntitlementPkr,
        sourceFinalizationPeriod,
        sourcePool: defaultPoolId,
        sourceAttributionLine,
        postingType: "investor_profit_entitlement",
        reconciliationReference: `finalization:${sourceFinalizationPeriod}:investor-profit:${effect.participantId}`,
      });
    }
    if (effect.lossAllocationPkr < 0) {
      addPosting(entries, {
        debitAccount: "Investor Capital",
        creditAccount: "Loss Attribution Clearing",
        participantId: effect.participantId,
        participantName: effect.participantName,
        amountPkr: effect.lossAllocationPkr,
        sourceFinalizationPeriod,
        sourcePool: defaultPoolId,
        sourceAttributionLine,
        postingType: "investor_capital_loss",
        reconciliationReference: `finalization:${sourceFinalizationPeriod}:capital-loss:${effect.participantId}`,
      });
    }
    if (effect.managerOwnCapitalResultPkr !== 0) {
      const isGain = effect.managerOwnCapitalResultPkr > 0;
      addPosting(entries, {
        debitAccount: isGain ? "Profit Attribution Clearing" : "Manager Capital",
        creditAccount: isGain ? "Manager Own-Capital Profit Payable" : "Loss Attribution Clearing",
        participantId: effect.participantId,
        participantName: effect.participantName,
        amountPkr: effect.managerOwnCapitalResultPkr,
        sourceFinalizationPeriod,
        sourcePool: defaultPoolId,
        sourceAttributionLine,
        postingType: "manager_own_capital_result",
        reconciliationReference: `finalization:${sourceFinalizationPeriod}:manager-own-capital:${effect.participantId}`,
      });
    }
    if (effect.managerProfitSharePkr > 0) {
      addPosting(entries, {
        debitAccount: "Profit Attribution Clearing",
        creditAccount: "Manager Profit Share Payable",
        participantId: effect.participantId,
        participantName: effect.participantName,
        amountPkr: effect.managerProfitSharePkr,
        sourceFinalizationPeriod,
        sourcePool: defaultPoolId,
        sourceAttributionLine,
        postingType: "manager_profit_share",
        reconciliationReference: `finalization:${sourceFinalizationPeriod}:manager-share:${effect.participantId}`,
      });
    }
    if (effect.managerExitedInvestorResidualPkr !== 0) {
      const isGain = effect.managerExitedInvestorResidualPkr > 0;
      addPosting(entries, {
        debitAccount: isGain ? "Residual Attribution Clearing" : "Manager Residual Attribution",
        creditAccount: isGain ? "Manager Residual Attribution" : "Residual Attribution Clearing",
        participantId: effect.participantId,
        participantName: effect.participantName,
        amountPkr: effect.managerExitedInvestorResidualPkr,
        sourceFinalizationPeriod,
        sourcePool: defaultPoolId,
        sourceAttributionLine,
        postingType: isGain ? "exited_residual_gain" : "exited_residual_loss",
        reconciliationReference: `finalization:${sourceFinalizationPeriod}:residual:${effect.participantId}`,
      });
    }
  }

  for (const request of input.requests || []) {
    const sourcePool = request.sourcePoolId ?? defaultPoolId;
    const sourceAttributionLine = request.sourceAttributionLineId ?? `participant:${request.participantId}`;
    if (request.postingType === "investor_profit_withdrawal") {
      addPosting(entries, {
        debitAccount: "Investor Profit Payable",
        creditAccount: "Cash/Bank Settlement",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.amountPkr,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: request.postingType,
        reconciliationReference: request.reference,
      });
    } else if (request.postingType === "capital_withdrawal") {
      addPosting(entries, {
        debitAccount: "Investor Capital",
        creditAccount: "Cash/Bank Settlement",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.amountPkr,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: request.postingType,
        reconciliationReference: request.reference,
      });
    } else if (request.postingType === "mixed_withdrawal") {
      addPosting(entries, {
        debitAccount: "Investor Profit Payable",
        creditAccount: "Cash/Bank Settlement",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.profitAmountPkr || 0,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: "mixed_withdrawal_profit_portion",
        reconciliationReference: request.reference,
      });
      addPosting(entries, {
        debitAccount: "Investor Capital",
        creditAccount: "Cash/Bank Settlement",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.capitalAmountPkr || 0,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: "mixed_withdrawal_capital_portion",
        reconciliationReference: request.reference,
      });
    } else if (request.postingType === "profit_reinvestment") {
      addPosting(entries, {
        debitAccount: "Investor Profit Payable",
        creditAccount: "Investor Capital",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.amountPkr,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: request.postingType,
        reconciliationReference: request.reference,
      });
    } else if (request.postingType === "full_exit") {
      addPosting(entries, {
        debitAccount: "Investor Capital",
        creditAccount: "Cash/Bank Settlement",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.capitalAmountPkr || request.amountPkr,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: "full_exit_capital_portion",
        reconciliationReference: request.reference,
      });
      addPosting(entries, {
        debitAccount: "Investor Profit Payable",
        creditAccount: "Cash/Bank Settlement",
        participantId: request.participantId,
        participantName: request.participantName,
        amountPkr: request.profitAmountPkr || 0,
        sourceFinalizationPeriod,
        sourcePool,
        sourceAttributionLine,
        postingType: "full_exit_profit_portion",
        reconciliationReference: request.reference,
      });
    }
  }

  const totalDebitsPkr = round2(entries.reduce((sum, entry) => sum + entry.amountPkr, 0));
  const totalCreditsPkr = round2(entries.reduce((sum, entry) => sum + entry.amountPkr, 0));
  const postingSetResultPkr = round2(input.proposedBalanceEffects.reduce((sum, row) => sum + row.netEffectPkr, 0));
  const finalizationSnapshotResultPkr = round2(input.attribution.totalAttributedPkr);
  const historicalAttributionResultPkr = round2(input.historicalPoolPreview.aggregateReconciliation.finalRecipientAttributionPkr);
  const financialReportResultPkr = round2(input.attribution.totalBusinessProfitPkr);

  return {
    dryRunOnly: true as const,
    chain: "Financial Report → Historical Pool → Investor Attribution → Finalization Snapshot → Proposed Postings" as const,
    entries,
    reconciliation: {
      totalDebitsPkr,
      totalCreditsPkr,
      debitCreditDifferencePkr: round2(totalDebitsPkr - totalCreditsPkr),
      postingSetResultPkr,
      finalizationSnapshotResultPkr,
      historicalAttributionResultPkr,
      financialReportResultPkr,
      postingToSnapshotDifferencePkr: round2(postingSetResultPkr - finalizationSnapshotResultPkr),
      snapshotToHistoricalDifferencePkr: round2(finalizationSnapshotResultPkr - historicalAttributionResultPkr),
      historicalToFinancialReportDifferencePkr: round2(historicalAttributionResultPkr - financialReportResultPkr),
    },
  };
}

export function buildFinalizationDryRun(input: {
  attribution: AttributionPreview;
  historicalPoolPreview: HistoricalPoolPreview;
  readinessBlockers?: string[];
  missingRates?: string[];
  unsupportedFxPositions?: UnsupportedFxPosition[];
  existingFinalizations?: ExistingFinalizationRecord[];
  sourceChangesAfterFinalization?: SourceChangeSignal[];
  postingSimulationRequests?: PostingSimulationRequest[];
  sourceReportReference?: string;
}): FinalizationDryRun {
  const periodStart = input.attribution.periodStart;
  const periodEnd = input.attribution.periodEnd;
  const blockers: FinalizationDryRun["blockers"] = [];
  const warnings: string[] = [];

  if (input.attribution.reconciliationDifferencePkr !== 0) {
    addBlocker(blockers, "BLOCKED_RECONCILIATION", "Attribution reconciliation difference must be exactly zero.");
  }
  if (input.historicalPoolPreview.aggregateReconciliation.reconciliationDifferencePkr !== 0) {
    addBlocker(blockers, "BLOCKED_RESIDUAL_RECONCILIATION", "Historical-pool residual reconciliation difference must be exactly zero.");
  }
  for (const rate of input.missingRates || []) {
    addBlocker(blockers, "BLOCKED_MISSING_FX", rate);
  }
  for (const reason of input.historicalPoolPreview.blockedReasons || []) {
    if (reason.startsWith("Missing ")) addBlocker(blockers, "BLOCKED_MISSING_FX", reason);
    else addBlocker(blockers, "BLOCKED_HISTORICAL_POOL", reason);
  }
  for (const segment of input.attribution.segments) {
    if (segment.totalCapitalPkr <= 0) {
      addBlocker(blockers, "BLOCKED_CAPITAL_SEGMENTS", `No participating capital for ${segment.segmentStart} to ${segment.segmentEnd}.`);
    }
    for (const line of segment.lines) {
      const totalShare = round2(Number(line.investorProfitSharePercent || 0) + Number(line.managerProfitSharePercent || 0));
      if (line.participantType !== "manager" && totalShare !== 100) {
        addBlocker(blockers, "BLOCKED_PROFIT_SHARE", `${line.participantName} profit-share ratio totals ${totalShare}, not 100.`);
      }
    }
  }
  for (const unsupported of input.unsupportedFxPositions || []) {
    if (unsupported.material !== false) {
      addBlocker(blockers, "BLOCKED_UNSUPPORTED_FX", `${unsupported.sourcePosition}: ${unsupported.reason}`);
    }
  }
  for (const existing of input.existingFinalizations || []) {
    if (samePeriod(existing, periodStart, periodEnd) && existing.status === "FINALIZED") {
      addBlocker(blockers, "BLOCKED_DUPLICATE_FINALIZATION", "This period already has a finalized snapshot; use reversal/corrected finalization workflow.");
    }
  }
  for (const sourceChange of input.sourceChangesAfterFinalization || []) {
    addBlocker(
      blockers,
      "POST_FINALIZATION_ADJUSTMENT_REQUIRED",
      `${sourceChange.sourceType}:${sourceChange.sourceId} changed after finalization — ${sourceChange.reason}`
    );
  }
  for (const reason of input.readinessBlockers || []) {
    if (/data-integrity|legacy|invalid/i.test(reason)) addBlocker(blockers, "BLOCKED_DATA_INTEGRITY", reason);
    else warnings.push(reason);
  }

  const residualByManager = new Map<string, number>();
  for (const residual of input.historicalPoolPreview.residualTransfers) {
    residualByManager.set(
      residual.managerParticipantId,
      round2((residualByManager.get(residual.managerParticipantId) || 0) + residual.managerAssumptionPkr)
    );
  }

  const proposedBalanceEffects = input.attribution.participantSummary.map((participant) => {
    const managerExitedInvestorResidualPkr = residualByManager.get(participant.participantId) || 0;
    const investorEntitlementPkr = participant.participantType === "manager" ? 0 : participant.investorEntitlementPkr;
    const netEffect = round2(
      investorEntitlementPkr +
      participant.managerSharePkr +
      participant.managerOwnCapitalProfitPkr +
      managerExitedInvestorResidualPkr
    );
    return {
      participantId: participant.participantId,
      participantName: participant.participantName,
      participantType: participant.participantType,
      investorEntitlementPkr: round2(investorEntitlementPkr),
      managerOwnCapitalResultPkr: round2(participant.managerOwnCapitalProfitPkr),
      managerProfitSharePkr: round2(participant.managerSharePkr),
      managerExitedInvestorResidualPkr,
      lossAllocationPkr: round2(participant.allocatedLossPkr),
      netEffectPkr: netEffect,
    };
  });
  const postingSimulation = buildPostingSimulation({
    attribution: input.attribution,
    historicalPoolPreview: input.historicalPoolPreview,
    proposedBalanceEffects,
    requests: input.postingSimulationRequests,
  });
  if (postingSimulation.reconciliation.debitCreditDifferencePkr !== 0) {
    addBlocker(blockers, "BLOCKED_RESIDUAL_RECONCILIATION", "Simulated posting debits and credits must be equal.");
  }
  if (
    postingSimulation.reconciliation.postingToSnapshotDifferencePkr !== 0 ||
    postingSimulation.reconciliation.snapshotToHistoricalDifferencePkr !== 0 ||
    postingSimulation.reconciliation.historicalToFinancialReportDifferencePkr !== 0
  ) {
    addBlocker(blockers, "BLOCKED_RECONCILIATION", "Finalization preview reconciliation chain must be exactly zero at every layer.");
  }

  return {
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    finalizationButtonEnabled: false,
    periodStart,
    periodEnd,
    blockers,
    warnings,
    snapshotDesign: {
      immutable: true,
      tables: [
        "InvestorAttributionFinalization",
        "InvestorAttributionFinalizationPoolSnapshot",
        "InvestorAttributionFinalizationParticipantSnapshot",
        "InvestorAttributionFinalizationSourceSnapshot",
        "InvestorAttributionFinalizationFxSnapshot",
        "InvestorAttributionFinalizationResidualSnapshot",
        "InvestorAttributionFinalizationReversal",
      ],
      fields: [
        "source financial report result/reference",
        "participant IDs/capital/profit-share ratios",
        "historical pool IDs/source adjustment IDs",
        "FX position IDs/rates/provider/reference/conversion path",
        "investor entitlement/manager share/loss/residual attribution",
        "reconciliation difference/finalized user/timestamp",
      ],
      correctionWorkflow: "Original Finalization → Reversal → Corrected Finalization",
    },
    frozenPreview: {
      sourceFinancialReportResultPkr: round2(input.attribution.totalBusinessProfitPkr),
      sourceReportReference: input.sourceReportReference || `financial-report:${periodStart}:${periodEnd}`,
      historicalPoolCount: input.historicalPoolPreview.pools.length,
      transactionLinkCount: input.historicalPoolPreview.transactionLinks.length,
      residualTransferCount: input.historicalPoolPreview.residualTransfers.length,
      reconciliationDifferencePkr: round2(input.attribution.reconciliationDifferencePkr + input.historicalPoolPreview.aggregateReconciliation.reconciliationDifferencePkr),
    },
    proposedBalanceEffects,
    proposedPostingDesign: [
      { ledger: "Investor Profit Ledger", event: "finalized profit entitlement", dryRunOnly: true, description: "Credit investor entitlement from recognized profit; no business expense is created." },
      { ledger: "Investor Capital Ledger", event: "finalized capital loss", dryRunOnly: true, description: "Debit capital for genuine loss by participating capital ratio." },
      { ledger: "Manager Profit Share Ledger", event: "manager profit share", dryRunOnly: true, description: "Credit manager share from investor split separately from manager own-capital profit." },
      { ledger: "Residual Attribution Ledger", event: "exited-investor residual gain/loss", dryRunOnly: true, description: "Transfer exited investor residual gain/loss symmetrically to manager." },
      { ledger: "Investor Profit Ledger", event: "profit withdrawal", dryRunOnly: true, description: "Debit investor profit balance when paid, not business expense." },
      { ledger: "Investor Capital Ledger", event: "capital withdrawal/full exit/profit reinvestment", dryRunOnly: true, description: "Classify withdrawal between capital and profit; reinvestment increases capital from approved profit balance." },
    ],
    postingSimulation,
    reversalDesign: {
      directEditAllowed: false,
      workflow: "Original Finalization → Reversal → Corrected Finalization",
      preservesOriginalSnapshot: true,
    },
    concurrencyDesign: {
      idempotencyKey: `investor-finalization:${periodStart}:${periodEnd}`,
      uniquenessRules: [
        "unique finalized active period snapshot on period_start + period_end",
        "unique source snapshot per finalization + source_type + source_id",
        "unique participant snapshot per finalization + participant_id",
        "unique residual snapshot per finalization + source_type + source_id + original_participant_id",
      ],
      transactionRules: [
        "acquire period-scoped advisory lock before future finalization",
        "insert idempotency row before snapshot creation",
        "write all snapshots and future postings in one serializable transaction",
        "reversal creates a new record and never edits the original finalized snapshot",
      ],
    },
  };
}
