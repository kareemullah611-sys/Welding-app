import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { groupCityTransferRows, normalizeCityTransferRequest } from "./city-transfer-batch";

test("normalizes multi-product city transfer input without merging source godowns", () => {
  const normalized = normalizeCityTransferRequest({
    toCityId: 9,
    transferDate: "2026-09-27",
    items: [
      { productId: 4, sources: [{ fromGodownId: 11, qty: 7 }, { fromGodownId: 12, qty: 3 }] },
      { productId: 5, sources: [{ fromGodownId: 11, qty: 2 }] },
    ],
  });

  assert.equal(normalized.toCityId, 9);
  assert.equal(normalized.items.length, 2);
  assert.deepEqual(normalized.items[0].sources, [
    { fromGodownId: 11, qty: 7, lotId: null },
    { fromGodownId: 12, qty: 3, lotId: null },
  ]);
});

test("groups source rows into one receiver-facing batch with product totals", () => {
  const shared = {
    batchId: "batch-1",
    fromCity: { id: 1, name: "A" },
    toCity: { id: 2, name: "B" },
    status: "pending",
  };
  const grouped = groupCityTransferRows([
    { ...shared, id: 1, product: { id: 10, name: "2.5mm" }, fromGodown: { id: 1, name: "G1" }, lot: { id: 1, lotNumber: "L1" }, qty: 7 },
    { ...shared, id: 2, product: { id: 10, name: "2.5mm" }, fromGodown: { id: 2, name: "G2" }, lot: { id: 1, lotNumber: "L1" }, qty: 3 },
    { ...shared, id: 3, product: { id: 11, name: "3.2mm" }, fromGodown: { id: 1, name: "G1" }, lot: { id: 2, lotNumber: "L2" }, qty: 4 },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].items.length, 2);
  assert.equal(grouped[0].items[0].qty, 10);
  assert.equal(grouped[0].items[1].qty, 4);
  assert.equal(grouped[0].qty, 14);
});

test("city transfer batches support multiple products and multiple source godowns", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations_legacy_pre_baseline/20260926040000_city_transfer_batches/migration.sql", "utf8");
  const createRoute = readFileSync("src/app/api/v1/city-transfers/route.ts", "utf8");
  const actionRoute = readFileSync("src/app/api/v1/city-transfers/[id]/route.ts", "utf8");
  const page = readFileSync("src/app/(dashboard)/city-transfers/page.tsx", "utf8");

  assert.match(schema, /batchId\s+String\?\s+@map\("batch_id"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "batch_id"/);
  assert.doesNotMatch(migration, /DROP|TRUNCATE|DELETE/i);
  assert.match(createRoute, /normalizeCityTransferRequest/);
  assert.match(createRoute, /for \(const item of requestData\.items\)/);
  assert.match(createRoute, /for \(const source of item\.sources\)/);
  assert.match(createRoute, /qty: \{ decrement: allocation\.qty \}/);
  assert.match(createRoute, /allocatedQty: \{ decrement: allocation\.qty \}/);
  assert.match(actionRoute, /qty: \{ increment: Number\(row\.qty\) \}/);
  assert.match(actionRoute, /if \(!row\.batchId\)/);
  assert.match(actionRoute, /data: \{ qty: \{ decrement: transferQty \} \}/);
  assert.match(page, /addTransferProduct/);
  assert.match(page, /addTransferSource/);
  assert.match(page, /Source Godown/);
});

test("receiving inventory and sidebar expose incoming transfer notifications", () => {
  const inventoryPage = readFileSync("src/app/(dashboard)/inventory/page.tsx", "utf8");
  const inventoryRoute = readFileSync("src/app/api/v1/inventory/route.ts", "utf8");
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  assert.match(inventoryPage, /pendingTransfers\.length/);
  assert.match(inventoryPage, /New Goods/);
  assert.match(inventoryRoute, /'In Transit' as godown_name/);
  assert.match(inventoryRoute, /ct\.status = 'pending'/);
  assert.match(sidebar, /item\.href === "\/inventory" && pendingTransfers > 0/);
});
