import {
  OFFLINE_API_CACHE_STORE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_LOCAL_READ_MODEL_STORE,
  buildApiCacheKey,
} from "@/lib/offline-cache";
import { getReadModelKey } from "@/lib/offline-local-read-model";
import { writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { hydrateFormCachesFromSyncData } from "@/lib/offline-form-cache-hydrate";
import { prefetchOfflineAggregateSnapshots } from "@/lib/offline-aggregate-prefetch";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
const SNAPSHOT_KEYS = {
  customers: "mrf-customers-read-cache-v1",
  sales: "mrf-sales-read-cache-v1",
  payments: "mrf-payments-read-cache-v1",
  expenses: "mrf-expenses-read-cache-v1",
  suppliers: "mrf-suppliers-read-cache-v1",
  agents: "mrf-agents-read-cache-v1",
  shippingLines: "mrf-shipping-lines-read-cache-v1",
  intermediaries: "mrf-intermediaries-read-cache-v1",
  investors: "mrf-investors-read-cache-v1",
  lots: "mrf-lots-read-cache-v1",
  personalWithdrawals: "mrf-withdrawals-read-cache-v1",
  hajiTransfers: "mrf-haji-read-cache-v1",
  bankDeposits: "mrf-bank-deposits-read-cache-v1",
  cityTransfers: "mrf-city-transfers-read-cache-v1",
  superAdminExpenses: "mrf-sa-personal-expenses-read-cache-v1",
  godowns: "mrf-godowns-read-cache-v1",
  products: "mrf-settings-products-read-cache-v1",
  cities: "mrf-settings-cities-read-cache-v1",
  bankAccounts: "mrf-bank-accounts-read-cache-v1",
} as const;

const SNAPSHOT_LIST_FIELD: Record<string, string> = {
  customers: "customers",
  sales: "sales",
  payments: "payments",
  expenses: "expenses",
  suppliers: "suppliers",
  agents: "agents",
  shippingLines: "shippingLines",
  intermediaries: "intermediaries",
  investors: "investors",
  lots: "lots",
  personalWithdrawals: "withdrawals",
  hajiTransfers: "transfers",
  bankDeposits: "deposits",
  cityTransfers: "transfers",
  superAdminExpenses: "expenses",
  godowns: "godowns",
  products: "products",
  cities: "cities",
  bankAccounts: "bankAccounts",
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putStoreRow(store: string, value: unknown): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function listRowsForModule(data: Record<string, unknown>, moduleKey: string): unknown[] | null {
  const rows = data[moduleKey];
  return Array.isArray(rows) ? rows : null;
}

function hydrateReadSnapshots(data: Record<string, unknown>) {
  for (const [moduleKey, cacheKey] of Object.entries(SNAPSHOT_KEYS)) {
    const rows = listRowsForModule(data, moduleKey);
    if (!rows?.length) continue;

    const field = SNAPSHOT_LIST_FIELD[moduleKey] || moduleKey;
    if (moduleKey === "customers") {
      writeOfflineReadSnapshot(cacheKey, { customers: rows, ledgerByCustomer: {} });
      continue;
    }
    if (moduleKey === "suppliers") {
      writeOfflineReadSnapshot(cacheKey, {
        suppliers: rows,
        lots: listRowsForModule(data, "lots") || [],
        bankAccounts: listRowsForModule(data, "bankAccounts") || [],
        intermediaries: listRowsForModule(data, "intermediaries") || [],
        ledgerBySupplier: {},
      });
      continue;
    }
    if (moduleKey === "godowns") {
      writeOfflineReadSnapshot(cacheKey, {
        godowns: rows,
        cities: listRowsForModule(data, "cities") || [],
      });
      continue;
    }
    if (moduleKey === "investors") {
      writeOfflineReadSnapshot(cacheKey, { investors: rows });
      continue;
    }
    if (moduleKey === "products" || moduleKey === "cities" || moduleKey === "bankAccounts") {
      writeOfflineReadSnapshot(cacheKey, { [field]: rows });
      continue;
    }

    writeOfflineReadSnapshot(cacheKey, {
      [field]: rows,
      totalPages: 1,
      total: rows.length,
    });
  }
}

async function hydrateApiCaches(data: Record<string, unknown>) {
  const now = Date.now();
  const pathModulePairs: Array<[string, string]> = [
    ["/api/v1/customers", "customers"],
    ["/api/v1/sales", "sales"],
    ["/api/v1/payments", "payments"],
    ["/api/v1/expenses", "expenses"],
    ["/api/v1/godowns", "godowns"],
    ["/api/v1/products", "products"],
    ["/api/v1/cities", "cities"],
    ["/api/v1/currencies", "currencies"],
    ["/api/v1/countries", "countries"],
    ["/api/v1/lots", "lots"],
    ["/api/v1/suppliers", "suppliers"],
    ["/api/v1/agents", "agents"],
    ["/api/v1/shipping-lines", "shippingLines"],
    ["/api/v1/intermediaries", "intermediaries"],
    ["/api/v1/investors", "investors"],
    ["/api/v1/bank-accounts", "bankAccounts"],
    ["/api/v1/personal-withdrawals", "personalWithdrawals"],
    ["/api/v1/haji-transfers", "hajiTransfers"],
    ["/api/v1/bank-deposits", "bankDeposits"],
    ["/api/v1/city-transfers", "cityTransfers"],
    ["/api/v1/supplier-payments", "supplierPayments"],
    ["/api/v1/agent-payments", "agentPayments"],
    ["/api/v1/shipping-line-payments", "shippingLinePayments"],
    ["/api/v1/super-admin-personal-expenses", "superAdminExpenses"],
  ];

  for (const [path, moduleKey] of pathModulePairs) {
    const rows = listRowsForModule(data, moduleKey);
    if (!rows) continue;

    const cacheKey = buildApiCacheKey(path, undefined);
    const readModelKey = getReadModelKey(path, undefined);
    await putStoreRow(OFFLINE_API_CACHE_STORE, { key: cacheKey, data: rows, cachedAt: now });
    await putStoreRow(OFFLINE_LOCAL_READ_MODEL_STORE, {
      key: readModelKey,
      data: rows,
      updatedAt: now,
    });

    // Common paginated request shape used by list pages
    const pagedKey = buildApiCacheKey(path, { page: 1, limit: DEFAULT_LIST_PAGE_SIZE });
    if (pagedKey !== cacheKey) {
      await putStoreRow(OFFLINE_API_CACHE_STORE, {
        key: pagedKey,
        data: rows.slice(0, 20),
        pagination: { total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / DEFAULT_LIST_PAGE_SIZE)), page: 1, limit: DEFAULT_LIST_PAGE_SIZE },
        cachedAt: now,
      });
    }
  }
}

export async function hydrateOfflineCachesFromSyncPayload(data: Record<string, unknown>): Promise<void> {
  await hydrateApiCaches(data);
  hydrateReadSnapshots(data);
  hydrateFormCachesFromSyncData(data);
  await prefetchOfflineAggregateSnapshots();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("mrf-offline-full-sync-complete"));
  }
}
