import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
} from "@/lib/offline-cache";
import { hydrateOfflineCachesFromSyncPayload } from "@/lib/offline-sync-hydrate";

const FULL_SYNC_STORE = "full_sync_data";
const FULL_SYNC_META_STORE = "full_sync_meta";
const META_KEY = "sync_meta";

const SYNC_MODULES = [
  "countries", "currencies", "cityCurrencies", "cities", "godowns", "products",
  "customers", "suppliers", "agents", "shippingLines", "intermediaries",
  "investors", "bankAccounts", "lots", "sales", "payments", "expenses",
  "personalWithdrawals", "hajiTransfers", "supplierPayments", "agentPayments",
  "shippingLinePayments", "bankDeposits", "cityTransfers",
  "openingCashes", "openingCustomerBalances", "openingStocks", "openingLiabilities",
  "intermediaryDeposits", "intermediaryExchanges",
  "investorDeposits", "investorWithdrawals",
  "superAdminExpenses", "voucherSequences",
] as const;

export interface SyncMeta {
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
  status: "idle" | "syncing" | "completed" | "failed";
  error: string | null;
  moduleCounts: Record<string, number> | null;
}

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

async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
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

async function dbPut(store: string, value: { key: string; data?: unknown } & Record<string, unknown>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(store: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear(store: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSyncMeta(): Promise<SyncMeta> {
  const existing = await dbGet<SyncMeta & { key: string }>(FULL_SYNC_META_STORE, META_KEY);
  if (existing) {
    const { key: _key, ...meta } = existing;
    return meta;
  }
  return {
    lastSyncedAt: null,
    lastAttemptedAt: null,
    status: "idle",
    error: null,
    moduleCounts: null,
  };
}

export async function isFullSyncStale(): Promise<boolean> {
  const meta = await getSyncMeta();
  if (meta.status !== "completed" || !meta.lastSyncedAt) return true;
  return Date.now() - new Date(meta.lastSyncedAt).getTime() > 12 * 60 * 60 * 1000;
}

export async function isFullSyncCompleted(): Promise<boolean> {
  const meta = await getSyncMeta();
  return meta.status === "completed";
}

export async function getSyncedModuleData(moduleKey: string): Promise<unknown | null> {
  const row = await dbGet<{ key: string; data: unknown }>(FULL_SYNC_STORE, moduleKey);
  return row?.data ?? null;
}

async function replaceFullSyncModules(data: Record<string, unknown>) {
  const written = new Set<string>();
  for (const mod of SYNC_MODULES) {
    if (data[mod] === undefined) continue;
    await dbPut(FULL_SYNC_STORE, { key: mod, data: data[mod] });
    written.add(mod);
  }
  const existingKeys = await dbGetAllKeys(FULL_SYNC_STORE);
  for (const key of existingKeys) {
    if (!written.has(key)) await dbDelete(FULL_SYNC_STORE, key);
  }
}

export async function performFullSync(
  onProgress?: (module: string, index: number, total: number) => void
): Promise<{ success: boolean; error?: string }> {
  const meta: SyncMeta = {
    lastAttemptedAt: new Date().toISOString(),
    lastSyncedAt: null,
    status: "syncing",
    error: null,
    moduleCounts: null,
  };
  await dbPut(FULL_SYNC_META_STORE, { key: META_KEY, ...meta });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const res = await fetch("/api/v1/offline/sync-all", {
      credentials: "include",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json.success) {
      meta.status = "failed";
      meta.error = json.error?.message || `Sync failed (${res.status})`;
      await dbPut(FULL_SYNC_META_STORE, { key: META_KEY, ...meta });
      return { success: false, error: meta.error || "Sync failed" };
    }

    const data = json.data as Record<string, unknown>;
    for (let i = 0; i < SYNC_MODULES.length; i++) {
      const mod = SYNC_MODULES[i];
      if (data[mod] !== undefined) onProgress?.(mod, i + 1, SYNC_MODULES.length);
    }

    await replaceFullSyncModules(data);
    await hydrateOfflineCachesFromSyncPayload(data);

    meta.status = "completed";
    meta.lastSyncedAt = new Date().toISOString();
    meta.error = null;
    meta.moduleCounts = (data.counts as Record<string, number>) || {};
    await dbPut(FULL_SYNC_META_STORE, { key: META_KEY, ...meta });

    return { success: true };
  } catch (err: unknown) {
    meta.status = "failed";
    meta.error = err instanceof Error ? err.message : "Network error";
    await dbPut(FULL_SYNC_META_STORE, { key: META_KEY, ...meta });
    return { success: false, error: meta.error || "Network error" };
  }
}

export async function clearFullSyncData(): Promise<void> {
  await dbClear(FULL_SYNC_STORE);
  await dbClear(FULL_SYNC_META_STORE);
}
