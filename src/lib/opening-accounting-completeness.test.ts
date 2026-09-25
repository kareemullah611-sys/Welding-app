import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260830120000_complete_opening_accounting/migration.sql",
  "utf8",
);
const route = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const accounting = readFileSync("src/lib/accounting.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");
const bankAccountsRoute = readFileSync("src/app/api/v1/bank-accounts/route.ts", "utf8");

test("opening accounting migration is additive and preserves existing rows", () => {
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(migration, /CREATE TABLE "opening_inventory_valuations"/);
  assert.match(migration, /CREATE TABLE "opening_super_admin_account_balances"/);
  assert.match(migration, /CREATE TABLE "opening_equity_allocations"/);
});

test("opening models retain original currency and authoritative PKR carrying value", () => {
  for (const model of [
    "OpeningCash",
    "OpeningHajiBalance",
    "OpeningCustomerBalance",
    "OpeningBankBalance",
    "OpeningCheque",
    "OpeningLiability",
    "OpeningCityLiability",
  ]) {
    const block = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || "";
    assert.match(block, /carryingAmountPkr/);
    assert.match(block, /fxRateToPkr/);
    assert.match(block, /fxRateDate/);
    assert.match(block, /fxRateSource/);
  }
});

test("inventory value, superadmin funds, Haji direction and opening equity are journaled", () => {
  assert.match(accounting, /journalOpeningInventoryValuation/);
  assert.match(accounting, /journalOpeningSuperAdminAccountBalance/);
  assert.match(accounting, /journalOpeningEquityAllocation/);
  assert.match(accounting, /getHajiPayableAccountId/);
  assert.match(accounting, /getHajiReceivableAccountId/);
  assert.match(route, /kind === "inventory_value"/);
  assert.match(route, /kind === "super_admin_account"/);
  assert.match(route, /kind === "equity"/);
});

test("opening UI exposes controlled cutover accounting without replacing physical stock", () => {
  assert.match(page, /Opening inventory valuation/);
  assert.match(page, /Superadmin cash and bank openings/);
  assert.match(page, /One-time cutover control/);
  assert.match(page, /Participant opening capital and retained profit/);
  assert.match(page, /Owed to Haji/);
  assert.match(page, /Due from Haji/);
  assert.match(page, /Opening godown stock \(ongoing lots\)/);
});

test("superadmin running balances include their opening account balances", () => {
  assert.match(bankAccountsRoute, /openingSuperAdminAccountBalance/);
  assert.match(bankAccountsRoute, /openingMap/);
});
