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

  const cached = readOfflineFormCache<{
    lots: unknown[];
    currencies: unknown[];
    bankAccounts: unknown[];
    inHandCheques: unknown[];
  }>(
    "mrf-expenses-form-cache-v1",
    ["lots", "currencies", "bankAccounts", "inHandCheques"]
  );
  assert.ok(cached);
  assert.equal(cached!.currencies.length, 1);
  assert.equal(cached!.lots.length, 1);
});

test("hydrateFormCachesFromSyncData seeds complete sale and payment form caches", () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  storage.setItem(
    OFFLINE_AUTH_CACHE_KEY,
    JSON.stringify({
      username: "lahore",
      passwordVerifier: "x",
      updatedAt: new Date().toISOString(),
      user: {
        id: 2,
        username: "lahore",
        fullName: "Lahore Admin",
        role: "city_admin",
        cityId: 7,
        cityName: "Lahore",
        countryId: 1,
        countryName: "Pakistan",
      },
    })
  );

  hydrateFormCachesFromSyncData({
    cities: [{ id: 7, name: "Lahore", countryName: "Pakistan" }],
    cityCurrencies: [{ cityId: 7, currency: { id: 1, code: "PKR", symbol: "Rs" } }],
    lots: [{ id: 10, lotNumber: "L-1", status: "ongoing", cityId: 7 }],
    bankAccounts: [{ id: 3, cityId: 7, bankName: "MCB" }],
    payments: [{
      id: 9,
      status: "active",
      paymentMethod: "cheque",
      destination: "our_account",
      chequeStatus: "in_hand",
    }],
    personalWithdrawals: [],
    products: [{ id: 1, name: "Rod" }],
    godowns: [{ id: 2, cityId: 7, name: "Main" }],
    superAdminBankAccounts: [{ id: 12, bankName: "HBL", accountNumber: "1234", currencyId: 1, accountKind: "bank", isActive: true }],
  });

  const salesRaw = storage.getItem("mrf-sales-form-cache-v1");
  assert.ok(salesRaw);
  const sales = JSON.parse(salesRaw!);
  assert.equal(sales.godowns.length, 1);
  assert.equal(sales.products.length, 1);
  assert.equal(sales.lots.length, 1);
  assert.equal(sales.currencies.length, 1);

  const payments = readOfflineFormCache<{
    lots: unknown[];
    currencies: unknown[];
    cityBankAccounts: unknown[];
    superAdminBankAccounts: unknown[];
    inHandCheques: unknown[];
  }>("mrf-payments-form-cache-v1", [
    "lots",
    "currencies",
    "cityBankAccounts",
    "superAdminBankAccounts",
    "inHandCheques",
  ]);
  assert.ok(payments);
  assert.equal(payments!.inHandCheques.length, 1);
  assert.equal(payments!.superAdminBankAccounts.length, 1);

  const haji = readOfflineFormCache<{
    lots: unknown[];
    currencies: unknown[];
    bankAccounts: unknown[];
    inHandCheques: unknown[];
    superAdminBankAccounts: unknown[];
  }>("mrf-haji-form-cache-v1", [
    "lots",
    "currencies",
    "bankAccounts",
    "inHandCheques",
    "superAdminBankAccounts",
  ]);
  assert.ok(haji);
  assert.equal(haji!.superAdminBankAccounts.length, 1);
});

test("hydrateFormCachesFromSyncData groups Afghanistan settlement options by currency", () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  storage.setItem(
    OFFLINE_AUTH_CACHE_KEY,
    JSON.stringify({
      username: "kandahar",
      passwordVerifier: "x",
      updatedAt: new Date().toISOString(),
      user: {
        id: 3,
        username: "kandahar",
        fullName: "Kandahar Admin",
        role: "city_admin",
        cityId: 8,
        cityName: "Kandahar",
        countryId: 2,
        countryName: "Afghanistan",
      },
    })
  );

  hydrateFormCachesFromSyncData({
    cities: [{ id: 8, name: "Kandahar", countryName: "Afghanistan" }],
    cityCurrencies: [{ cityId: 8, currency: { id: 2, code: "AFN", symbol: "؋" } }],
    lots: [],
    bankAccounts: [],
    payments: [],
    personalWithdrawals: [],
    products: [],
    godowns: [],
    intermediaries: [{ id: 31, name: "Exchange Agent", isActive: true }],
    superAdminBankAccounts: [{ id: 41, bankName: "AFN Cash", currencyId: 2, accountKind: "cash", isActive: true }],
  });

  const haji = readOfflineFormCache<{
    lots: unknown[];
    currencies: unknown[];
    bankAccounts: unknown[];
    inHandCheques: unknown[];
    superAdminBankAccounts: unknown[];
    settlementByCurrency: Record<string, { intermediaries: unknown[]; superAdminCashAccounts: unknown[] }>;
  }>("mrf-haji-form-cache-v1", [
    "lots",
    "currencies",
    "bankAccounts",
    "inHandCheques",
    "superAdminBankAccounts",
  ]);
  assert.ok(haji);
  assert.equal(haji!.settlementByCurrency["2"].intermediaries.length, 1);
  assert.equal(haji!.settlementByCurrency["2"].superAdminCashAccounts.length, 1);
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
    cities: [{ id: 5, name: "Kandahar" }, { id: 6, name: "Abdul Khaliq" }],
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

  const cached = readOfflineFormCache<{
    currencies: unknown[];
    bankAccounts: unknown[];
    lots: unknown[];
    inHandCheques: unknown[];
  }>(
    "mrf-expenses-form-cache-v1",
    ["lots", "currencies", "bankAccounts", "inHandCheques"]
  );
  assert.ok(cached);
  assert.equal(cached!.currencies.length, 2);
  assert.equal(cached!.bankAccounts.length, 1);
});
