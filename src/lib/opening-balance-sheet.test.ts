import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const accounting = readFileSync("src/lib/accounting.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260826090000_journal_opening_customer_receivables/migration.sql",
  "utf8",
);

test("monetary openings post to the balance sheet from the openings route", () => {
  assert.match(route, /journalOpeningCashBalance/);
  assert.match(route, /journalOpeningBankBalance/);
  assert.match(route, /journalOpeningCheque/);
  assert.match(route, /journalOpeningHajiBalance/);
  assert.match(route, /journalOpeningLiability/);
  assert.match(route, /journalOpeningCityLiability/);
});

test("opening edits reverse every prior version before posting the replacement", () => {
  for (const entityType of [
    "opening_cash",
    "opening_bank_balance",
    "opening_cheque",
    "opening_haji_balance",
    "opening_liability",
    "opening_city_liability",
  ]) {
    assert.match(accounting, new RegExp(`entityType: \"${entityType}\"`));
  }
  assert.match(accounting, /reverseOpeningJournals/);
  assert.match(route, /journalVersion:\s*previousVersions \+ 1/g);
});

test("opening cash, bank, and cheque deletions reverse their journals atomically", () => {
  assert.match(route, /reverseOpeningJournals\("opening_cash", row\.id/);
  assert.match(route, /reverseOpeningJournals\("opening_bank_balance", row\.id/);
  assert.match(route, /reverseOpeningJournals\("opening_cheque", row\.id/);
});

test("deployment backfill covers every monetary opening without inventing stock value", () => {
  for (const table of [
    "opening_cashes",
    "opening_bank_balances",
    "opening_cheques",
    "opening_haji_balances",
    "opening_liabilities",
    "opening_city_liabilities",
  ]) {
    assert.match(migration, new RegExp(table));
  }
  assert.doesNotMatch(migration, /opening_stocks/);
});
