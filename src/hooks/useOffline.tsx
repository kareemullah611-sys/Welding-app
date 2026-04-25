"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

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
  // Pages call this when offline to queue a write
  enqueue: (item: EnqueueRequest) => Promise<void>;
  // Stock cache: persists godown stock locally so city admins see correct numbers offline
  cacheGodownStock: (godownId: number, stock: any[]) => Promise<void>;
  getCachedGodownStock: (godownId: number) => Promise<any[] | null>;
}

const OfflineContext = createContext<OfflineContextType>({
  isOnline: true,
  isServiceWorkerReady: false,
  queueCount: 0,
  syncQueue: async () => {},
  isSyncing: false,
  lastSyncResult: null,
  queuedItems: [],
  enqueue: async () => {},
  cacheGodownStock: async () => {},
  getCachedGodownStock: async () => null,
});

// ── IndexedDB helpers ──────────────────────────────────────────────────────────
const DB_NAME = "mrf-offline";
const DB_VERSION = 2;
const QUEUE_STORE = "queue";
const STOCK_STORE = "stock_cache";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(QUEUE_STORE))
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STOCK_STORE))
        db.createObjectStore(STOCK_STORE, { keyPath: "godownId" });
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

// ── Provider ───────────────────────────────────────────────────────────────────
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]           = useState(true);
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);
  const [queueCount, setQueueCount]       = useState(0);
  const [queuedItems, setQueuedItems]     = useState<QueuedRequest[]>([]);
  const [isSyncing, setIsSyncing]         = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);

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

  // ── enqueue — called by pages when offline ──
  const enqueue = useCallback(async (item: EnqueueRequest) => {
    const full: QueuedRequest = {
      ...item,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      syncStatus: "pending",
      syncAttempts: 0,
      lastError: null,
    };
    await dbPut(QUEUE_STORE, full);
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

  // ── Sync queue (FIFO) when back online ──
  const syncQueue = useCallback(async () => {
    if (isSyncing || !isOnline) return;
    const items = await dbGetAll<QueuedRequest>(QUEUE_STORE);
    if (items.length === 0) return;

    setIsSyncing(true);
    let synced = 0, failed = 0;

    for (const item of [...items].sort((a, b) => a.timestamp - b.timestamp)) {
      try {
        await dbPut(QUEUE_STORE, { ...item, syncStatus: "syncing", lastError: null });
        const res  = await fetch(item.url, {
          method:  item.method,
          headers: item.headers,
          body:    item.method !== "GET" ? item.body : undefined,
        });
        const isJson = res.headers.get("content-type")?.includes("application/json");
        const data = isJson ? await res.json() : null;
        if (res.ok && data?.success) {
          await dbDelete(QUEUE_STORE, item.id);
          synced++;
          continue;
        }

        const nextStatus: QueueSyncStatus = res.status === 409 ? "conflict" : "failed";
        await dbPut(QUEUE_STORE, {
          ...item,
          syncStatus: nextStatus,
          syncAttempts: item.syncAttempts + 1,
          lastError: data?.error || `Sync failed (${res.status})`,
        });
        failed++;
      } catch {
        await dbPut(QUEUE_STORE, {
          ...item,
          syncStatus: "failed",
          syncAttempts: item.syncAttempts + 1,
          lastError: "Network error",
        });
        failed++;
      } // still offline / failed — leave in queue
    }

    setLastSyncResult({ synced, failed });
    setIsSyncing(false);
    await refreshQueueState();
  }, [isSyncing, isOnline, refreshQueueState]);

  // Auto-sync 2 s after coming back online
  useEffect(() => {
    if (isOnline && queueCount > 0 && !isSyncing) {
      const t = setTimeout(() => syncQueue(), 2000);
      return () => clearTimeout(t);
    }
  }, [isOnline, queueCount, isSyncing, syncQueue]);

  return (
    <OfflineContext.Provider value={{
      isOnline, isServiceWorkerReady, queueCount, syncQueue, isSyncing, lastSyncResult, queuedItems,
      enqueue, cacheGodownStock, getCachedGodownStock,
    }}>
      {children}
    </OfflineContext.Provider>
  );
}

export const useOffline = () => useContext(OfflineContext);
