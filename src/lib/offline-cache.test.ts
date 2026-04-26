import assert from "node:assert/strict";
import test from "node:test";

import { buildApiCacheKey } from "@/lib/offline-cache";

test("buildApiCacheKey sorts params deterministically", () => {
  const keyA = buildApiCacheKey("/api/v1/sales", { limit: 20, page: 2, q: "abc" });
  const keyB = buildApiCacheKey("/api/v1/sales", { q: "abc", page: 2, limit: 20 });
  assert.equal(keyA, keyB);
  assert.equal(keyA, "/api/v1/sales?limit=20&page=2&q=abc");
});

test("buildApiCacheKey omits empty params", () => {
  const key = buildApiCacheKey("/api/v1/payments", { q: "", page: 1, status: undefined });
  assert.equal(key, "/api/v1/payments?page=1");
});
