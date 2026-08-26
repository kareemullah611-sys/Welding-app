import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("approved city transfers are not deducted twice from current godown stock", () => {
  const godownStockRoute = readFileSync("src/app/api/v1/inventory/godown-stock/route.ts", "utf8");
  const salesRoute = readFileSync("src/app/api/v1/sales/route.ts", "utf8");
  const saleCorrectRoute = readFileSync("src/app/api/v1/sales/[id]/correct/route.ts", "utf8");
  const approvalRoute = readFileSync("src/app/api/v1/city-transfers/[id]/route.ts", "utf8");

  assert.doesNotMatch(godownStockRoute, /ct\.status IN \('approved', 'pending'\)/);
  assert.doesNotMatch(godownStockRoute, /city_transferred_in/);
  assert.match(godownStockRoute, /ct\.status = 'pending'/);

  assert.doesNotMatch(salesRoute, /status: \{ in: \["approved", "pending"\] \}/);
  assert.doesNotMatch(salesRoute, /cityTransferredIn/);
  assert.match(salesRoute, /status: "pending"/);

  assert.doesNotMatch(saleCorrectRoute, /ct\.status IN \('approved', 'pending'\)/);
  assert.doesNotMatch(saleCorrectRoute, /city_in AS/);
  assert.match(saleCorrectRoute, /ct\.status = 'pending'/);

  assert.doesNotMatch(approvalRoute, /AND ct\.status = 'approved'/);
  assert.match(approvalRoute, /AND ct\.status = 'pending'/);
});
