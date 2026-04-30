"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  OFFLINE_API_CACHE_STORE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_LOCAL_READ_MODEL_STORE,
  OFFLINE_QUEUE_STORE,
  OFFLINE_STOCK_STORE,
  buildApiCacheKey,
} from "@/lib/offline-cache";
import {
  canApplyCreateToReadModel,
  getReadModelKey,
  removePendingReadModelRowsByQueueId,
} from "@/lib/offline-local-read-model";
import {
  OFFLINE_ID_MAP_STORE,
  createIdMapRecord,
  extractServerId,
  reconcileIdsInReadModel,
} from "@/lib/offline-id-reconciliation";
import { isAlreadySyncedResponse } from "@/lib/offline-sync-classifier";

type QueueSyncStatus = "pending" | "syncing" | "failed" | "conflict";

interface OfflineAuditMeta {
  action?: string;
  entityType?: string;
  entityLabel?: string;
  entityDetail?: string;
}

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
  pathname: string;
  syncStatus: QueueSyncStatus;
  syncAttempts: number;
  nextRetryAt?: number | null;
  lastError?: string | null;
  auditMeta?: OfflineAuditMeta;
}

interface EnqueueRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  pathname: string;
  auditMeta?: OfflineAuditMeta;
}

interface OfflineContextType {
  isOnline: boolean;
  isServiceWorkerReady: boolean;
  queueCount: number;
  syncQueue: () => Promise<void>;
  isSyncing: boolean;
  lastSyncResult: { synced: number; failed: number } | null;
  queuedItems: QueuedRequest[];
  clearOfflineData: () => Promise<void>;
  // Pages call this when offline to queue a write
  enqueue: (item: EnqueueRequest) => Promise<string>;
  updateQueuedItem: (id: string, updates: Partial<Pick<QueuedRequest, "body" | "auditMeta" | "pathname">>) => Promise<boolean>;
  retryQueuedItem: (id: string) => Promise<boolean>;
  discardQueuedItem: (id: string) => Promise<boolean>;
  // Stock cache: persists godown stock locally so city admins see correct numbers offline
  cacheGodownStock: (godownId: number, stock: any[]) => Promise<void>;
  getCachedGodownStock: (godownId: number) => Promise<any[] | null>;
  cacheApiResponse: (url: string, params: Record<string, string | number | undefined> | undefined, data: unknown, pagination?: unknown) => Promise<void>;
  getCachedApiResponse: (url: string, params?: Record<string, string | number | undefined>) => Promise<{ data: unknown; pagination?: unknown; cachedAt: number } | null>;
  exportOfflineBundle: () => Promise<string>;
  importOfflineBundle: (bundleJson: string) => Promise<void>;
}

const OfflineContext = createContext<OfflineContextType>({
  isOnline: true,
  isServiceWorkerReady: false,
  queueCount: 0,
  syncQueue: async () => {},
  isSyncing: false,
  lastSyncResult: null,
  queuedItems: [],
  clearOfflineData: async () => {},
  enqueue: async () => "",
  updateQueuedItem: async () => false,
  retryQueuedItem: async () => false,
  discardQueuedItem: async () => false,
  cacheGodownStock: async () => {},
  getCachedGodownStock: async () => null,
  cacheApiResponse: async () => {},
  getCachedApiResponse: async () => null,
  exportOfflineBundle: async () => "{}",
  importOfflineBundle: async () => {},
});

// ── IndexedDB helpers ──────────────────────────────────────────────────────────
const DB_NAME = OFFLINE_DB_NAME;
const DB_VERSION = OFFLINE_DB_VERSION;
const QUEUE_STORE = OFFLINE_QUEUE_STORE;
const STOCK_STORE = OFFLINE_STOCK_STORE;
const API_CACHE_STORE = OFFLINE_API_CACHE_STORE;
const LOCAL_READ_MODEL_STORE = OFFLINE_LOCAL_READ_MODEL_STORE;
const ID_MAP_STORE = OFFLINE_ID_MAP_STORE;
const DEVICE_ID_KEY = "mrf-offline-device-id";

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing && existing.trim()) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(QUEUE_STORE))
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STOCK_STORE))
        db.createObjectStore(STOCK_STORE, { keyPath: "godownId" });
      if (!db.objectStoreNames.contains(API_CACHE_STORE))
        db.createObjectStore(API_CACHE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(LOCAL_READ_MODEL_STORE))
        db.createObjectStore(LOCAL_READ_MODEL_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(ID_MAP_STORE))
        db.createObjectStore(ID_MAP_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result as T[]);
    r.onerror = () => reject(r.error);
  });
}

async function dbPut(store: string, value: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(store: string, key: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet<T>(store: string, key: any): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

async function removePendingReadModelRowForQueueItem(item: QueuedRequest) {
  if (!canApplyCreateToReadModel(item.url, item.method)) return;
  const key = getReadModelKey(item.url, undefined);
  const row = await dbGet<{ key: string; data: unknown; pagination?: unknown; updatedAt: number }>(LOCAL_READ_MODEL_STORE, key);
  if (!row) return;
  const data = removePendingReadModelRowsByQueueId(row.data, item.id);
  await dbPut(LOCAL_READ_MODEL_STORE, { ...row, data, updatedAt: Date.now() });
}

async function reconcileSyncedIds(item: QueuedRequest, responsePayload: unknown) {
  if (!canApplyCreateToReadModel(item.url, item.method)) return;
  const serverId = extractServerId(responsePayload);
  if (!serverId) return;

  const mapRecord = createIdMapRecord(item.url, item.id, serverId);
  await dbPut(ID_MAP_STORE, mapRecord);

  const pendingId = mapRecord.pendingId;
  const rows = await dbGetAll<{ key: string; data: unknown; pagination?: unknown; updatedAt?: number }>(LOCAL_READ_MODEL_STORE);
  for (const row of rows) {
    const nextData = reconcileIdsInReadModel(row.data, pendingId, serverId);
    await dbPut(LOCAL_READ_MODEL_STORE, { ...row, data: nextData, updatedAt: Date.now() });
  }
}

// ── Provider ───────────────────────────────────────────────────────────────────
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]           = useState(true);
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);
  const [queueCount, setQueueCount]       = useState(0);
  const [queuedItems, setQueuedItems]     = useState<QueuedRequest[]>([]);
  const [isSyncing, setIsSyncing]         = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const syncLockRef = useRef(false);

  // ── Online / Offline ──
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const up   = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online",  up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ── Service worker ──
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then(() => setIsServiceWorkerReady(true))
        .catch(() => {});
    }
  }, []);

  // ── Queue count ──
  const refreshQueueState = useCallback(async () => {
    try {
      const items = await dbGetAll<QueuedRequest>(QUEUE_STORE);
      setQueueCount(items.length);
      setQueuedItems([...items].sort((a, b) => b.timestamp - a.timestamp));
    } catch {
      setQueueCount(0);
      setQueuedItems([]);
    }
  }, []);

  useEffect(() => { refreshQueueState(); }, [refreshQueueState]);
  useEffect(() => {
    const onQueueUpdated = () => { refreshQueueState(); };
    window.addEventListener("mrf-offline-queue-updated", onQueueUpdated);
    return () => window.removeEventListener("mrf-offline-queue-updated", onQueueUpdated);
  }, [refreshQueueState]);

  // ── enqueue — called by pages when offline ──
  const enqueue = useCallback(async (item: EnqueueRequest) => {
    const full: QueuedRequest = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      syncStatus: "pending",
      syncAttempts: 0,
      nextRetryAt: null,
      lastError: null,
    };
    await dbPut(QUEUE_STORE, full);
    await refreshQueueState();
    return full.id;
  }, [refreshQueueState]);

  const updateQueuedItem = useCallback(async (id: string, updates: Partial<Pick<QueuedRequest, "body" | "auditMeta" | "pathname">>) => {
    const existing = await dbGet<QueuedRequest>(QUEUE_STORE, id);
    if (!existing) return false;
    await dbPut(QUEUE_STORE, { ...existing, ...updates });
    await refreshQueueState();
    return true;
  }, [refreshQueueState]);

  const retryQueuedItem = useCallback(async (id: string) => {
    const existing = await dbGet<QueuedRequest>(QUEUE_STORE, id);
    if (!existing) return false;
    await dbPut(QUEUE_STORE, { ...existing, syncStatus: "pending", lastError: null, nextRetryAt: null });
    await refreshQueueState();
    return true;
  }, [refreshQueueState]);

  const discardQueuedItem = useCallback(async (id: string) => {
    const existing = await dbGet<QueuedRequest>(QUEUE_STORE, id);
    if (!existing) return false;
    await dbDelete(QUEUE_STORE, id);
    await removePendingReadModelRowForQueueItem(existing);
    await refreshQueueState();
    return true;
  }, [refreshQueueState]);

  const clearOfflineData = useCallback(async () => {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([QUEUE_STORE, STOCK_STORE, API_CACHE_STORE, LOCAL_READ_MODEL_STORE, ID_MAP_STORE], "readwrite");
      tx.objectStore(QUEUE_STORE).clear();
      tx.objectStore(STOCK_STORE).clear();
      tx.objectStore(API_CACHE_STORE).clear();
      tx.objectStore(LOCAL_READ_MODEL_STORE).clear();
      tx.objectStore(ID_MAP_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (typeof window !== "undefined") {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("mrf-") || key.startsWith("offline_")) keysToRemove.push(key);
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      window.dispatchEvent(new Event("mrf-offline-queue-updated"));
    }
    await refreshQueueState();
  }, [refreshQueueState]);

  const exportOfflineBundle = useCallback(async () => {
    const [queue, stock, apiCache, localReadModel, idMap] = await Promise.all([
      dbGetAll<any>(QUEUE_STORE),
      dbGetAll<any>(STOCK_STORE),
      dbGetAll<any>(API_CACHE_STORE),
      dbGetAll<any>(LOCAL_READ_MODEL_STORE),
      dbGetAll<any>(ID_MAP_STORE),
    ]);
    const localStorageData: Record<string, string> = {};
    if (typeof window !== "undefined") {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("mrf-") || key.startsWith("offline_")) {
          const value = window.localStorage.getItem(key);
          if (value !== null) localStorageData[key] = value;
        }
      }
    }
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      stores: { queue, stock, apiCache, localReadModel, idMap },
      localStorage: localStorageData,
    });
  }, []);

  const importOfflineBundle = useCallback(async (bundleJson: string) => {
    const parsed = JSON.parse(bundleJson || "{}");
    const stores = parsed?.stores || {};
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([QUEUE_STORE, STOCK_STORE, API_CACHE_STORE, LOCAL_READ_MODEL_STORE, ID_MAP_STORE], "readwrite");
      tx.objectStore(QUEUE_STORE).clear();
      tx.objectStore(STOCK_STORE).clear();
      tx.objectStore(API_CACHE_STORE).clear();
      tx.objectStore(LOCAL_READ_MODEL_STORE).clear();
      tx.objectStore(ID_MAP_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    for (const row of Array.isArray(stores.queue) ? stores.queue : []) await dbPut(QUEUE_STORE, row);
    for (const row of Array.isArray(stores.stock) ? stores.stock : []) await dbPut(STOCK_STORE, row);
    for (const row of Array.isArray(stores.apiCache) ? stores.apiCache : []) await dbPut(API_CACHE_STORE, row);
    for (const row of Array.isArray(stores.localReadModel) ? stores.localReadModel : []) await dbPut(LOCAL_READ_MODEL_STORE, row);
    for (const row of Array.isArray(stores.idMap) ? stores.idMap : []) await dbPut(ID_MAP_STORE, row);

    if (typeof window !== "undefined") {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("mrf-") || key.startsWith("offline_")) keysToRemove.push(key);
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      const ls = parsed?.localStorage || {};
      for (const [key, value] of Object.entries(ls)) {
        if (typeof value === "string") window.localStorage.setItem(key, value);
      }
      window.dispatchEvent(new Event("mrf-offline-queue-updated"));
    }
    await refreshQueueState();
  }, [refreshQueueState]);

  // ── Stock cache ──
  const cacheGodownStock = useCallback(async (godownId: number, stock: any[]) => {
    await dbPut(STOCK_STORE, { godownId, stock, cachedAt: Date.now() });
  }, []);

  const getCachedGodownStock = useCallback(async (godownId: number): Promise<any[] | null> => {
    try {
      const row = await dbGet<{ godownId: number; stock: any[] }>(STOCK_STORE, godownId);
      return row?.stock ?? null;
    } catch { return null; }
  }, []);

  // ── API response cache (generic all-module GET cache) ──
  const cacheApiResponse = useCallback(async (
    url: string,
    params: Record<string, string | number | undefined> | undefined,
    data: unknown,
    pagination?: unknown
  ) => {
    const key = buildApiCacheKey(url, params);
    await dbPut(API_CACHE_STORE, { key, data, pagination, cachedAt: Date.now() });
  }, []);

  const getCachedApiResponse = useCallback(async (
    url: string,
    params?: Record<string, string | number | undefined>
  ): Promise<{ data: unknown; pagination?: unknown; cachedAt: number } | null> => {
    try {
      const key = buildApiCacheKey(url, params);
      const row = await dbGet<{ key: string; data: unknown; pagination?: unknown; cachedAt: number }>(API_CACHE_STORE, key);
      if (!row) return null;
      return { data: row.data, pagination: row.pagination, cachedAt: row.cachedAt };
    } catch {
      return null;
    }
  }, []);

  // ── Sync queue (FIFO) when back online ──
  const syncQueue = useCallback(async () => {
    if (syncLockRef.current || !isOnline) return;
    syncLockRef.current = true;
    setIsSyncing(true);
    try {
      const items = await dbGetAll<QueuedRequest>(QUEUE_STORE);
      if (items.length === 0) return;

      let synced = 0, failed = 0;
      const now = Date.now();

      for (const item of [...items].sort((a, b) => a.timestamp - b.timestamp)) {
        if ((item.syncStatus === "failed" || item.syncStatus === "conflict") && item.nextRetryAt && item.nextRetryAt > now) {
          continue;
        }
        try {
          await dbPut(QUEUE_STORE, { ...item, syncStatus: "syncing", lastError: null, nextRetryAt: null });
          const deviceId = getOrCreateDeviceId();
          const res  = await fetch(item.url, {
            method:  item.method,
            headers: {
              ...item.headers,
              "x-sync-request-id": item.id,
              "x-sync-device-id": deviceId,
            },
            body:    item.method !== "GET" ? item.body : undefined,
          });
          const isJson = res.headers.get("content-type")?.includes("application/json");
          const data = isJson ? await res.json() : null;
          if (res.ok && data?.success) {
            await dbDelete(QUEUE_STORE, item.id);
            await reconcileSyncedIds(item, data?.data ?? data);
            await removePendingReadModelRowForQueueItem(item);
            synced++;
            continue;
          }
          if (isAlreadySyncedResponse(res.status, data)) {
            await dbDelete(QUEUE_STORE, item.id);
            await reconcileSyncedIds(item, data?.data ?? data);
            await removePendingReadModelRowForQueueItem(item);
            synced++;
            continue;
          }

          const nextStatus: QueueSyncStatus = res.status === 409 ? "conflict" : "failed";
          const nextAttempts = item.syncAttempts + 1;
          const retryDelayMs = Math.min(5 * 60 * 1000, Math.pow(2, Math.min(nextAttempts, 8)) * 5000);
          await dbPut(QUEUE_STORE, {
            ...item,
            syncStatus: nextStatus,
            syncAttempts: nextAttempts,
            nextRetryAt: Date.now() + retryDelayMs,
            lastError: data?.error || `Sync failed (${res.status})`,
          });
          failed++;
        } catch {
          const nextAttempts = item.syncAttempts + 1;
          const retryDelayMs = Math.min(5 * 60 * 1000, Math.pow(2, Math.min(nextAttempts, 8)) * 5000);
          await dbPut(QUEUE_STORE, {
            ...item,
            syncStatus: "failed",
            syncAttempts: nextAttempts,
            nextRetryAt: Date.now() + retryDelayMs,
            lastError: "Network error",
          });
          failed++;
        } // still offline / failed — leave in queue
      }

      setLastSyncResult({ synced, failed });
      await refreshQueueState();
    } finally {
      syncLockRef.current = false;
      setIsSyncing(false);
    }
  }, [isOnline, refreshQueueState]);

  // Auto-sync 2 s after coming back online
  useEffect(() => {
    if (isOnline && queueCount > 0 && !isSyncing) {
      const t = setTimeout(() => syncQueue(), 2000);
      return () => clearTimeout(t);
    }
  }, [isOnline, queueCount, isSyncing, syncQueue]);

  // Periodic retry loop while online so backoff-expired items reattempt automatically.
  useEffect(() => {
    if (!isOnline || queueCount === 0) return;
    const t = setInterval(() => {
      void syncQueue();
    }, 10000);
    return () => clearInterval(t);
  }, [isOnline, queueCount, syncQueue]);

  return (
    <OfflineContext.Provider value={{
      isOnline, isServiceWorkerReady, queueCount, syncQueue, isSyncing, lastSyncResult, queuedItems,
      enqueue, updateQueuedItem, retryQueuedItem, discardQueuedItem, clearOfflineData, cacheGodownStock, getCachedGodownStock, cacheApiResponse, getCachedApiResponse,
      exportOfflineBundle, importOfflineBundle,
    }}>
      {children}
    </OfflineContext.Provider>
  );
}

export const useOffline = () => useContext(OfflineContext);
