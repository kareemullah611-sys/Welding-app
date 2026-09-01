import test from "node:test";
import assert from "node:assert/strict";
import { buildFinalizationDryRun } from "./investor-finalization-dry-run";
import { buildHistoricalFxTransaction, buildHistoricalPoolPreview } from "./historical-pool-attribution";
import {
  buildInvestorAttributionPreview,
  type AttributionCapitalEvent,
} from "./investor-attribution";

const baseCapital: AttributionCapitalEvent[] = [
  { participantId: "manager", participantName: "Manager", participantType: "manager", effectiveDate: "2026-01-01", amountPkr: 10_000_000, eventType: "opening" },
  { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 50_000_000, eventType: "opening", investorProfitSharePercent: 50 },
  { participantId: "b", participantName: "Investor B", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 20_000_000, eventType: "opening", investorProfitSharePercent: 33.333333 },
];

async function makePreview(input?: {
  capitalEvents?: AttributionCapitalEvent[];
  profit?: number;
  missingRates?: string[];
  historicalTransactions?: Parameters<typeof buildHistoricalPoolPreview>[0]["transactions"];
}) {
  const capitalEvents = input?.capitalEvents || baseCapital;
  const attribution = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents,
    missingRequiredRates: input?.missingRates,
    getBusinessResult: async () => ({ netBusinessProfitPkr: input?.profit ?? 2_300_000 }),
  });
  const historicalPoolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents,
    transactions: input?.historicalTransactions || [{
      sourceType: "sale_profit",
      sourceId: "sale-1",
      recognizedDate: "2026-01-10",
      originalPoolDate: "2026-01-10",
      amountPkr: attribution.totalBusinessProfitPkr,
    }],
  });
  return { attribution, historicalPoolPreview };
}

test("phase 2 dry run marks reconciled supported period ready without enabling live button", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.equal(dryRun.status, "READY");
  assert.equal(dryRun.finalizationButtonEnabled, false);
  assert.equal(dryRun.frozenPreview.sourceFinancialReportResultPkr, 2_300_000);
  assert.equal(dryRun.frozenPreview.reconciliationDifferencePkr, 0);
  assert.ok(dryRun.snapshotDesign.immutable);
});

test("phase 2 dry run blocks reconciliation differences", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  attribution.reconciliationDifferencePkr = 1;
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.equal(dryRun.status, "BLOCKED");
  assert.ok(dryRun.blockers.some((blocker) => blocker.code === "BLOCKED_RECONCILIATION"));
});

test("phase 2 dry run blocks missing FX rates", async () => {
  const { attribution, historicalPoolPreview } = await makePreview({
    missingRates: ["Missing USD→PKR fallback rate for Afghanistan on 2026-01-15."],
  });
  const dryRun = buildFinalizationDryRun({
    attribution,
    historicalPoolPreview,
    missingRates: ["Missing USD→PKR fallback rate for Afghanistan on 2026-01-15."],
  });

  assert.equal(dryRun.status, "BLOCKED");
  assert.ok(dryRun.blockers.some((blocker) => blocker.code === "BLOCKED_MISSING_FX"));
});

test("phase 2 dry run blocks unsupported AFN and RMB positions", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({
    attribution,
    historicalPoolPreview,
    unsupportedFxPositions: [
      { sourcePosition: "intermediary_deposit:1", currencyCode: "AFN", foreignAmount: 10_000, date: "2026-01-10", reason: "No remaining balance layer." },
      { sourcePosition: "intermediary_deposit:2", currencyCode: "RMB", foreignAmount: 20_000, date: "2026-01-10", reason: "No remaining balance layer." },
    ],
  });

  assert.equal(dryRun.status, "BLOCKED");
  assert.equal(dryRun.blockers.filter((blocker) => blocker.code === "BLOCKED_UNSUPPORTED_FX").length, 2);
});

test("phase 2 dry run preserves 50/50 1/3 and 100/0 profit-share outcomes", async () => {
  const capitalEvents: AttributionCapitalEvent[] = [
    ...baseCapital,
    { participantId: "c", participantName: "Investor C", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 20_000_000, eventType: "opening", investorProfitSharePercent: 100 },
  ];
  const { attribution, historicalPoolPreview } = await makePreview({ capitalEvents, profit: 1_000_000 });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });
  const investorA = dryRun.proposedBalanceEffects.find((row) => row.participantId === "a")!;
  const investorB = dryRun.proposedBalanceEffects.find((row) => row.participantId === "b")!;
  const investorC = dryRun.proposedBalanceEffects.find((row) => row.participantId === "c")!;

  assert.equal(investorA.investorEntitlementPkr, 250_000);
  assert.equal(investorA.managerProfitSharePkr, 250_000);
  assert.equal(investorB.investorEntitlementPkr, 66_666.67);
  assert.equal(investorB.managerProfitSharePkr, 133_333.33);
  assert.equal(investorC.investorEntitlementPkr, 200_000);
  assert.equal(investorC.managerProfitSharePkr, 0);
});

test("phase 2 dry run treats actual loss by capital ratio only", async () => {
  const { attribution, historicalPoolPreview } = await makePreview({ profit: -800_000 });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });
  const investorA = dryRun.proposedBalanceEffects.find((row) => row.participantId === "a")!;

  assert.equal(investorA.lossAllocationPkr, -500_000);
  assert.equal(investorA.managerProfitSharePkr, 0);
});

test("phase 2 dry run handles partial withdrawal and full exit segments", async () => {
  const capitalEvents: AttributionCapitalEvent[] = [
    ...baseCapital,
    { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-01-10", amountPkr: -20_000_000, eventType: "capital_withdrawal", investorProfitSharePercent: 50 },
    { participantId: "b", participantName: "Investor B", participantType: "investor", effectiveDate: "2026-01-20", amountPkr: -20_000_000, eventType: "full_exit", investorProfitSharePercent: 33.333333 },
  ];
  const { attribution, historicalPoolPreview } = await makePreview({ capitalEvents, profit: 600_000 });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.equal(attribution.segments.length, 3);
  assert.equal(dryRun.status, "READY");
});

test("phase 2 dry run separates exited residual gain and loss from manager own capital", async () => {
  const capitalEvents: AttributionCapitalEvent[] = [
    ...baseCapital,
    { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: -50_000_000, eventType: "full_exit", investorProfitSharePercent: 50 },
  ];
  const attribution = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents,
    getBusinessResult: async () => ({ netBusinessProfitPkr: 0 }),
  });
  const historicalPoolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents,
    transactions: [
      { sourceType: "recovery", sourceId: "gain", recognizedDate: "2026-02-10", originalPoolDate: "2026-01-10", amountPkr: 800_000 },
      { sourceType: "default", sourceId: "loss", recognizedDate: "2026-02-11", originalPoolDate: "2026-01-10", amountPkr: -400_000 },
    ],
  });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });
  const manager = dryRun.proposedBalanceEffects.find((row) => row.participantId === "manager")!;

  assert.equal(manager.managerOwnCapitalResultPkr, 0);
  assert.equal(manager.managerExitedInvestorResidualPkr, 250_000);
});

test("phase 2 dry run blocks duplicate finalized period", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({
    attribution,
    historicalPoolPreview,
    existingFinalizations: [{ periodStart: "2026-01-01", periodEnd: "2026-01-31", status: "FINALIZED", finalizedAt: "2026-02-01T00:00:00.000Z" }],
  });

  assert.equal(dryRun.status, "BLOCKED");
  assert.ok(dryRun.blockers.some((blocker) => blocker.code === "BLOCKED_DUPLICATE_FINALIZATION"));
});

test("phase 2 dry run snapshot design is immutable against later provider changes", async () => {
  const { attribution, historicalPoolPreview } = await makePreview({
    historicalTransactions: [buildHistoricalFxTransaction({
      sourceId: "usd-layer",
      sourcePosition: "USD layer",
      recognizedDate: "2026-01-31",
      originalPoolDate: "2026-01-10",
      currencyCode: "USD",
      foreignAmount: 1_000,
      carryingRate: 270,
      valuationRate: 280,
      valuationDate: "2026-01-31",
      provider: "MANUAL_OPEN_MARKET",
    })],
  });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.equal(dryRun.snapshotDesign.immutable, true);
  assert.ok(dryRun.snapshotDesign.fields.some((field) => field.includes("FX position IDs/rates/provider/reference")));
});

test("phase 2 dry run detects post-finalization source adjustment requirement", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({
    attribution,
    historicalPoolPreview,
    sourceChangesAfterFinalization: [{ sourceType: "sale", sourceId: 10, changedAt: "2026-02-05", reason: "sale discount edited" }],
  });

  assert.equal(dryRun.status, "BLOCKED");
  assert.ok(dryRun.blockers.some((blocker) => blocker.code === "POST_FINALIZATION_ADJUSTMENT_REQUIRED"));
});

test("phase 2 dry run exposes reversal and concurrency design", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.equal(dryRun.reversalDesign.directEditAllowed, false);
  assert.equal(dryRun.reversalDesign.workflow, "Original Finalization → Reversal → Corrected Finalization");
  assert.ok(dryRun.concurrencyDesign.uniquenessRules.some((rule) => rule.includes("unique finalized active period")));
  assert.ok(dryRun.concurrencyDesign.transactionRules.some((rule) => rule.includes("advisory lock")));
});

test("phase 2.1 posting simulation balances debits and credits through the full reconciliation chain", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.equal(dryRun.postingSimulation.dryRunOnly, true);
  assert.equal(dryRun.postingSimulation.chain, "Financial Report → Historical Pool → Investor Attribution → Finalization Snapshot → Proposed Postings");
  assert.equal(dryRun.postingSimulation.reconciliation.debitCreditDifferencePkr, 0);
  assert.equal(dryRun.postingSimulation.reconciliation.postingToSnapshotDifferencePkr, 0);
  assert.equal(dryRun.postingSimulation.reconciliation.snapshotToHistoricalDifferencePkr, 0);
  assert.equal(dryRun.postingSimulation.reconciliation.historicalToFinancialReportDifferencePkr, 0);
});

test("phase 2.1 posting simulation includes manager own-capital and manager profit-share postings", async () => {
  const { attribution, historicalPoolPreview } = await makePreview({ profit: 1_000_000 });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });
  const postingTypes = dryRun.postingSimulation.entries.map((entry) => entry.postingType);

  assert.ok(postingTypes.includes("manager_own_capital_profit"));
  assert.ok(postingTypes.includes("manager_profit_share"));
});

test("phase 2.1 posting simulation includes exited residual gain and loss postings", async () => {
  const capitalEvents: AttributionCapitalEvent[] = [
    ...baseCapital,
    { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: -50_000_000, eventType: "full_exit", investorProfitSharePercent: 50 },
  ];
  const attribution = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents,
    getBusinessResult: async () => ({ netBusinessProfitPkr: 0 }),
  });
  const gainPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents,
    transactions: [{ sourceType: "recovery", sourceId: "gain", recognizedDate: "2026-02-10", originalPoolDate: "2026-01-10", amountPkr: 800_000 }],
  });
  const lossPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents,
    transactions: [{ sourceType: "default", sourceId: "loss", recognizedDate: "2026-02-10", originalPoolDate: "2026-01-10", amountPkr: -800_000 }],
  });

  assert.ok(buildFinalizationDryRun({ attribution, historicalPoolPreview: gainPreview }).postingSimulation.entries.some((entry) => entry.postingType === "exited_residual_gain"));
  assert.ok(buildFinalizationDryRun({ attribution, historicalPoolPreview: lossPreview }).postingSimulation.entries.some((entry) => entry.postingType === "exited_residual_loss"));
});

test("phase 2.1 posting simulation includes investor capital loss postings", async () => {
  const { attribution, historicalPoolPreview } = await makePreview({ profit: -1_000_000 });
  const dryRun = buildFinalizationDryRun({ attribution, historicalPoolPreview });

  assert.ok(dryRun.postingSimulation.entries.some((entry) => entry.postingType === "investor_capital_loss"));
});

test("phase 2.1 posting simulation supports partial withdrawal full exit and reinvestment requests", async () => {
  const { attribution, historicalPoolPreview } = await makePreview();
  const dryRun = buildFinalizationDryRun({
    attribution,
    historicalPoolPreview,
    postingSimulationRequests: [
      { postingType: "investor_profit_withdrawal", participantId: "a", participantName: "Investor A", amountPkr: 100_000, reference: "withdraw-profit" },
      { postingType: "capital_withdrawal", participantId: "a", participantName: "Investor A", amountPkr: 200_000, reference: "withdraw-capital" },
      { postingType: "mixed_withdrawal", participantId: "b", participantName: "Investor B", amountPkr: 300_000, profitAmountPkr: 125_000, capitalAmountPkr: 175_000, reference: "withdraw-mixed" },
      { postingType: "profit_reinvestment", participantId: "b", participantName: "Investor B", amountPkr: 400_000, reference: "reinvest" },
      { postingType: "full_exit", participantId: "b", participantName: "Investor B", amountPkr: 500_000, capitalAmountPkr: 450_000, profitAmountPkr: 50_000, reference: "full-exit" },
    ],
  });
  const postingTypes = dryRun.postingSimulation.entries.map((entry) => entry.postingType);

  assert.ok(postingTypes.includes("investor_profit_withdrawal"));
  assert.ok(postingTypes.includes("capital_withdrawal"));
  assert.ok(postingTypes.includes("mixed_withdrawal_profit_portion"));
  assert.ok(postingTypes.includes("mixed_withdrawal_capital_portion"));
  assert.ok(postingTypes.includes("profit_reinvestment"));
  assert.ok(postingTypes.includes("full_exit_capital_portion"));
  assert.ok(postingTypes.includes("full_exit_profit_portion"));
  assert.equal(dryRun.postingSimulation.reconciliation.debitCreditDifferencePkr, 0);
});
