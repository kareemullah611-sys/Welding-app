import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateLiabilitySettlement,
  allocateLiabilitySettlementLayers,
  buildRealizedFxPostingAmounts,
  settlementJournalTransactionId,
} from "./realized-liability-fx";

test("full settlement at carrying rate realizes no FX", () => {
  const result = allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 0,
    settlementAmountUsd: 100_000,
    actualSettlementPkr: 28_300_000,
  });

  assert.equal(result.carryingAmountPkr, 28_300_000);
  assert.equal(result.realizedFxPkr, 0);
  assert.equal(result.remainingLiabilityUsd, 0);
});

test("higher settlement cost realizes an FX loss", () => {
  const result = allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 0,
    settlementAmountUsd: 100_000,
    actualSettlementPkr: 28_700_000,
  });

  assert.equal(result.realizedFxPkr, -400_000);
});

test("lower settlement cost realizes an FX gain", () => {
  const result = allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 0,
    settlementAmountUsd: 100_000,
    actualSettlementPkr: 28_000_000,
  });

  assert.equal(result.realizedFxPkr, 300_000);
});

test("partial settlement realizes FX only on the settled USD", () => {
  const result = allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 0,
    settlementAmountUsd: 40_000,
    actualSettlementPkr: 11_480_000,
  });

  assert.equal(result.carryingAmountPkr, 11_320_000);
  assert.equal(result.realizedFxPkr, -160_000);
  assert.equal(result.remainingLiabilityUsd, 60_000);
});

test("multiple installments preserve independent settlement results", () => {
  const first = allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 0,
    settlementAmountUsd: 40_000,
    actualSettlementPkr: 11_480_000,
  });
  const second = allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 40_000,
    settlementAmountUsd: 30_000,
    actualSettlementPkr: 8_370_000,
  });

  assert.equal(first.realizedFxPkr, -160_000);
  assert.equal(second.realizedFxPkr, 120_000);
  assert.equal(second.remainingLiabilityUsd, 30_000);
});

test("missing carrying basis and over-settlement are blocked", () => {
  assert.throws(() => allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 0,
    previouslySettledUsd: 0,
    settlementAmountUsd: 1,
    actualSettlementPkr: 287,
  }), /carrying rate/i);

  assert.throws(() => allocateLiabilitySettlement({
    liabilityAmountUsd: 100_000,
    carryingRatePkr: 283,
    previouslySettledUsd: 90_000,
    settlementAmountUsd: 20_000,
    actualSettlementPkr: 5_740_000,
  }), /exceeds remaining liability/i);
});

test("supplier and shipping FX posting amounts remain balanced", () => {
  const loss = buildRealizedFxPostingAmounts({ carryingAmountPkr: 11_320_000, actualSettlementPkr: 11_480_000 });
  assert.deepEqual(loss, {
    liabilityDebitPkr: 11_320_000,
    sourceCreditPkr: 11_480_000,
    fxGainCreditPkr: 0,
    fxLossDebitPkr: 160_000,
  });
  assert.equal(loss.liabilityDebitPkr + loss.fxLossDebitPkr, loss.sourceCreditPkr + loss.fxGainCreditPkr);

  const gain = buildRealizedFxPostingAmounts({ carryingAmountPkr: 28_300_000, actualSettlementPkr: 28_000_000 });
  assert.equal(gain.liabilityDebitPkr, 28_300_000);
  assert.equal(gain.sourceCreditPkr, 28_000_000);
  assert.equal(gain.fxGainCreditPkr, 300_000);
  assert.equal(gain.fxLossDebitPkr, 0);
  assert.equal(gain.liabilityDebitPkr + gain.fxLossDebitPkr, gain.sourceCreditPkr + gain.fxGainCreditPkr);
});

test("edited settlements use versioned journal IDs so every revision can reverse once", () => {
  assert.equal(settlementJournalTransactionId("SUPPPAY", 42, 1), "SUPPPAY-42");
  assert.equal(settlementJournalTransactionId("SUPPPAY", 42, 2), "SUPPPAY-42-V2");
  assert.equal(settlementJournalTransactionId("SLPAY", 7, 3), "SLPAY-7-V3");
});

test("FIFO liability layers preserve each original carrying basis", () => {
  const result = allocateLiabilitySettlementLayers({
    layers: [
      { amountUsd: 60_000, carryingRatePkr: 280, recognitionDate: "2026-01-01" },
      { amountUsd: 40_000, carryingRatePkr: 290, recognitionDate: "2026-02-01" },
    ],
    previouslySettledUsd: 50_000,
    settlementAmountUsd: 30_000,
    actualSettlementPkr: 8_700_000,
  });

  assert.equal(result.carryingAmountPkr, 8_600_000);
  assert.equal(result.carryingRatePkr, 286.666667);
  assert.equal(result.realizedFxPkr, -100_000);
  assert.equal(result.originalPoolDate, "2026-01-01");
  assert.deepEqual(result.consumedLayers, [
    { amountUsd: 10_000, carryingRatePkr: 280, recognitionDate: "2026-01-01" },
    { amountUsd: 20_000, carryingRatePkr: 290, recognitionDate: "2026-02-01" },
  ]);
});
