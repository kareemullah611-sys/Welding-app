import test from "node:test";
import assert from "node:assert/strict";
import { formatInventoryDate, formatStockMovementType } from "@/lib/stock-movement-display";

test("formatStockMovementType maps godown transfers to In/Out", () => {
  assert.equal(formatStockMovementType("godown_in").label, "In");
  assert.equal(formatStockMovementType("godown_out").label, "Out");
  assert.equal(formatStockMovementType("city_in").label, "Transfer In");
  assert.equal(formatStockMovementType("allocation").label, "Allocation");
});

test("formatInventoryDate renders dd-mm-yy", () => {
  assert.equal(formatInventoryDate("2026-03-15"), "15-03-26");
});
