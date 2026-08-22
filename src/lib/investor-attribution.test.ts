import test from "node:test";
import assert from "node:assert/strict";
import { assertProfitShareTotal } from "./investment-participation";
import { buildLegacyInvestorCapitalReview } from "./legacy-investor-capital-review";
import { buildHistoricalFxTransaction, buildHistoricalPoolPreview } from "./historical-pool-attribution";
import {
  buildInvestorAttributionPreview,
  type AttributionCapitalEvent,
  type AttributionProfitShareEvent,
} from "./investor-attribution";

const baseEvents: AttributionCapitalEvent[] = [
  {
    participantId: "manager",
    participantName: "Manager",
    participantType: "manager",
    effectiveDate: "2026-01-01",
    amountPkr: 10_000_000,
    eventType: "opening",
  },
  {
    participantId: "a",
    participantName: "Investor A",
    participantType: "investor",
    effectiveDate: "2026-01-01",
    amountPkr: 50_000_000,
    eventType: "opening",
    investorProfitSharePercent: 50,
  },
  {
    participantId: "b",
    participantName: "Investor B",
    participantType: "investor",
    effectiveDate: "2026-01-01",
    amountPkr: 20_000_000,
    eventType: "opening",
    investorProfitSharePercent: 33.333333,
  },
];

test("attributes 80m capital pool profit without creating guaranteed returns", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    getBusinessResult: async () => ({ netBusinessProfitPkr: 2_300_000 }),
  });

  const manager = preview.participantSummary.find((row) => row.participantId === "manager")!;
  const investorA = preview.participantSummary.find((row) => row.participantId === "a")!;
  const investorB = preview.participantSummary.find((row) => row.participantId === "b")!;

  assert.equal(preview.reconciliationStatus, "RECONCILED");
  assert.equal(preview.reconciliationDifferencePkr, 0);
  assert.equal(investorA.investorEntitlementPkr, 718_750);
  assert.equal(investorA.managerSharePkr, 718_750);
  assert.equal(investorB.investorEntitlementPkr, 191_666.66);
  assert.equal(investorB.managerSharePkr, 383_333.34);
  assert.equal(manager.investorEntitlementPkr, 287_500);
  assert.equal(manager.managerOwnCapitalProfitPkr, 287_500);
  assert.equal(preview.totalManagerOwnCapitalProfitPkr, 287_500);
  assert.equal(preview.totalManagerSharePkr, 1_102_083.34);
  assert.equal(preview.totalAttributedPkr, 2_300_000);
  assert.equal(preview.finalizationEnabled, false);
});

test("allocates losses by capital and ignores profit-sharing percentages", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    getBusinessResult: async () => ({ netBusinessProfitPkr: -8_000_000 }),
  });

  const manager = preview.participantSummary.find((row) => row.participantId === "manager")!;
  const investorA = preview.participantSummary.find((row) => row.participantId === "a")!;
  const investorB = preview.participantSummary.find((row) => row.participantId === "b")!;

  assert.equal(preview.reconciliationStatus, "RECONCILED");
  assert.equal(manager.allocatedLossPkr, -1_000_000);
  assert.equal(investorA.allocatedLossPkr, -5_000_000);
  assert.equal(investorB.allocatedLossPkr, -2_000_000);
  assert.equal(investorA.managerSharePkr, 0);
  assert.equal(investorB.managerSharePkr, 0);
});

test("splits attribution into capital-effective segments after withdrawal", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: [
      ...baseEvents,
      {
        participantId: "a",
        participantName: "Investor A",
        participantType: "investor",
        effectiveDate: "2026-01-16",
        amountPkr: -20_000_000,
        eventType: "capital_withdrawal",
        investorProfitSharePercent: 50,
      },
    ],
    getBusinessResult: async (segmentStart) => ({
      netBusinessProfitPkr: segmentStart === "2026-01-01" ? 800_000 : 600_000,
    }),
  });

  assert.equal(preview.segments.length, 2);
  assert.equal(preview.segments[0].totalCapitalPkr, 80_000_000);
  assert.equal(preview.segments[1].totalCapitalPkr, 60_000_000);
  assert.equal(preview.totalBusinessProfitPkr, 1_400_000);
  assert.equal(preview.totalAttributedPkr, 1_400_000);
  assert.equal(preview.reconciliationStatus, "RECONCILED");
});

test("supports a 100 percent investor split without manager share", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: [
      {
        participantId: "manager",
        participantName: "Manager",
        participantType: "manager",
        effectiveDate: "2026-01-01",
        amountPkr: 10_000_000,
        eventType: "opening",
      },
      {
        participantId: "c",
        participantName: "Investor C",
        participantType: "investor",
        effectiveDate: "2026-01-01",
        amountPkr: 10_000_000,
        eventType: "opening",
        investorProfitSharePercent: 100,
      },
    ],
    getBusinessResult: async () => ({ netBusinessProfitPkr: 200_000 }),
  });

  const investor = preview.participantSummary.find((row) => row.participantId === "c")!;
  assert.equal(investor.investorEntitlementPkr, 100_000);
  assert.equal(investor.managerSharePkr, 0);
  assert.equal(preview.reconciliationStatus, "RECONCILED");
});

test("date-effective share events keep old segments on old ratios", async () => {
  const shareEvents: AttributionProfitShareEvent[] = [
    { participantId: "a", effectiveDate: "2026-01-16", investorProfitSharePercent: 100, managerProfitSharePercent: 0 },
  ];
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    profitShareEvents: shareEvents,
    getBusinessResult: async (segmentStart) => ({
      netBusinessProfitPkr: segmentStart === "2026-01-01" ? 800_000 : 800_000,
    }),
  });

  const investorAFirstSegment = preview.segments[0].lines.find((line) => line.participantId === "a")!;
  const investorASecondSegment = preview.segments[1].lines.find((line) => line.participantId === "a")!;
  assert.equal(investorAFirstSegment.investorProfitSharePercent, 50);
  assert.equal(investorAFirstSegment.managerProfitSharePercent, 50);
  const investorBFirstSegment = preview.segments[0].lines.find((line) => line.participantId === "b")!;
  assert.equal(investorBFirstSegment.investorProfitSharePercent, 33.333333);
  assert.equal(investorBFirstSegment.managerProfitSharePercent, 66.666667);
  assert.equal(investorASecondSegment.investorProfitSharePercent, 100);
  assert.equal(investorASecondSegment.managerProfitSharePercent, 0);
  assert.equal(preview.reconciliationStatus, "RECONCILED");
});

test("capital addition and profit reinvestment create new participation segments", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: [
      ...baseEvents,
      {
        participantId: "b",
        participantName: "Investor B",
        participantType: "investor",
        effectiveDate: "2026-01-11",
        amountPkr: 10_000_000,
        eventType: "capital_contribution",
        investorProfitSharePercent: 33.333333,
      },
      {
        participantId: "a",
        participantName: "Investor A",
        participantType: "investor",
        effectiveDate: "2026-01-21",
        amountPkr: 5_000_000,
        eventType: "profit_reinvestment",
        investorProfitSharePercent: 50,
      },
    ],
    getBusinessResult: async () => ({ netBusinessProfitPkr: 300_000 }),
  });

  assert.equal(preview.segments.length, 3);
  assert.equal(preview.segments[0].totalCapitalPkr, 80_000_000);
  assert.equal(preview.segments[1].totalCapitalPkr, 90_000_000);
  assert.equal(preview.segments[2].totalCapitalPkr, 95_000_000);
  assert.equal(preview.reconciliationStatus, "RECONCILED");
});

test("full exit removes a participant from later attribution segments", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: [
      ...baseEvents,
      {
        participantId: "b",
        participantName: "Investor B",
        participantType: "investor",
        effectiveDate: "2026-01-16",
        amountPkr: -20_000_000,
        eventType: "full_exit",
        investorProfitSharePercent: 33.333333,
      },
    ],
    getBusinessResult: async () => ({ netBusinessProfitPkr: 500_000 }),
  });

  assert.ok(preview.segments[0].lines.some((line) => line.participantId === "b"));
  assert.ok(!preview.segments[1].lines.some((line) => line.participantId === "b"));
  assert.equal(preview.segments[1].totalCapitalPkr, 60_000_000);
  assert.equal(preview.reconciliationStatus, "RECONCILED");
});

test("missing FX rates block finalization preview without guessing", async () => {
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    missingRequiredRates: ["Missing USD→PKR fallback rate for Afghanistan on 2026-01-15 (sale)."],
    getBusinessResult: async () => ({ netBusinessProfitPkr: 100_000 }),
  });

  assert.equal(preview.finalizationEnabled, false);
  assert.ok(preview.finalizationDisabledReasons.includes("Missing USD→PKR fallback rate for Afghanistan on 2026-01-15 (sale)."));
});

test("validates investor and manager profit share totals", () => {
  assert.equal(assertProfitShareTotal(50, 50).ok, true);
  assert.equal(assertProfitShareTotal(33.333333, 66.666667).ok, true);
  assert.equal(assertProfitShareTotal(100, 0).ok, true);
  assert.equal(assertProfitShareTotal(80, 10).ok, false);
});

test("recognized financial report profit is attributed regardless of customer collection", async () => {
  const cartonCostPkr = 800;
  const saleAmountPkr = 1_000;
  const customerCollectedPkr = 0;
  const preview = await buildInvestorAttributionPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    getBusinessResult: async () => ({
      netBusinessProfitPkr: saleAmountPkr - cartonCostPkr,
    }),
  });

  assert.equal(customerCollectedPkr, 0);
  assert.equal(preview.totalBusinessProfitPkr, 200);
  assert.equal(preview.totalAttributedPkr, 200);
  assert.equal(preview.reconciliationDifferencePkr, 0);
  assert.equal(preview.participantSummary.reduce((sum, row) => sum + row.totalAttributedPkr, 0), 200);
  assert.equal(preview.finalizationDisabledReasons.some((reason) => reason.toLowerCase().includes("collection")), false);
});

test("legacy capital review shows implied opening candidates without converting them", () => {
  const review = buildLegacyInvestorCapitalReview([
    {
      investorId: 1,
      investorName: "Legacy Investor",
      accountId: 10,
      currencyCode: "PKR",
      accountStartDate: "2025-01-01",
      profitType: "profit_share",
      profitSharePercent: 50,
      transactions: [
        { id: 1, type: "deposit", date: "2025-01-01", amountPkr: 1_000_000 },
        { id: 2, type: "withdrawal", date: "2025-02-01", amountPkr: 250_000 },
      ],
    },
    {
      investorId: 2,
      investorName: "Dollar Legacy",
      accountId: 20,
      currencyCode: "USD",
      accountStartDate: "2025-01-01",
      profitType: "fixed_rate",
      fixedRatePercent: 12,
      transactions: [{ id: 3, type: "deposit", date: "2025-01-10", amountPkr: 500 }],
    },
  ]);

  assert.equal(review.summary.accountCount, 2);
  assert.equal(review.summary.proposedOpeningCapitalPkr, 750_000);
  assert.equal(review.rows[0].legacySourceLabel, "Derived from legacy investor transactions");
  assert.equal(review.rows[0].impliedCapitalPkr, 750_000);
  assert.equal(review.rows[0].proposedOpeningCapitalPkr, 750_000);
  assert.equal(review.rows[0].managerProfitSharePercent, 50);
  assert.equal(review.rows[0].capitalEventCandidates[1].amountPkr, -250_000);
  assert.equal(review.rows[1].proposedOpeningCapitalPkr, null);
  assert.match(review.rows[1].ambiguities.join(" "), /not auto-converted/);
  assert.match(review.rows[1].ambiguities.join(" "), /fixed-rate/);
});

test("historical pools keep later adjustments attached to the original pool", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: [
      ...baseEvents,
      {
        participantId: "new",
        participantName: "New Investor",
        participantType: "investor",
        effectiveDate: "2026-01-20",
        amountPkr: 20_000_000,
        eventType: "opening",
        investorProfitSharePercent: 100,
      },
    ],
    transactions: [
      {
        sourceType: "sale_profit",
        sourceId: "sale-1",
        recognizedDate: "2026-01-10",
        originalPoolDate: "2026-01-10",
        amountPkr: 200,
      },
      {
        sourceType: "discount",
        sourceId: "discount-1",
        recognizedDate: "2026-01-25",
        originalPoolDate: "2026-01-10",
        amountPkr: -50,
      },
    ],
  });

  const saleLink = poolPreview.transactionLinks.find((link) => link.sourceId === "sale-1")!;
  const discountLink = poolPreview.transactionLinks.find((link) => link.sourceId === "discount-1")!;

  assert.equal(poolPreview.pools.length, 2);
  assert.equal(saleLink.poolId, discountLink.poolId);
  assert.equal(discountLink.poolSegmentStart, "2026-01-01");
  assert.ok(!discountLink.attribution.some((line) => line.participantId === "new"));
  assert.equal(poolPreview.blockedReasons.length, 0);
});

test("historical pool preview links FX gain/loss to relevant old pool", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    transactions: [{
      sourceType: "fx_gain_loss",
      sourceId: "fx-1",
      recognizedDate: "2026-01-25",
      originalPoolDate: "2026-01-05",
      amountPkr: -300,
    }],
  });

  const fxLink = poolPreview.transactionLinks[0];
  assert.equal(fxLink.poolSegmentStart, "2026-01-01");
  assert.equal(fxLink.amountPkr, -300);
  assert.equal(fxLink.attribution.reduce((sum, line) => sum + line.attributablePkr, 0), -300);
});

test("exited investor residual gain or loss is assumed by manager symmetrically", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents: [
      ...baseEvents,
      {
        participantId: "b",
        participantName: "Investor B",
        participantType: "investor",
        effectiveDate: "2026-02-01",
        amountPkr: -20_000_000,
        eventType: "full_exit",
        investorProfitSharePercent: 33.333333,
      },
    ],
    transactions: [
      {
        sourceType: "recovery",
        sourceId: "recovery-1",
        recognizedDate: "2026-02-10",
        originalPoolDate: "2026-01-10",
        amountPkr: 800,
      },
      {
        sourceType: "default",
        sourceId: "default-1",
        recognizedDate: "2026-02-11",
        originalPoolDate: "2026-01-10",
        amountPkr: -800,
      },
    ],
  });

  const positiveResidual = poolPreview.residualTransfers.find((row) => row.sourceId === "recovery-1" && row.originalParticipantId === "b")!;
  const negativeResidual = poolPreview.residualTransfers.find((row) => row.sourceId === "default-1" && row.originalParticipantId === "b")!;

  assert.equal(positiveResidual.managerParticipantId, "manager");
  assert.equal(positiveResidual.managerAssumptionPkr, 200);
  assert.equal(negativeResidual.managerParticipantId, "manager");
  assert.equal(negativeResidual.managerAssumptionPkr, -200);
});

test("phase 1.4 FX gain and loss reconcile with all original participants active", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    transactions: [
      buildHistoricalFxTransaction({
        sourceId: "usd-gain",
        sourcePosition: "USD receivable 1",
        recognizedDate: "2026-01-31",
        originalPoolDate: "2026-01-05",
        currencyCode: "USD",
        foreignAmount: 10_000,
        carryingRate: 280,
        valuationRate: 290,
        valuationDate: "2026-01-31",
      }),
      buildHistoricalFxTransaction({
        sourceId: "afn-loss",
        sourcePosition: "AFN intermediary 1",
        recognizedDate: "2026-01-31",
        originalPoolDate: "2026-01-05",
        currencyCode: "AFN",
        foreignAmount: 100_000,
        carryingRate: 4,
        valuationRate: 3.5,
        valuationDate: "2026-01-31",
      }),
    ],
  });

  const gain = poolPreview.transactionLinks.find((row) => row.sourceId === "usd-gain")!;
  const loss = poolPreview.transactionLinks.find((row) => row.sourceId === "afn-loss")!;

  assert.equal(gain.amountPkr, 100_000);
  assert.equal(gain.fx?.currencyCode, "USD");
  assert.equal(gain.reconciliationDifferencePkr, 0);
  assert.equal(loss.amountPkr, -50_000);
  assert.equal(loss.fx?.currencyCode, "AFN");
  assert.equal(loss.reconciliationDifferencePkr, 0);
  assert.equal(poolPreview.aggregateReconciliation.reconciliationDifferencePkr, 0);
});

test("phase 1.4 FX gain and loss after one investor exits are assumed symmetrically by manager", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents: [
      ...baseEvents,
      {
        participantId: "a",
        participantName: "Investor A",
        participantType: "investor",
        effectiveDate: "2026-02-01",
        amountPkr: -50_000_000,
        eventType: "full_exit",
        investorProfitSharePercent: 50,
      },
    ],
    transactions: [
      buildHistoricalFxTransaction({
        sourceId: "rmb-gain",
        sourcePosition: "RMB payable 1",
        recognizedDate: "2026-02-10",
        originalPoolDate: "2026-01-10",
        currencyCode: "RMB",
        foreignAmount: 80_000,
        carryingRate: 40,
        valuationRate: 50,
        valuationDate: "2026-02-10",
      }),
      buildHistoricalFxTransaction({
        sourceId: "usd-loss",
        sourcePosition: "USD receivable 2",
        recognizedDate: "2026-02-11",
        originalPoolDate: "2026-01-10",
        currencyCode: "USD",
        foreignAmount: 8_000,
        carryingRate: 300,
        valuationRate: 200,
        valuationDate: "2026-02-11",
      }),
    ],
  });

  const gainResidual = poolPreview.residualTransfers.find((row) => row.sourceId === "rmb-gain" && row.originalParticipantId === "a")!;
  const lossResidual = poolPreview.residualTransfers.find((row) => row.sourceId === "usd-loss" && row.originalParticipantId === "a")!;

  assert.equal(gainResidual.managerAssumptionPkr, 500_000);
  assert.equal(lossResidual.managerAssumptionPkr, -500_000);
  assert.equal(poolPreview.aggregateReconciliation.reconciliationDifferencePkr, 0);
});

test("phase 1.4 two exited investors leave manager with own original portion plus assumed residuals", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    capitalEvents: [
      ...baseEvents,
      { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: -50_000_000, eventType: "full_exit", investorProfitSharePercent: 50 },
      { participantId: "b", participantName: "Investor B", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: -20_000_000, eventType: "full_exit", investorProfitSharePercent: 33.333333 },
    ],
    transactions: [{
      sourceType: "price_increase",
      sourceId: "adjustment-1",
      recognizedDate: "2026-03-01",
      originalPoolDate: "2026-01-10",
      amountPkr: 800_000,
    }],
  });

  const link = poolPreview.transactionLinks[0];
  const managerOriginal = link.attribution.find((line) => line.participantId === "manager")!;
  const managerResidual = poolPreview.residualTransfers.reduce((sum, row) => sum + row.managerAssumptionPkr, 0);

  assert.equal(managerOriginal.attributablePkr, 100_000);
  assert.equal(managerResidual, 700_000);
  assert.equal(link.activeParticipantAttributionPkr, 100_000);
  assert.equal(link.residualAttributionPkr, 700_000);
  assert.equal(link.reconciliationDifferencePkr, 0);
});

test("phase 1.4 new investor is excluded from old-pool adjustments", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents: [
      ...baseEvents,
      { participantId: "new", participantName: "New Investor", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: 100_000_000, eventType: "opening", investorProfitSharePercent: 100 },
    ],
    transactions: [{
      sourceType: "return",
      sourceId: "return-1",
      recognizedDate: "2026-02-15",
      originalPoolDate: "2026-01-12",
      amountPkr: -800_000,
    }],
  });

  const link = poolPreview.transactionLinks[0];
  assert.ok(!link.attribution.some((line) => line.participantId === "new"));
  assert.equal(link.reconciliationDifferencePkr, 0);
});

test("phase 1.4 partial withdrawal keeps old exposure in old pool and new exposure in new pool", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-28",
    capitalEvents: [
      ...baseEvents,
      { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: -20_000_000, eventType: "capital_withdrawal", investorProfitSharePercent: 50 },
    ],
    transactions: [
      { sourceType: "price_reduction", sourceId: "old-exposure", recognizedDate: "2026-02-15", originalPoolDate: "2026-01-10", amountPkr: -600_000 },
      { sourceType: "price_reduction", sourceId: "new-exposure", recognizedDate: "2026-02-15", originalPoolDate: "2026-02-10", amountPkr: -600_000 },
    ],
  });

  const oldExposure = poolPreview.transactionLinks.find((row) => row.sourceId === "old-exposure")!;
  const newExposure = poolPreview.transactionLinks.find((row) => row.sourceId === "new-exposure")!;
  const oldInvestorA = oldExposure.attribution.find((line) => line.participantId === "a")!;
  const newInvestorA = newExposure.attribution.find((line) => line.participantId === "a")!;

  assert.equal(oldInvestorA.capitalPercent, 62.5);
  assert.equal(oldInvestorA.attributablePkr, -375_000);
  assert.equal(newInvestorA.capitalPercent, 50);
  assert.equal(newInvestorA.attributablePkr, -300_000);
  assert.equal(poolPreview.aggregateReconciliation.reconciliationDifferencePkr, 0);
});

test("phase 1.4 historical adjustment types reconcile to original pools", () => {
  const adjustmentTypes = [
    ["discount", -10_000],
    ["price_increase", 15_000],
    ["price_reduction", -12_000],
    ["return", -20_000],
    ["default", -30_000],
    ["recovery", 18_000],
    ["other_adjustment", 7_000],
  ] as const;
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    capitalEvents: [
      ...baseEvents,
      { participantId: "new", participantName: "New Investor", participantType: "investor", effectiveDate: "2026-02-01", amountPkr: 10_000_000, eventType: "opening", investorProfitSharePercent: 100 },
    ],
    transactions: adjustmentTypes.map(([sourceType, amountPkr], index) => ({
      sourceType,
      sourceId: `${sourceType}-${index}`,
      recognizedDate: "2026-02-10",
      originalPoolDate: "2026-01-10",
      amountPkr,
    })),
  });

  assert.equal(poolPreview.transactionLinks.length, adjustmentTypes.length);
  for (const link of poolPreview.transactionLinks) {
    assert.equal(link.poolSegmentStart, "2026-01-01");
    assert.equal(link.reconciliationDifferencePkr, 0);
    assert.ok(!link.attribution.some((line) => line.participantId === "new"));
  }
  assert.equal(poolPreview.aggregateReconciliation.reconciliationDifferencePkr, 0);
});

test("phase 1.4 missing FX rate blocks preview with exact currency date and position", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: baseEvents,
    transactions: [buildHistoricalFxTransaction({
      sourceId: "missing-rate",
      sourcePosition: "AFN receivable 99",
      recognizedDate: "2026-01-31",
      originalPoolDate: "2026-01-10",
      currencyCode: "AFN",
      foreignAmount: 5_000,
      carryingRate: 4,
      valuationRate: null,
      valuationDate: "2026-01-31",
    })],
  });

  assert.equal(poolPreview.transactionLinks[0].fx?.fxGainLossPkr, null);
  assert.ok(poolPreview.blockedReasons.includes("Missing AFN→PKR valuation rate for AFN receivable 99 on 2026-01-31."));
});

test("phase 1.4 deterministic rounding exposes zero reconciliation difference", () => {
  const poolPreview = buildHistoricalPoolPreview({
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    capitalEvents: [
      { participantId: "manager", participantName: "Manager", participantType: "manager", effectiveDate: "2026-01-01", amountPkr: 1, eventType: "opening" },
      { participantId: "a", participantName: "Investor A", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 1, eventType: "opening", investorProfitSharePercent: 100 },
      { participantId: "b", participantName: "Investor B", participantType: "investor", effectiveDate: "2026-01-01", amountPkr: 1, eventType: "opening", investorProfitSharePercent: 100 },
    ],
    transactions: [{ sourceType: "other_adjustment", sourceId: "rounding-1", recognizedDate: "2026-01-10", originalPoolDate: "2026-01-10", amountPkr: 0.01 }],
  });

  const link = poolPreview.transactionLinks[0];
  assert.equal(link.attribution.reduce((sum, line) => Math.round((sum + line.attributablePkr) * 100) / 100, 0), 0.01);
  assert.equal(link.reconciliationDifferencePkr, 0);
  assert.equal(poolPreview.aggregateReconciliation.reconciliationDifferencePkr, 0);
});
