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
