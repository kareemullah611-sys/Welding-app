import test from "node:test";
import assert from "node:assert/strict";
import { getOfflineAggregateForApiRequest } from "@/lib/offline-aggregate-prefetch";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

test("getOfflineAggregateForApiRequest reads dashboard snapshot fields", () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  storage.setItem(
    "mrf-dashboard-read-cache-v1",
    JSON.stringify({
      cachedAt: Date.now(),
      data: {
        data: { totalCartonsSold: 42 },
        cashPosition: { netCashInHand: 1000 },
        treasury: { balance: 500 },
      },
    })
  );

  const dash = getOfflineAggregateForApiRequest<{ totalCartonsSold: number }>("/api/v1/dashboard");
  assert.deepEqual(dash?.data, { totalCartonsSold: 42 });

  const cash = getOfflineAggregateForApiRequest<{ netCashInHand: number }>("/api/v1/cash-position");
  assert.deepEqual(cash?.data, { netCashInHand: 1000 });
});
