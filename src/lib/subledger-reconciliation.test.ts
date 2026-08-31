import assert from "node:assert/strict";
import test from "node:test";

import { addLedgerAmount, compareLedgerBalances } from "./subledger-reconciliation";

test("subledger reconciliation keeps currencies separate and reports exact differences", () => {
  const source: Record<string, number> = {};
  addLedgerAmount(source, "pkr", 1_000);
  addLedgerAmount(source, "PKR", -250);
  addLedgerAmount(source, "USD", 100);

  assert.deepEqual(compareLedgerBalances(source, { PKR: 750, USD: 90 }), [
    { currency: "PKR", source: 750, generalLedger: 750, difference: 0, reconciled: true },
    { currency: "USD", source: 100, generalLedger: 90, difference: 10, reconciled: false },
  ]);
});
