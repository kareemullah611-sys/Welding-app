import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSyncedListRows,
  getModuleKeyForApiPath,
  paginateSyncedList,
} from "@/lib/offline-full-sync-read";

test("getModuleKeyForApiPath maps list endpoints", () => {
  assert.equal(getModuleKeyForApiPath("/api/v1/sales"), "sales");
  assert.equal(getModuleKeyForApiPath("/api/v1/shipping-lines"), "shippingLines");
  assert.equal(getModuleKeyForApiPath("/api/v1/unknown"), null);
});

test("paginateSyncedList slices rows", () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i + 1 }));
  const page1 = paginateSyncedList(rows, { page: 1, limit: 20 });
  assert.equal(page1.data.length, 20);
  assert.equal(page1.pagination.total, 45);
  assert.equal(page1.pagination.totalPages, 3);

  const page3 = paginateSyncedList(rows, { page: 3, limit: 20 });
  assert.equal(page3.data.length, 5);
});

test("filterSyncedListRows applies is_active and q", () => {
  const rows = [
    { id: 1, name: "Alpha", isActive: true },
    { id: 2, name: "Beta", isActive: false },
  ];
  const activeOnly = filterSyncedListRows(rows, { is_active: "true" });
  assert.equal(activeOnly.length, 1);
  assert.equal((activeOnly[0] as { name: string }).name, "Alpha");

  const search = filterSyncedListRows(rows, { q: "beta" });
  assert.equal(search.length, 1);
});
