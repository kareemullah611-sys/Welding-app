import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("city opening inventory is submitted by godown and product without a lot", () => {
  const submit = page.match(/const submitStock[\s\S]*?^  };/m)?.[0] || "";
  assert.match(submit, /kind: "stock"/);
  assert.match(submit, /godownId: stockForm\.godownId/);
  assert.match(submit, /productId: stockForm\.productId/);
  assert.match(submit, /qty: Number\(stockForm\.qty/);
  assert.doesNotMatch(submit, /lotId/);
});

test("superadmin valuation derives unit cost from city-product quantity and journals full value", () => {
  const handler = route.match(/if \(kind === "product_inventory"\)[\s\S]*?\n    }\n\n    if \(kind ===/m)?.[0] || "";
  assert.match(handler, /openingStock\.aggregate/);
  assert.match(handler, /totalValuePkr \/ totalQuantity/);
  assert.match(handler, /unique_opening_inventory_city_product/);
  assert.match(handler, /journalOpeningInventoryValuation/);
  assert.doesNotMatch(handler, /Number\(body\.lotId\)/);
});

test("deleting a city-product valuation reverses its journal and removes the valuation", () => {
  const deleteHandler = route.slice(route.indexOf("export const DELETE"));
  const branch = deleteHandler.match(/if \(kind === "product_inventory"\)[\s\S]*?\n    }\n\n    if \(kind ===/m)?.[0] || "";
  assert.match(branch, /reverseOpeningJournals/);
  assert.match(branch, /openingInventoryValuation\.delete/);
});

test("opening inventory source identity is separate from post-cutover lots", () => {
  assert.match(schema, /openingInventoryValuationId\s+Int\?/);
  assert.match(schema, /@@unique\(\[cityId, productId\]\)/);
  assert.match(schema, /lotId\s+Int\?/);
});

test("opening inventory UI separates city quantities from superadmin valuation", () => {
  assert.match(page, /Opening inventory quantities/);
  assert.match(page, /City product valuation/);
  assert.match(page, /Total PKR value/);
  assert.doesNotMatch(page, />Lot \/ product</);
  assert.doesNotMatch(page, /Legacy stock \(OLD-STOCK\)/);
  assert.doesNotMatch(page, /Saved legacy stock \(OLD-STOCK lot\)/);
});
