import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("H02 lot reopen is atomic and never swallows journal reversal failures", () => {
  const route = readFileSync("src/app/api/v1/lots/[id]/reopen/route.ts", "utf8");

  assert.match(route, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(route, /reverseJournalEntries\(`HAJI-\$\{transfer\.id\}`,[^;]+tx\)/);
  assert.doesNotMatch(route, /catch \(_\) \{\}/);
  assert.match(route, /createAuditLog\([^;]+tx\)/s);
});

test("H03 godown allocation replacement is atomic", () => {
  const route = readFileSync("src/app/api/v1/lots/[id]/godown-allocation/route.ts", "utf8");

  assert.match(route, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(route, /tx\.lotCityGodownAllocation\.delete/);
  assert.match(route, /tx\.lotCityGodownAllocation\.upsert/);
  assert.match(route, /createAuditLog\([^;]+tx\)/s);
  assert.doesNotMatch(route, /no transaction/);
});

test("H04 all=true cannot bypass city-admin city scope", () => {
  const route = readFileSync("src/app/api/v1/cities/route.ts", "utf8");

  assert.match(route, /if \(user\.role === "city_admin"\) \{\s*where\.id = user\.cityId;/s);
  assert.doesNotMatch(route, /user\.role === "city_admin" && !showAll/);
});

test("M02 superadmin foreign-to-PKR transfer journals realized FX from carrying movements", () => {
  const route = readFileSync("src/app/api/v1/super-admin-account-transfers/route.ts", "utf8");
  const reversal = readFileSync("src/app/api/v1/super-admin-account-transfers/[id]/reverse/route.ts", "utf8");

  assert.match(route, /const fx = await exchangeForeignCurrencyLayers/);
  assert.match(route, /journalForeignFundingAssetAdjustments\(/);
  assert.match(route, /movements: fx\.movements/);
  assert.match(reversal, /const fx = await reverseForeignCurrencyMovements/);
  assert.match(reversal, /for \(const transactionId of fx\.journalTransactionIds\)/);
  assert.match(reversal, /reverseJournalEntries\(transactionId/);
});
