import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const cutoverRoute = readFileSync("src/app/api/v1/opening-cutover/route.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");

test("opening workflow excludes historical sales end to end", () => {
  assert.doesNotMatch(route, /createHistoricalSale|historicalSales|historical_sale|historical_sales/);
  assert.doesNotMatch(page, /historical sales/i);
  assert.match(page, /current on-hand quantity/i);
});

test("customer openings use an explicit side and a positive magnitude", () => {
  assert.match(page, /customerForm\.balanceSide/);
  assert.match(page, /Customer owes us/);
  assert.match(page, /Customer advance/);
  assert.match(route, /const customerBalanceSide = body\.balanceSide === "advance" \? "advance" : "receivable"/);
  assert.match(route, /const signedAmount = customerBalanceSide === "advance" \? -amountMagnitude : amountMagnitude/);
  assert.match(route, /if \(!Number\.isFinite\(amountMagnitude\) \|\| amountMagnitude <= 0\)/);
});

test("monetary opening APIs reject zero and negative magnitudes", () => {
  for (const kind of ["cash", "haji", "bank", "cheque", "liability", "city_liability", "super_admin_account"]) {
    const start = route.indexOf(`if (kind === "${kind}")`);
    assert.notEqual(start, -1, `missing ${kind} branch`);
    const next = route.indexOf("\n    if (kind ===", start + 10);
    const branch = route.slice(start, next === -1 ? undefined : next);
    assert.match(branch, /!Number\.isFinite\(amount\) \|\| amount <= 0/, `${kind} must require a positive amount`);
  }
});

test("opening dates use strict date-only validation", () => {
  assert.match(route, /parseOpeningDate/);
  assert.doesNotMatch(route, /function dateOnly/);
  assert.match(cutoverRoute, /parseCutoverDate/);
  assert.doesNotMatch(cutoverRoute, /const dateOnly/);
});

test("cutover finalization is disabled while offline", () => {
  assert.match(page, /Finalization requires an online connection/);
  assert.match(page, /disabled=\{!isOnline \|\| !cutoverData\.readiness\?\.ready/);
});

test("participant capital cannot be auto-filled from the reconciliation difference", () => {
  assert.doesNotMatch(page, /Use remaining equity/);
  assert.doesNotMatch(page, /capitalPkr:\s*String\(cutoverData\.readiness\?\.openingClearingPkr/);
});
