import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sale correction blocks cross-currency changes before journal or carrying-layer mutation", () => {
  const route = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");

  assert.match(route, /Number\(body\.currencyId\) !== sale\.currencyId/);
  assert.match(route, /FOREIGN_CARRYING_LAYER_REQUIRED/);
  assert.match(route, /Sale recognition currency cannot be changed/);
});

test("sale correction preserves original journals and posts a versioned replacement", () => {
  const route = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");

  assert.doesNotMatch(route, /tx\.journalEntry\.deleteMany/);
  assert.match(route, /nextSaleJournalVersion/);
  assert.match(route, /reverseJournalEntries\(saleJournalTransactionId/);
  assert.match(route, /reverseJournalEntries\(saleCogsJournalTransactionId/);
});
