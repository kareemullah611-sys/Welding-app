import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const openingsRoute = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const cutover = readFileSync("src/lib/opening-cutover.ts", "utf8");
const cutoverRoute = readFileSync("src/app/api/v1/opening-cutover/route.ts", "utf8");

test("every opening source is explicitly owned by one cutover revision", () => {
  assert.match(schema, /model OpeningCutoverEntry/);
  assert.match(schema, /@@unique\(\[entityType, entityId\]/);
  assert.match(openingsRoute, /attachOpeningToDraft/);
  for (const entityType of [
    "opening_cash", "opening_customer_balance", "opening_stock", "opening_inventory_valuation",
    "opening_bank_balance", "opening_cheque", "opening_haji_balance", "opening_liability",
    "opening_city_liability", "opening_super_admin_account_balance", "opening_equity_allocation",
  ]) {
    assert.match(openingsRoute, new RegExp(`attachOpeningToDraft\\(tx, "${entityType}"`));
  }
});

test("readiness and final snapshot are scoped to the selected cutover", () => {
  assert.match(cutover, /openingCutoverEntry\.findMany/);
  assert.match(cutover, /unlinkedOpeningRecords/);
  assert.match(cutoverRoute, /openingCutoverEntry\.findMany/);
  assert.match(cutoverRoute, /cutoverId/);
  assert.doesNotMatch(cutoverRoute, /openingCash\.findMany\(\{ orderBy/);
});

test("finalized snapshots are SHA-256 chained to the preceding cutover", () => {
  assert.match(schema, /finalSnapshotHash/);
  assert.match(schema, /previousSnapshotHash/);
  assert.match(cutoverRoute, /createHash\("sha256"\)/);
  assert.match(cutoverRoute, /previousSnapshotHash/);
  assert.match(cutoverRoute, /finalSnapshotHash/);
});
