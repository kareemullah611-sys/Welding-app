import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const openingsRoute = readFileSync("src/app/api/v1/openings/route.ts", "utf8");
const openingsPage = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");
const cutover = readFileSync("src/lib/opening-cutover.ts", "utf8");
const godownStock = readFileSync("src/app/api/v1/inventory/godown-stock/route.ts", "utf8");
const godownTransfer = readFileSync("src/app/api/v1/godowns/transfers/route.ts", "utf8");
const godownTransferReverse = readFileSync("src/app/api/v1/godowns/transfers/[id]/reverse/route.ts", "utf8");
const cityTransfer = readFileSync("src/app/api/v1/city-transfers/route.ts", "utf8");
const stockLedger = readFileSync("src/app/api/v1/inventory/stock-ledger/route.ts", "utf8");

test("opening quantity remains product and godown scoped while valuation is city and product scoped", () => {
  const valuationModel = schema.slice(
    schema.indexOf("model OpeningInventoryValuation"),
    schema.indexOf("model OpeningSuperAdminAccountBalance"),
  );
  assert.match(valuationModel, /cityId\s+Int\?\s+@map\("city_id"\)/);
  assert.match(valuationModel, /lotId\s+Int\?\s+@map\("lot_id"\)/);
  assert.match(valuationModel, /@@unique\(\[cityId, productId\]/);
  assert.doesNotMatch(valuationModel, /cityId[\s\S]*godownId/);
});

test("opening inventory movements can reference a valuation layer without a lot", () => {
  for (const modelName of ["SaleItem", "GodownTransfer", "CityTransfer"]) {
    const start = schema.indexOf(`model ${modelName}`);
    const model = schema.slice(start, schema.indexOf("\nmodel ", start + 1));
    assert.match(model, /openingInventoryValuationId\s+Int\?\s+@map\("opening_inventory_valuation_id"\)/);
    assert.match(model, /lotId\s+Int\?/);
  }
});

test("city quantity entry never creates a lot or valuation journal", () => {
  const branch = openingsRoute.match(/if \(kind === "stock"\)[\s\S]*?\n    }\n\n    if \(kind ===/m)?.[0] || "";
  assert.match(branch, /openingStock\.upsert/);
  assert.match(branch, /tx\.syncRequest\.create/);
  assert.doesNotMatch(branch, /setLegacyGodownStock|setLotGodownStock|journalOpeningInventoryValuation/);
});

test("superadmin valuation derives quantity from city opening stock and does not create a lot", () => {
  const branch = openingsRoute.match(/if \(kind === "product_inventory"\)[\s\S]*?\n    }\n\n    if \(kind ===/m)?.[0] || "";
  assert.match(branch, /openingStock\.aggregate/);
  assert.match(branch, /unique_opening_inventory_city_product/);
  assert.match(branch, /journalOpeningInventoryValuation/);
  assert.doesNotMatch(branch, /setLegacyGodownStock|lotProduct/);
});

test("opening UI separates city quantities from superadmin city-product valuation", () => {
  assert.match(openingsPage, /Opening inventory quantities/);
  assert.match(openingsPage, /City product valuation/);
  assert.match(openingsPage, /user\?\.role === "city_admin"/);
  assert.match(openingsPage, /user\?\.role === "super_admin"/);
  assert.doesNotMatch(openingsPage, /Opening godown stock \(ongoing lots\)/);
});

test("cutover blocks city-product valuation quantity mismatches", () => {
  assert.match(cutover, /openingStock\.aggregate/);
  assert.match(cutover, /row\.cityId/);
  assert.match(cutover, /if \(row\.cityId\)/);
  assert.match(cutover, /Missing valuation/);
  assert.match(cutover, /openingStock\.groupBy/);
});

test("inventory includes opening stock and exposes its immutable valuation source", () => {
  assert.match(godownStock, /opening_stocks/);
  assert.match(godownStock, /opening_inventory_valuation_id/);
  assert.match(godownStock, /sourceType:\s*"opening"/);
});

test("godown transfers preserve opening valuation source through reversal", () => {
  assert.match(godownTransfer, /openingInventoryValuationId/);
  assert.match(godownTransfer, /opening_inventory_valuation_id/);
  assert.match(godownTransferReverse, /openingInventoryValuationId:\s*original\.openingInventoryValuationId/);
  assert.match(godownTransferReverse, /opening_inventory_valuation_id/);
});

test("city transfers can send opening inventory received from another city", () => {
  assert.match(cityTransfer, /ct_in\.to_godown_id/);
  assert.match(cityTransfer, /ct_in\.status = 'approved'/);
  assert.match(cityTransfer, /opening_inventory_valuation_id/);
});

test("stock ledger begins with the city-entered opening quantity", () => {
  assert.match(stockLedger, /FROM opening_stocks os/);
  assert.match(stockLedger, /'opening_stock'\s+AS type/);
  assert.match(stockLedger, /os\.qty\s+AS qty_in/);
});
