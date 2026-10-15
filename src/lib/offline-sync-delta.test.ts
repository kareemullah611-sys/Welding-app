import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildOfflineSyncDelta,
  computeOfflineModuleHashes,
  mergeOfflineSyncModules,
} from "@/lib/offline-sync-delta";

test("first synchronization returns every module", () => {
  const payload = { customers: [{ id: 1 }], sales: [{ id: 2 }], counts: {}, syncedAt: "2026-10-09T00:00:00.000Z" };
  const result = buildOfflineSyncDelta(payload, null);

  assert.equal(result._sync.mode, "full");
  assert.deepEqual(result.customers, payload.customers);
  assert.deepEqual(result.sales, payload.sales);
});

test("incremental synchronization sends only changed complete modules", () => {
  const before = { customers: [{ id: 1, name: "Ali" }], sales: [{ id: 2 }] };
  const after = { customers: [{ id: 1, name: "Ahmed" }], sales: [{ id: 2 }] };
  const result = buildOfflineSyncDelta(after, computeOfflineModuleHashes(before));

  assert.equal(result._sync.mode, "incremental");
  assert.deepEqual(result.customers, after.customers);
  assert.equal(result.sales, undefined);
});

test("an emptied module is transmitted so local deletions reconcile", () => {
  const before = { customers: [{ id: 1 }], sales: [{ id: 2 }] };
  const after = { customers: [], sales: [{ id: 2 }] };
  const result = buildOfflineSyncDelta(after, computeOfflineModuleHashes(before));

  assert.deepEqual(result.customers, []);
  assert.equal(result.sales, undefined);
});

test("incremental merge preserves unchanged modules and replaces changed modules", () => {
  const existing = { customers: [{ id: 1 }], sales: [{ id: 2 }] };
  const changed = { customers: [{ id: 3 }] };

  assert.deepEqual(mergeOfflineSyncModules(existing, changed), {
    customers: [{ id: 3 }],
    sales: [{ id: 2 }],
  });
});

test("full sync reads the previous cursor before marking the attempt as syncing", () => {
  const source = fs.readFileSync("src/lib/offline-full-sync.ts", "utf8");
  const functionStart = source.indexOf("export async function performFullSync");
  const previousMeta = source.indexOf("const existingMeta = await getSyncMeta()", functionStart);
  const syncingWrite = source.indexOf("await dbPut(FULL_SYNC_META_STORE", functionStart);

  assert.ok(previousMeta > functionStart);
  assert.ok(previousMeta < syncingWrite);
});
