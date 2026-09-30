import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const page = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");
const historicalLayer = readFileSync("src/lib/legacy-stock-lot.ts", "utf8");

test("opening inventory is submitted as product quantity and PKR valuation without a lot", () => {
  const submit = page.match(/const submitLegacyStock[\s\S]*?^  };/m)?.[0] || "";
  assert.match(submit, /kind: "product_inventory"/);
  assert.match(submit, /godownId: legacyStockForm\.godownId/);
  assert.match(submit, /productId: legacyStockForm\.productId/);
  assert.match(submit, /quantity: Number\(legacyStockForm\.quantity/);
  assert.match(submit, /unitCostPkr: Number\(legacyStockForm\.unitCostPkr/);
  assert.doesNotMatch(submit, /lotId/);
});

test("opening inventory API derives its historical layer and journals the full product value", () => {
  const handler = route.match(/if \(kind === "product_inventory"\)[\s\S]*?\n    }\n\n    if \(kind ===/m)?.[0] || "";
  assert.match(handler, /setLegacyGodownStock/);
  assert.match(handler, /totalQuantity \* unitCostPkr/);
  assert.match(handler, /journalOpeningInventoryValuation/);
  assert.doesNotMatch(handler, /Number\(body\.lotId\)/);
});

test("deleting a product opening reverses and removes or revalues its inventory journal", () => {
  const deleteHandler = route.slice(route.indexOf("export const DELETE"));
  const branch = deleteHandler.match(/if \(kind === "product_inventory"\)[\s\S]*?\n    }\n\n    if \(kind ===/m)?.[0] || "";
  assert.match(branch, /reverseOpeningJournals/);
  assert.match(branch, /remainingQuantity/);
  assert.match(branch, /openingInventoryValuation\.delete/);
  assert.match(branch, /journalOpeningInventoryValuation/);
});

test("opening quantity cannot be reduced below quantities already consumed", () => {
  assert.match(historicalLayer, /saleItem\.aggregate/);
  assert.match(historicalLayer, /godownTransfer\.aggregate/);
  assert.match(historicalLayer, /cannot be below already sold or transferred quantity/i);
});

test("opening inventory UI uses product accounting language rather than exposing OLD-STOCK", () => {
  assert.match(page, /Opening product inventory/);
  assert.match(page, /PKR unit cost/);
  assert.match(page, /Total PKR value/);
  assert.doesNotMatch(page, />Lot \/ product</);
  assert.doesNotMatch(page, /Legacy stock \(OLD-STOCK\)/);
  assert.doesNotMatch(page, /Saved legacy stock \(OLD-STOCK lot\)/);
});
