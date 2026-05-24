import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
} from "@/lib/offline-cache";
import { hydrateOfflineCachesFromSyncPayload } from "@/lib/offline-sync-hydrate";

const FULL_SYNC_STORE = "full_sync_data";
const FULL_SYNC_META_STORE = "full_sync_meta";
const META_KEY = "sync_meta";

const SYNC_MODULE_KEYS = [
  "countries", "currencies", "cityCurrencies", "cities", "godowns", "products",
  "customers", "suppliers", "agents", "shippingLines", "intermediaries",
  "investors", "bankAccounts", "lots", "sales", "payments", "expenses",
  "personalWithdrawals", "hajiTransfers", "supplierPayments", "agentPayments",
  "shippingLinePayments", "bankDeposits", "cityTransfers",
  "openingCashes", "openingCustomerBalances", "openingStocks", "openingLiabilities",
  "intermediaryDeposits", "intermediaryExchanges",
  "investorDeposits", "investorWithdrawals",
  "superAdminExpenses", "voucherSequences",
  "lotPurchases", "lotCosts", "godownTransfers",
] as const;

function openDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined") return Promise.reject(new Error("offline db unavailable"));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(FULL_SYNC_STORE)) {
        db.createObjectStore(FULL_SYNC_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(FULL_SYNC_META_STORE)) {
        db.createObjectStore(FULL_SYNC_META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store: string, value: { key: string } & Record<string, unknown>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllKeys(store: string): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).getAllKeys();
    r.onsuccess = () => resolve((r.result as string[]) || []);
    r.onerror = () => reject(r.error);
  });
}

async function replaceFullSyncModules(data: Record<string, unknown>) {
  const written = new Set<string>();
  for (const mod of SYNC_MODULE_KEYS) {
    if (data[mod] === undefined) continue;
    await dbPut(FULL_SYNC_STORE, { key: mod, data: data[mod] });
    written.add(mod);
  }
  const existingKeys = await dbGetAllKeys(FULL_SYNC_STORE);
  for (const key of existingKeys) {
    if (!written.has(key)) {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(FULL_SYNC_STORE, "readwrite");
        tx.objectStore(FULL_SYNC_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }
}

export async function isOfflineSyncStoreEmpty(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    const keys = await dbGetAllKeys(FULL_SYNC_STORE);
    return keys.length === 0;
  } catch {
    return true;
  }
}

/** Import a sync-all shaped payload into IndexedDB (no queue/auth). */
export async function importOfflineSyncPayload(
  modules: Record<string, unknown>,
  options?: { bundledAt?: string | null }
): Promise<void> {
  if (typeof window === "undefined") return;
  const moduleCount = SYNC_MODULE_KEYS.filter((k) => Array.isArray(modules[k]) && (modules[k] as unknown[]).length > 0).length;
  if (moduleCount === 0) return;

  await replaceFullSyncModules(modules);
  await hydrateOfflineCachesFromSyncPayload(modules);

  const bundledAt = options?.bundledAt || new Date().toISOString();
  await dbPut(FULL_SYNC_META_STORE, {
    key: META_KEY,
    lastSyncedAt: bundledAt,
    lastAttemptedAt: bundledAt,
    status: "completed",
    error: null,
    moduleCounts: (modules.counts as Record<string, number>) || null,
    seedSource: "bundled",
  });
}
