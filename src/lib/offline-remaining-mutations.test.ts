import test from "node:test";
import assert from "node:assert/strict";
import {
  applyQueuedMutationsToLots,
  applyQueuedMutationsToCheques,
  applyQueuedMutationsToPendingTransfers,
} from "@/lib/offline-remaining-mutations";

test("applyQueuedMutationsToLots applies edit complete reopen and delete", () => {
  const base = [
    { id: "1", lotNumber: "L-1", lotDate: "2026-01-01", notes: "old", status: "active" },
    { id: "2", lotNumber: "L-2", lotDate: "2026-01-02", notes: "", status: "active" },
  ];
  const queue = [
    { method: "PUT", url: "/api/v1/lots/1", body: JSON.stringify({ lotNumber: "L-1A", notes: "new" }) },
    { method: "PUT", url: "/api/v1/lots/1/complete", body: JSON.stringify({}) },
    { method: "PUT", url: "/api/v1/lots/2/reopen", body: JSON.stringify({}) },
    { method: "DELETE", url: "/api/v1/lots/2", body: "" },
  ];
  const next = applyQueuedMutationsToLots(base as any, queue as any);
  assert.equal(next.length, 1);
  assert.equal(next[0].lotNumber, "L-1A");
  assert.equal(next[0].notes, "new");
  assert.equal(next[0].status, "completed");
  assert.equal(next[0]._pending, true);
});

test("applyQueuedMutationsToCheques marks cheque bounced", () => {
  const base = [
    { id: "10", raw: { chequeStatus: "in_hand" } },
    { id: "11", raw: { chequeStatus: "in_hand" } },
  ];
  const queue = [
    { method: "PATCH", url: "/api/v1/payments/10", body: JSON.stringify({ action: "bounce_cheque" }) },
  ];
  const next = applyQueuedMutationsToCheques(base as any, queue as any);
  assert.equal(next[0].raw.chequeStatus, "bounced");
  assert.equal(next[0]._pending, true);
  assert.equal(next[1].raw.chequeStatus, "in_hand");
});

test("applyQueuedMutationsToPendingTransfers removes approved/rejected rows", () => {
  const base = [{ id: "100" }, { id: "200" }];
  const queue = [
    { method: "PUT", url: "/api/v1/city-transfers/100", body: JSON.stringify({ action: "approve" }) },
  ];
  const next = applyQueuedMutationsToPendingTransfers(base as any, queue as any);
  assert.deepEqual(next, [{ id: "200" }]);
});
