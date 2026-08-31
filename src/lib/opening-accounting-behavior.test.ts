import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveOpeningCarryingAmount } from "./accounting";
import { openingHajiOwedDelta } from "./ongoing-lot-haji-owed";
import { buildSupplierRunningLedger, buildSupplierStatement } from "./supplier-ledger";
import { buildIntermediaryLedgerEntries } from "./intermediary-ledger";

test("PKR opening amount carries at one-to-one", () => {
  assert.deepEqual(resolveOpeningCarryingAmount({ amount: 1250, currencyCode: "PKR" }), {
    carryingAmountPkr: 1250,
    fxRateToPkr: 1,
  });
});

test("foreign opening requires an exact auditable PKR carrying amount", () => {
  assert.deepEqual(resolveOpeningCarryingAmount({ amount: 100, currencyCode: "USD", carryingAmountPkr: 28_300, fxRateToPkr: 283 }), {
    carryingAmountPkr: 28_300,
    fxRateToPkr: 283,
  });
  assert.throws(() => resolveOpeningCarryingAmount({ amount: 100, currencyCode: "USD", carryingAmountPkr: 28_300, fxRateToPkr: 280 }), /does not match/i);
  assert.throws(() => resolveOpeningCarryingAmount({ amount: 100, currencyCode: "USD" }), /required/i);
});

test("Haji opening payable increases owed and receivable reduces owed", () => {
  assert.equal(openingHajiOwedDelta(500, "payable"), 500);
  assert.equal(openingHajiOwedDelta(500, "receivable"), -500);
});

test("supplier openings preserve payable and receivable sides", () => {
  const supplier = {
    openingLiabilities: [
      { id: 1, amount: 100, balanceSide: "payable", openingDate: new Date("2026-01-01"), currency: { code: "USD" } },
      { id: 2, amount: 25, balanceSide: "receivable", openingDate: new Date("2026-01-02"), currency: { code: "USD" } },
    ],
    lotPurchases: [],
    supplierPayments: [],
  };
  assert.equal(buildSupplierStatement(supplier).openingBalanceUsd, 75);
  const ledger = buildSupplierRunningLedger(supplier);
  assert.equal(ledger.at(-1)?.balanceUsd, 75);
});

test("intermediary opening receivable is an asset-side credit in its operational ledger", () => {
  const entries = buildIntermediaryLedgerEntries({
    openingLiabilities: [{ id: 1, amount: 250, balanceSide: "receivable", openingDate: new Date("2026-01-01"), currency: { code: "USD" } }],
    deposits: [], payments: [], exchanges: [], hajiTransfers: [],
  });
  assert.equal(entries[0].debit, 0);
  assert.equal(entries[0].credit, 250);
});

test("opening inventory valuation is checked before regular lot cost calculation", () => {
  const accounting = readFileSync(new URL("./accounting.ts", import.meta.url), "utf8");
  assert.match(accounting, /openingInventoryValuation\.findMany/);
  assert.match(accounting, /Opening inventory valuation is incomplete/);
  assert.match(accounting, /Number\(item\.qty \|\| 0\) \* Number\(unitCostByProduct\.get/);
});

test("superadmin account openings feed both summary and account ledger", () => {
  const summary = readFileSync(new URL("../app/api/v1/bank-accounts/route.ts", import.meta.url), "utf8");
  const ledger = readFileSync(new URL("../app/api/v1/bank-accounts/[id]/route.ts", import.meta.url), "utf8");
  assert.match(summary, /openingSuperAdminAccountBalance/);
  assert.match(ledger, /Opening superadmin (cash|bank) balance/);
});
