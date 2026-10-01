import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("carrying-layer source facts are immutable and balance changes use one constrained helper", () => {
  const source = readFileSync("src/lib/foreign-currency-carrying-db.ts", "utf8");
  const directUpdates = source.match(/foreignCurrencyCarryingLayer\.update\(/g) || [];

  assert.equal(directUpdates.length, 1, "all layer mutations must pass through updateLayerBalance");
  assert.match(source, /async function updateLayerBalance/);
  assert.match(source, /remainingForeignAmount/);
  assert.match(source, /remainingCarryingAmountPkr/);
  assert.doesNotMatch(
    source.slice(source.indexOf("async function updateLayerBalance"), source.indexOf("async function consumeLayers")),
    /originalForeignAmount|originalCarryingAmountPkr|recognitionRatePkr|historicalPoolDate|rateProvider|rateReference/,
  );
});
