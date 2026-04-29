import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPendingRecordId,
  createIdMapRecord,
  extractServerId,
  reconcileIdsInReadModel,
} from "@/lib/offline-id-reconciliation";

test("extracts server id from route payload", () => {
  assert.equal(extractServerId({ id: 123 }), "123");
  assert.equal(extractServerId({ data: { id: "44" } }), "44");
  assert.equal(extractServerId({ ok: true }), null);
});

test("creates map record with pending id", () => {
  const rec = createIdMapRecord("/api/v1/customers", "q1", 77);
  assert.equal(rec.pendingId, "pending-q1");
  assert.equal(rec.serverId, "77");
  assert.equal(rec.entityPath, "/api/v1/customers");
});

test("reconciles pending id deeply across read-model structure", () => {
  const pendingId = buildPendingRecordId("q1");
  const input = [
    { id: pendingId, customerId: pendingId, nested: { ref: pendingId } },
    { id: "2", customerId: pendingId },
  ];
  const out = reconcileIdsInReadModel(input, pendingId, "99") as any[];
  assert.equal(out[0].id, "99");
  assert.equal(out[0].customerId, "99");
  assert.equal(out[0].nested.ref, "99");
  assert.equal(out[1].id, "2");
  assert.equal(out[1].customerId, "99");
});
