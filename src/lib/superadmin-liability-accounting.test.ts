import assert from "node:assert/strict";
import test from "node:test";

import { calculateLiabilitySettlementFx } from "./superadmin-liability-accounting";

test("foreign liability settlement preserves carrying value and recognizes FX loss", () => {
  assert.deepEqual(calculateLiabilitySettlementFx({
    outstandingForeignAmount: 100,
    outstandingCarryingPkr: 28000,
    settlementForeignAmount: 50,
    settlementRateToPkr: 290,
  }), {
    carryingRatePkr: 280,
    carryingAmountPkr: 14000,
    actualSettlementPkr: 14500,
    realizedFxPkr: -500,
  });
});

test("foreign liability settlement recognizes FX gain once", () => {
  assert.equal(calculateLiabilitySettlementFx({
    outstandingForeignAmount: 100,
    outstandingCarryingPkr: 28000,
    settlementForeignAmount: 100,
    settlementRateToPkr: 275,
  }).realizedFxPkr, 500);
});

test("liability settlement blocks overpayment", () => {
  assert.throws(() => calculateLiabilitySettlementFx({
    outstandingForeignAmount: 40,
    outstandingCarryingPkr: 11200,
    settlementForeignAmount: 50,
    settlementRateToPkr: 280,
  }), /exceeds outstanding liability/i);
});
