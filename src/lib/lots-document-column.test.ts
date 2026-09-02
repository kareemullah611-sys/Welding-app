import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("lots list omits the documents column while lot detail keeps documents", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/lots/page.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "src/components/lots/LotDetailTabs.tsx"), "utf8");

  assert.doesNotMatch(page, /key:\s*"documents",\s*label:\s*"Documents"/);
  assert.match(detail, /<h4[^>]*>Documents<\/h4>/);
  assert.match(detail, /selectedLot\.documents\.map/);
});

test("super-admin lots omit business status and highlight completed rows", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/lots/page.tsx"), "utf8");

  assert.doesNotMatch(page, /:\s*"Business"/);
  assert.match(page, /user\?\.role === "city_admin" \? \[\{ key: "status"/);
  assert.match(page, /rowClassName=\{\(lot: any\) =>/);
  assert.match(page, /user\?\.role === "super_admin" && lot\.status === "completed"/);
  assert.match(page, /bg-emerald-50\/80/);
});

test("super-admin lot list and ledger use the compact requested presentation", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/(dashboard)/lots/page.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "src/components/lots/LotDetailTabs.tsx"), "utf8");

  const supplierColumn = page.indexOf('key: "suppliers"');
  const lotColumn = page.indexOf('key: "lotNumber"');
  assert.ok(supplierColumn >= 0 && supplierColumn < lotColumn);
  assert.doesNotMatch(page, /key:\s*"destination",\s*label:\s*"Destination"/);
  assert.match(page, /text-\[11px\][^>]*>\{l\.destinationCity\?\.name \|\| l\.countryName \|\| "—"\}/);
  assert.match(page, /user\?\.role === "city_admin" \? \[\{ key: "lotDate"/);
  assert.doesNotMatch(page, />Created By</);

  assert.doesNotMatch(detail, />Supplier<\/th>/);
  assert.doesNotMatch(detail, /<td[^>]*>\{p\.supplierName\}<\/td>/);
  assert.match(detail, /grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5[\s\S]*Purchase \(USD\)[\s\S]*Landed cost \(PKR\)[\s\S]*Total Cartons[\s\S]*Sold Cartons[\s\S]*Remaining/);
});
