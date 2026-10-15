import test from "node:test";
import assert from "node:assert/strict";
import { getOfflineAggregateForApiRequest, getOfflineExactPrefetchRequests } from "@/lib/offline-aggregate-prefetch";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

test("getOfflineAggregateForApiRequest reads dashboard snapshot fields", () => {
  const prevEnv = process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
  process.env.NEXT_PUBLIC_OFFLINE_ENABLED = "true";
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  try {
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
  } finally {
    if (prevEnv === undefined) delete process.env.NEXT_PUBLIC_OFFLINE_ENABLED;
    else process.env.NEXT_PUBLIC_OFFLINE_ENABLED = prevEnv;
  }
});

test("exact prefetch requests cover authoritative city ledgers and superadmin reports", () => {
  const cityRequests = getOfflineExactPrefetchRequests(
    { role: "city_admin", cityId: 7 },
    2026,
    []
  );
  assert.ok(cityRequests.some((request) => request.path === "/api/v1/finance/combined" && request.params.limit === 20));
  assert.ok(cityRequests.some((request) => request.path === "/api/v1/city-ledger" && request.params.city_id === 7));

  const superRequests = getOfflineExactPrefetchRequests(
    { role: "super_admin", cityId: null },
    2026,
    [{ status: "open", startDate: "2026-03-01", endDate: "2027-02-18" }]
  );
  assert.ok(superRequests.some((request) => request.path === "/api/v1/financial-reports" && request.params.report === "pnl"));
  assert.ok(superRequests.some((request) => request.path === "/api/v1/trial-balance" && request.params.date_from === "2026-03-01"));
  assert.ok(superRequests.some((request) => request.path === "/api/v1/finance/combined" && request.params.destination === "haji"));
});
