import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const route = readFileSync("src/app/api/v1/opening-city-packages/route.ts", "utf8");
const openingsRoute = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const readiness = readFileSync("src/lib/opening-cutover.ts", "utf8");
const cutoverRoute = readFileSync("src/app/api/v1/opening-cutover/route.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");
const accounting = readFileSync("src/lib/accounting.ts", "utf8");

test("every city has one controlled opening package per cutover", () => {
  assert.match(schema, /enum OpeningCityPackageStatus\s*{[\s\S]*draft[\s\S]*submitted[\s\S]*returned[\s\S]*approved[\s\S]*}/);
  assert.match(schema, /model OpeningCityPackage\s*{/);
  assert.match(schema, /@@unique\(\[cutoverId, cityId\]/);
  assert.match(route, /action === "submit"/);
  assert.match(route, /action === "return"/);
  assert.match(route, /action === "approve"/);
});

test("city and central due assertions must match by currency and PKR carrying value", () => {
  assert.match(schema, /model OpeningCityDueBalance\s*{/);
  assert.match(schema, /cityAmount/);
  assert.match(schema, /cityCarryingPkr/);
  assert.match(schema, /centralAmount/);
  assert.match(schema, /centralCarryingPkr/);
  assert.match(schema, /@@unique\(\[packageId, currencyId\]/);
  assert.match(route, /OPENING_DUE_BALANCE_MISMATCH/);
  assert.match(readiness, /cityPackageBlockers/);
  assert.match(readiness, /Every active city must have an approved opening package/);
});

test("zero due balances are explicit and package actions are separately audited", () => {
  assert.match(route, /Number\.isFinite\(cityAmount\)/);
  assert.match(route, /Number\.isFinite\(centralAmount\)/);
  assert.match(route, /opening_city_packages/);
  assert.match(route, /createAuditLog/);
});

test("submitted and approved packages lock city opening writes", () => {
  assert.match(openingsRoute, /ensureCityOpeningPackageEditable/);
  assert.match(openingsRoute, /OPENING_CITY_PACKAGE_LOCKED/);
  assert.match(openingsRoute, /user\.role === "city_admin"/);
});

test("the UI and final snapshot retain the shared city-central assertion", () => {
  assert.match(page, /City opening package/);
  assert.match(page, /Approve exact match/);
  assert.match(cutoverRoute, /openingCityPackage\.findMany/);
  assert.match(cutoverRoute, /cityPackages/);
  assert.doesNotMatch(schema, /model OpeningSuperAdminDueBalance/);
});

test("approval posts one paired journal with distinct city and central scopes", () => {
  assert.match(accounting, /journalOpeningCityDueBalance/);
  assert.match(accounting, /Due from City/);
  assert.match(accounting, /Due to Superadmin/);
  assert.match(accounting, /cityId:\s*null/);
  assert.match(accounting, /cityId:\s*p\.cityId/);
  assert.match(route, /sourceLineKey:\s*"due_from_city"/);
  assert.match(route, /sourceLineKey:\s*"due_to_superadmin"/);
  assert.match(route, /recordForeignCurrencyRecognition/);
});
