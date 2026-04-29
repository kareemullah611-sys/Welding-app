import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQueuedMutationToReadModel,
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
  assert.equal(canApplyCreateToReadModel("/api/v1/unknown-module", "POST"), false);
});

test("allows operational treasury endpoints for local read-model creates", () => {
  assert.equal(canApplyCreateToReadModel("/api/v1/expenses", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/personal-withdrawals", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/haji-transfers", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/bank-deposits", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/city-transfers", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/suppliers", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/intermediaries", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/products", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/users", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/godowns", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/bank-accounts", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/shipping-lines", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/agents", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/investors", "POST"), true);
  assert.equal(canApplyCreateToReadModel("/api/v1/lots", "POST"), true);
});

test("removes a pending row when queue item is synced", () => {
  const result = removePendingReadModelRowsByQueueId(
    [{ id: "pending-q1", amount: 100 }, { id: "2", amount: 200 }],
    "q1"
  ) as any[];
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "2");
});

test("applies queued delete mutation to read model rows", () => {
  const rows = [{ id: "1", name: "A" }, { id: "2", name: "B" }];
  const next = applyQueuedMutationToReadModel(rows, "/api/v1/customers/1", "DELETE", null) as any[];
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "2");
});

test("applies queued update mutation to read model rows", () => {
  const rows = [{ id: "1", detail: "old", amount: 10 }, { id: "2", detail: "x", amount: 20 }];
  const next = applyQueuedMutationToReadModel(rows, "/api/v1/expenses/1", "PUT", { detail: "new" }) as any[];
  assert.equal(next.length, 2);
  assert.equal(next[0].detail, "new");
  assert.equal(next[0].amount, 10);
});
