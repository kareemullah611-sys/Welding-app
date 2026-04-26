import assert from "node:assert/strict";
import test from "node:test";

import { buildPaginationItems, getPaginationRange } from "@/lib/pagination";

test("buildPaginationItems renders compact numbered window with ellipsis", () => {
  assert.deepEqual(buildPaginationItems(1, 1), [1]);
  assert.deepEqual(buildPaginationItems(1, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(buildPaginationItems(5, 10), [1, "...", 4, 5, 6, "...", 10]);
  assert.deepEqual(buildPaginationItems(10, 10), [1, "...", 7, 8, 9, 10]);
});

test("getPaginationRange returns visible range for current page", () => {
  assert.deepEqual(getPaginationRange({ page: 1, pageSize: 20, total: 124 }), { start: 1, end: 20 });
  assert.deepEqual(getPaginationRange({ page: 2, pageSize: 20, total: 124 }), { start: 21, end: 40 });
  assert.deepEqual(getPaginationRange({ page: 7, pageSize: 20, total: 124 }), { start: 121, end: 124 });
});
