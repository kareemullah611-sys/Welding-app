import { strict as assert } from "node:assert";
import test from "node:test";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";

test("keeps only pending rows that still exist in the active queue for the module", () => {
  const rows = [
    { id: "pending-a1", _pending: true, detail: "keep" },
    { id: "pending-x9", _pending: true, detail: "drop" },
    { id: 55, detail: "server row" },
  ];
  const queue = [
    { id: "a1", pathname: "/payments", method: "POST" },
    { id: "b2", pathname: "/sales", method: "POST" },
  ];

  const pruned = pruneStalePendingRows(rows, queue, "/payments");
  assert.equal(pruned.length, 2);
  assert.equal(pruned[0].id, "pending-a1");
  assert.equal(pruned[1].id, 55);
});

