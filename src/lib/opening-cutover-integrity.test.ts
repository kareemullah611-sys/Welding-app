import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260923090000_opening_cutover_control/migration.sql", "utf8");
const route = readFileSync("src/app/api/v1/opening-cutover/route.ts", "utf8");
const openings = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");

test("one-time cutover migration is additive and preserves historical accounting", () => {
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(migration, /CREATE TABLE "opening_cutovers"/);
  assert.match(migration, /CREATE TABLE "opening_participant_balances"/);
});

test("cutover finalization is superadmin-only atomic and readiness-gated", () => {
  assert.match(route, /user\.role !== "super_admin"/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /loadOpeningCutoverReadiness/);
  assert.match(route, /OPENING_CUTOVER_NOT_READY/);
  assert.match(route, /status: "finalized"/);
  assert.match(route, /confirmation !== "FINALIZE OPENINGS"/);
  assert.match(route, /confirmation !== "REVERSE OPENINGS"/);
  assert.match(route, /OPENING_REVERSAL_DEPENDENCIES_EXIST/);
  assert.match(route, /sourceType: "opening_cutover_reversal"/);
  assert.match(route, /financialYear\.upsert/);
  assert.match(route, /OPENING_DATE_OUTSIDE_FINANCIAL_YEAR/);
});

test("participant opening keeps capital and retained profit separate", () => {
  assert.match(schema, /model OpeningParticipantBalance/);
  assert.match(schema, /capitalPkr/);
  assert.match(schema, /currentYearProfitPkr/);
  assert.match(schema, /ongoingLotRealizedProfitPkr/);
  assert.match(route, /journalOpeningParticipantBalance/);
  assert.match(route, /eventType: "opening"/);
});

test("all foreign monetary opening paths create immutable carrying layers", () => {
  for (const sourceType of ["opening_haji_balance", "opening_cheque", "opening_city_liability"]) {
    assert.match(openings, new RegExp(`sourceType: "${sourceType}"`));
  }
  for (const sourceType of ["opening_cash", "opening_customer_balance", "opening_bank_balance", "opening_haji_balance", "opening_cheque", "opening_liability", "opening_city_liability", "opening_super_admin_account"]) {
    assert.match(openings, new RegExp(`reverseForeignCurrencyRecognition\\(tx, \\{ sourceType: "${sourceType}"`));
  }
});

test("opening UI exposes setup participant preview and explicit finalization", () => {
  assert.match(page, /One-time cutover control/);
  assert.match(page, /Participant opening capital and retained profit/);
  assert.match(page, /FINALIZE OPENINGS/);
  assert.doesNotMatch(page, /placeholder="Drawee bank"/);
});

test("final snapshot preserves complete opening evidence rather than counts only", () => {
  assert.match(route, /openingRecords:/);
  assert.match(route, /foreignCarryingLayers/);
  assert.match(route, /openingJournals/);
  assert.doesNotMatch(route, /counts: \{ cash, customers, banks, cheques/);
});
