import test from "node:test";
import assert from "node:assert/strict";
import { hydrateFormCachesFromSyncData } from "@/lib/offline-form-cache-hydrate";
import { readOfflineFormCache } from "@/lib/offline-form-cache";
import { OFFLINE_AUTH_CACHE_KEY } from "@/lib/offline-auth-cache";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

test("hydrateFormCachesFromSyncData seeds expense form cache for city admin", () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  storage.setItem(
    OFFLINE_AUTH_CACHE_KEY,
    JSON.stringify({
      username: "kandahar",
      passwordVerifier: "x",
      updatedAt: new Date().toISOString(),
      user: {
        id: 1,
        username: "kandahar",
        fullName: "Kandahar Admin",
        role: "city_admin",
        cityId: 5,
        cityName: "Kandahar",
        countryId: 2,
        countryName: "Afghanistan",
      },
    })
  );

  hydrateFormCachesFromSyncData({
    cities: [{ id: 5, name: "Kandahar", countryName: "Afghanistan" }],
    cityCurrencies: [{ cityId: 5, currency: { id: 1, code: "USD", symbol: "$" } }],
    lots: [{ id: 10, lotNumber: "L-1", status: "ongoing", cityId: 5 }],
    bankAccounts: [{ id: 3, cityId: 5, bankName: "AIB" }],
    payments: [],
    personalWithdrawals: [{ withdrawnBy: "Ali" }],
    products: [{ id: 1, name: "Rod" }],
    godowns: [{ id: 2, cityId: 5, name: "Main" }],
  });

  const cached = readOfflineFormCache<{ lots: unknown[]; currencies: unknown[] }>(
    "mrf-expenses-form-cache-v1",
    ["lots", "currencies", "bankAccounts", "inHandCheques"]
  );
  assert.ok(cached);
  assert.equal(cached!.currencies.length, 1);
  assert.equal(cached!.lots.length, 1);
});

test("hydrateFormCachesFromSyncData seeds expense form cache for super admin with all currencies", () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  storage.setItem(
    OFFLINE_AUTH_CACHE_KEY,
    JSON.stringify({
      username: "admin",
      passwordVerifier: "x",
      updatedAt: new Date().toISOString(),
      user: {
        id: 1,
        username: "admin",
        fullName: "Super Admin",
        role: "super_admin",
        cityId: null,
        cityName: null,
        countryId: null,
        countryName: null,
      },
    })
  );

  hydrateFormCachesFromSyncData({
    cities: [{ id: 5, name: "Kandahar" }, { id: 6, name: "Herat" }],
    cityCurrencies: [
      { cityId: 5, currency: { id: 1, code: "USD", symbol: "$" } },
      { cityId: 6, currency: { id: 2, code: "AFN", symbol: "؋" } },
    ],
    lots: [{ id: 10, lotNumber: "L-1", status: "ongoing", cityId: 5 }],
    bankAccounts: [{ id: 3, cityId: 5, bankName: "AIB" }],
    payments: [],
    personalWithdrawals: [],
    products: [{ id: 1, name: "Rod" }],
    godowns: [{ id: 2, cityId: 5, name: "Main" }],
  });

  const cached = readOfflineFormCache<{ currencies: unknown[]; bankAccounts: unknown[] }>(
    "mrf-expenses-form-cache-v1",
    ["lots", "currencies", "bankAccounts", "inHandCheques"]
  );
  assert.ok(cached);
  assert.equal(cached!.currencies.length, 2);
  assert.equal(cached!.bankAccounts.length, 1);
});
