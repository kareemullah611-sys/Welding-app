import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("city transfers deduct source allocations once at submit and not again at approval", () => {
  const godownStockRoute = readFileSync("src/app/api/v1/inventory/godown-stock/route.ts", "utf8");
  const salesRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const saleCorrectRoute = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");
  const approvalRoute = readFileSync("src/app/api/v1/city-transfers/[id]/route.ts", "utf8");

  assert.match(godownStockRoute, /legacy_city_transferred_out/);
  assert.match(godownStockRoute, /ct\.batch_id IS NULL/);
  assert.doesNotMatch(godownStockRoute, /city_transferred_in/);

  assert.doesNotMatch(salesRoute, /status: \{ in: \["approved", "pending"\] \}/);
  assert.doesNotMatch(salesRoute, /cityTransferredIn/);
  assert.match(salesRoute, /status: "pending", batchId: null/);

  assert.doesNotMatch(saleCorrectRoute, /ct\.status IN \('approved', 'pending'\)/);
  assert.doesNotMatch(saleCorrectRoute, /city_in AS/);
  assert.match(saleCorrectRoute, /ct\.status = 'pending'/);
  assert.match(saleCorrectRoute, /ct\.batch_id IS NULL/);

  assert.match(approvalRoute, /allocatedQty: \{ increment: transferQty \}/);
  assert.match(approvalRoute, /if \(!row\.batchId\)/);
  assert.match(approvalRoute, /data: \{ qty: \{ decrement: transferQty \} \}/);
});
