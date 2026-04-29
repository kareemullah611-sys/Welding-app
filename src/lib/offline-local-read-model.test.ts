import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPendingReadModelRow,
  canApplyCreateToReadModel,
  mergeReadModelRows,
  removePendingReadModelRowsByQueueId,
} from "@/lib/offline-local-read-model";

test("creates pending customer read-model row", () => {
  const row = buildPendingReadModelRow("/api/v1/customers", { name: "New Cust", phone: "123" }, "q1", 1000);
  assert.ok(row);
  assert.equal((row as any).id, "pending-q1");
  assert.equal((row as any).name, "New Cust");
  assert.equal((row as any).isActive, true);
});

test("merges pending rows ahead of base rows without duplicate ids", () => {
  const merged = mergeReadModelRows(
    [{ id: "1", name: "Old" }, { id: "2", name: "Base Two" }],
    [{ id: "2", name: "Pending Override" }, { id: "pending-1", name: "Pending New", _pending: true }]
  ) as any[];
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "2");
  assert.equal(merged[1].id, "pending-1");
});

test("only allows local read-model create application for selected endpoints", () => {
  assert.equal(canApplyCreateToReadModel("/api/v1/customers", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/sales", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/payments", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/customers", "PUT"), false);
  assert.equal(canApplyCreateToReadModel("/api/v1/suppliers", "POST"), false);
});

test("allows operational treasury endpoints for local read-model creates", () => {
  assert.equal(canApplyCreateToReadModel("/api/v1/expenses", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/personal-withdrawals", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/haji-transfers", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/bank-deposits", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/city-transfers", "POST"), true);
});

test("removes a pending row when queue item is synced", () => {
  const result = removePendingReadModelRowsByQueueId(
    [{ id: "pending-q1", amount: 100 }, { id: "2", amount: 200 }],
    "q1"
  ) as any[];
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "2");
});
