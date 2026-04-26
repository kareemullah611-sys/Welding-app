import assert from "node:assert/strict";
import test from "node:test";

import { buildApiCacheKey, shouldAutoQueueOfflineWrite } from "@/lib/offline-cache";

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

test("shouldAutoQueueOfflineWrite only queues non-auth API writes", () => {
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/payments", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/customers/1", "PUT"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/auth/login", "POST"), false);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/auth/me", "GET"), false);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/payments", "GET"), false);
  assert.equal(shouldAutoQueueOfflineWrite("/external", "POST"), false);
});
