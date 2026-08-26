import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INVESTOR_SYSTEM_MODES,
  getInvestorSystemMode,
  legacyInvestorWritesAllowed,
} from "./investor-system-mode";
import { COUNTRY_CODES, isAfghanistanCountry, isPakistanCountry } from "./country-code";

test("investor system mode never infers migration completion from existing capital events", () => {
  assert.equal(getInvestorSystemMode({}), INVESTOR_SYSTEM_MODES.LEGACY);
  assert.equal(getInvestorSystemMode({ INVESTOR_SYSTEM_MODE: "MIGRATION_READY" }), INVESTOR_SYSTEM_MODES.MIGRATION_READY);
  assert.equal(getInvestorSystemMode({ INVESTOR_SYSTEM_MODE: "MIGRATED" }), INVESTOR_SYSTEM_MODES.MIGRATED);
  assert.equal(legacyInvestorWritesAllowed({ INVESTOR_SYSTEM_MODE: "LEGACY" }), true);
  assert.equal(legacyInvestorWritesAllowed({ INVESTOR_SYSTEM_MODE: "MIGRATION_READY" }), false);
  assert.equal(legacyInvestorWritesAllowed({ INVESTOR_SYSTEM_MODE: "MIGRATED" }), false);

  const route = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  assert.doesNotMatch(route, /if \(explicitEvents\.length > 0\)/);
  assert.match(route, /getInvestorSystemMode/);
  assert.match(route, /migration_incomplete/);
});

test("legacy investor writes are frozen outside LEGACY mode while reads remain available", () => {
  const listRoute = readFileSync("src/app/api/v1/investors/route.ts", "utf8");
  const detailRoute = readFileSync("src/app/api/v1/investors/[id]/route.ts", "utf8");
  const transactionsRoute = readFileSync("src/app/api/v1/investors/[id]/transactions/route.ts", "utf8");

  assert.match(listRoute, /legacyInvestorWritesAllowed/);
  assert.match(detailRoute, /legacyInvestorWritesAllowed/);
  assert.match(transactionsRoute, /legacyInvestorWritesAllowed/);
  assert.doesNotMatch(listRoute.split("export const GET")[1].split("export const POST")[0], /LEGACY_WRITES_FROZEN/);
});

test("financial country decisions use stable PK and AF codes", () => {
  assert.equal(COUNTRY_CODES.PAKISTAN, "PK");
  assert.equal(COUNTRY_CODES.AFGHANISTAN, "AF");
  assert.equal(isPakistanCountry({ code: "PK", name: "Renamed Pakistan" }), true);
  assert.equal(isAfghanistanCountry({ code: "AF", name: "Renamed Afghanistan" }), true);
  assert.equal(isPakistanCountry({ code: "AF", name: "Pakistan" }), false);

  const fifo = readFileSync("src/lib/intermediary-usd-fifo.ts", "utf8");
  assert.doesNotMatch(fifo, /code: "PAK"|code: "AFG"/);
});

test("sale hard delete stores its audit row in the destructive transaction", () => {
  const route = readFileSync("src/app/api/v1/sales/[id]/hard-delete/route.ts", "utf8");
  const transaction = route.slice(route.indexOf("prisma.$transaction"), route.indexOf("return successResponse"));
  assert.match(transaction, /tx\.auditLog\.create/);
  assert.doesNotMatch(transaction, /await createAuditLog/);
  assert.doesNotMatch(route.slice(route.indexOf("\n    });", route.indexOf("prisma.$transaction")) + 7), /createAuditLog/);
});
