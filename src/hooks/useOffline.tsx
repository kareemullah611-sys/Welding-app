"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
  pathname: string;
}

interface OfflineContextType {
  isOnline: boolean;
  isServiceWorkerReady: boolean;
  queueCount: number;
  syncQueue: () => Promise<void>;
  isSyncing: boolean;
  lastSyncResult: { synced: number; failed: number } | null;
  // Pages call this when offline to queue a write
  enqueue: (item: Omit<QueuedRequest, "id" | "timestamp">) => Promise<void>;
  // Stock cache: persists godown stock locally so city admins see correct numbers offline
  cacheGodownStock: (godownId: number, stock: any[]) => Promise<void>;
  getCachedGodownStock: (godownId: number) => Promise<any[] | null>;
  // Reference data cache: cities, products, lots, godowns, customers
  syncReferenceData: () => Promise<void>;
  getLocalData: (key: string) => Promise<any[] | null>;
  searchLocalCustomers: (query: string) => Promise<any[]>;
}

const OfflineContext = createContext<OfflineContextType>({
  isOnline: true,
  isServiceWorkerReady: false,
  queueCount: 0,
  syncQueue: async () => {},
  isSyncing: false,
  lastSyncResult: null,
  enqueue: async () => {},
  cacheGodownStock: async () => {},
  getCachedGodownStock: async () => null,
  syncReferenceData: async () => {},
  getLocalData: async () => null,
  searchLocalCustomers: async () => [],
});

// ── IndexedDB helpers ──────────────────────────────────────────────────────────
const DB_NAME = "mrf-offline";
const DB_VERSION = 3;
const QUEUE_STORE = "queue";
const STOCK_STORE = "stock_cache";
const CACHE_STORE = "local_cache";
const STALE_MS = 5 * 60 * 1000; // 5 minutes

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(QUEUE_STORE))
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STOCK_STORE))
        db.createObjectStore(STOCK_STORE, { keyPath: "godownId" });
      if (!db.objectStoreNames.contains(CACHE_STORE))
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
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

// Cache helpers (use CACHE_STORE)
async function dbGetCache(key: string): Promise<any[] | null> {
  try {
    const entry = await dbGet<{ key: string; data: any[]; cachedAt: number }>(CACHE_STORE, key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > STALE_MS) return null;
    return entry.data;
  } catch { return null; }
}

async function dbSetCache(key: string, data: any[]): Promise<void> {
  await dbPut(CACHE_STORE, { key, data, cachedAt: Date.now() });
}

// ── Provider ───────────────────────────────────────────────────────────────────
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]           = useState(true);
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);
  const [queueCount, setQueueCount]       = useState(0);
  const [isSyncing, setIsSyncing]         = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const prevOnlineRef = useRef(false);

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
  const refreshCount = useCallback(async () => {
    try {
      const items = await dbGetAll<QueuedRequest>(QUEUE_STORE);
      setQueueCount(items.length);
    } catch { setQueueCount(0); }
  }, []);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  // ── enqueue — called by pages when offline ──
  const enqueue = useCallback(async (item: Omit<QueuedRequest, "id" | "timestamp">) => {
    const full: QueuedRequest = { ...item, id: crypto.randomUUID(), timestamp: Date.now() };
    await dbPut(QUEUE_STORE, full);
    await refreshCount();
  }, [refreshCount]);

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

  // ── Reference data sync ──
  const syncReferenceData = useCallback(async () => {
    if (!navigator.onLine) return;

    // Check if any key is missing or stale
    const keys = ["cities", "products", "lots_ongoing", "godowns", "customers"];
    const staleness = await Promise.all(
      keys.map(async (key) => {
        const entry = await dbGet<{ key: string; cachedAt: number }>(CACHE_STORE, key).catch(() => undefined);
        return !entry || (Date.now() - entry.cachedAt > STALE_MS);
      })
    );
    if (!staleness.some(Boolean)) return; // all fresh, skip

    const [citiesRes, productsRes, lotsRes, godownsRes, customersRes] = await Promise.allSettled([
      fetch("/api/v1/cities").then((r) => r.json()),
      fetch("/api/v1/products?limit=200&is_active=true").then((r) => r.json()),
      fetch("/api/v1/lots?limit=100&status=ongoing").then((r) => r.json()),
      fetch("/api/v1/godowns?limit=200&is_active=true&show_all=true").then((r) => r.json()),
      fetch("/api/v1/customers?limit=500&is_active=true").then((r) => r.json()),
    ]);

    const results = [citiesRes, productsRes, lotsRes, godownsRes, customersRes];
    const cacheKeys = ["cities", "products", "lots_ongoing", "godowns", "customers"];

    await Promise.all(
      results.map(async (result, i) => {
        if (result.status === "fulfilled" && result.value?.success) {
          await dbSetCache(cacheKeys[i], result.value.data).catch(() => {});
        }
      })
    );
  }, []);

  // ── Read from local cache ──
  const getLocalData = useCallback(async (key: string): Promise<any[] | null> => {
    return dbGetCache(key);
  }, []);

  // ── Search customers locally ──
  const searchLocalCustomers = useCallback(async (query: string): Promise<any[]> => {
    try {
      const customers = await dbGetCache("customers");
      if (!customers) return [];
      const q = query.toLowerCase();
      return customers
        .filter((c: any) =>
          c.name?.toLowerCase().includes(q) || c.phone?.includes(query)
        )
        .slice(0, 10);
    } catch { return []; }
  }, []);

  // ── Auto-sync reference data: on mount and when reconnecting ──
  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      syncReferenceData();
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline, syncReferenceData]);

  // Initial sync on first mount (isOnline starts as true)
  useEffect(() => {
    if (navigator.onLine) syncReferenceData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const res  = await fetch(item.url, {
          method:  item.method,
          headers: item.headers,
          body:    item.method !== "GET" ? item.body : undefined,
        });
        const data = await res.json();
        if (data.success) { await dbDelete(QUEUE_STORE, item.id); synced++; }
        else failed++;
      } catch { failed++; } // still offline — leave in queue
    }

    setLastSyncResult({ synced, failed });
    setIsSyncing(false);
    await refreshCount();
  }, [isSyncing, isOnline, refreshCount]);

  // Auto-sync 2 s after coming back online
  useEffect(() => {
    if (isOnline && queueCount > 0 && !isSyncing) {
      const t = setTimeout(() => syncQueue(), 2000);
      return () => clearTimeout(t);
    }
  }, [isOnline, queueCount, isSyncing, syncQueue]);

  return (
    <OfflineContext.Provider value={{
      isOnline, isServiceWorkerReady, queueCount, syncQueue, isSyncing, lastSyncResult,
      enqueue, cacheGodownStock, getCachedGodownStock,
      syncReferenceData, getLocalData, searchLocalCustomers,
    }}>
      {children}
    </OfflineContext.Provider>
  );
}

export const useOffline = () => useContext(OfflineContext);
