import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("lot deletion removes shipment status history before deleting the lot", () => {
  const route = readFileSync("src/app/api/v1/lots/[id]/route.ts", "utf8");
  const deleteHandler = route.slice(route.indexOf("export const DELETE"));
  const historyDelete = deleteHandler.indexOf("lotStatusHistory.deleteMany");
  const lotDelete = deleteHandler.indexOf("tx.lot.delete(");

  assert.ok(historyDelete >= 0, "lot deletion must remove dependent shipment status history");
  assert.ok(historyDelete < lotDelete, "shipment status history must be removed before the lot row");
});
