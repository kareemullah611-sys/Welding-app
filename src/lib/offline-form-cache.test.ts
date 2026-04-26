import test from "node:test";
import assert from "node:assert/strict";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";

type PaymentCache = {
  lots: unknown[];
  currencies: unknown[];
  cityBankAccounts: unknown[];
  superAdminBankAccounts: unknown[];
};

test("readOfflineFormCache returns null when key is missing", () => {
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  assert.equal(
    readOfflineFormCache<PaymentCache>("missing", ["lots", "currencies"]),
    null,
  );
});

test("writeOfflineFormCache writes envelope and readOfflineFormCache restores it", () => {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  };
  const cache: PaymentCache = {
    lots: [{ id: 1 }],
    currencies: [{ id: 1, code: "PKR" }],
    cityBankAccounts: [],
    superAdminBankAccounts: [],
  };
  writeOfflineFormCache("payment-cache", cache);
  const loaded = readOfflineFormCache<PaymentCache>("payment-cache", [
    "lots",
    "currencies",
    "cityBankAccounts",
    "superAdminBankAccounts",
  ]);
  assert.deepEqual(loaded, cache);
});

test("readOfflineFormCache returns null when required arrays are malformed", () => {
  const store = new Map<string, string>();
  store.set("broken", JSON.stringify({ cachedAt: Date.now(), data: { lots: "bad", currencies: [] } }));
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  };
  assert.equal(
    readOfflineFormCache<{ lots: unknown[]; currencies: unknown[] }>("broken", ["lots", "currencies"]),
    null,
  );
});
