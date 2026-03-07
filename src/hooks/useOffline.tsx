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
  queue: QueuedRequest[];
  queueCount: number;
  syncQueue: () => Promise<void>;
  isSyncing: boolean;
  lastSyncResult: { synced: number; failed: number } | null;
}

const OfflineContext = createContext<OfflineContextType>({
  isOnline: true,
  isServiceWorkerReady: false,
  queue: [],
  queueCount: 0,
  syncQueue: async () => {},
  isSyncing: false,
  lastSyncResult: null,
});

const DB_NAME = "welding-offline";
const STORE_NAME = "queue";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllQueued(): Promise<QueuedRequest[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToQueue(item: QueuedRequest): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeFromQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearQueue(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isServiceWorkerReady, setIsServiceWorkerReady] = useState(false);
  const [queue, setQueue] = useState<QueuedRequest[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{ synced: number; failed: number } | null>(null);

  // Track online/offline status
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming back online
      loadQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Register service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("SW registered:", reg.scope);
          setIsServiceWorkerReady(true);
        })
        .catch((err) => {
          console.warn("SW registration failed:", err);
        });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener("message", async (event) => {
        if (event.data?.type === "QUEUE_OFFLINE_REQUEST") {
          const item = event.data.payload as QueuedRequest;
          await addToQueue(item);
          loadQueue();
        }
        if (event.data?.type === "SYNC_RESULTS") {
          const results = event.data.payload;
          let synced = 0;
          let failed = 0;
          for (const result of results) {
            if (result.success) {
              await removeFromQueue(result.id);
              synced++;
            } else {
              failed++;
            }
          }
          setLastSyncResult({ synced, failed });
          setIsSyncing(false);
          loadQueue();
        }
      });
    }
  }, []);

  // Load queue from IndexedDB
  const loadQueue = useCallback(async () => {
    try {
      const items = await getAllQueued();
      setQueue(items.sort((a, b) => a.timestamp - b.timestamp));
    } catch {
      // IndexedDB not available
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Sync queued requests
  const syncQueue = useCallback(async () => {
    if (isSyncing || !isOnline) return;

    const items = await getAllQueued();
    if (items.length === 0) return;

    setIsSyncing(true);

    // Try to sync via service worker
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SYNC_OFFLINE_QUEUE",
        queue: items,
      });
    } else {
      // Fallback: sync directly
      let synced = 0;
      let failed = 0;

      for (const item of items) {
        try {
          const response = await fetch(item.url, {
            method: item.method,
            headers: item.headers,
            body: item.method !== "GET" ? item.body : undefined,
          });
          const data = await response.json();
          if (data.success) {
            await removeFromQueue(item.id);
            synced++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      setLastSyncResult({ synced, failed });
      setIsSyncing(false);
      loadQueue();
    }
  }, [isSyncing, isOnline, loadQueue]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0 && !isSyncing) {
      const timer = setTimeout(() => syncQueue(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, queue.length, isSyncing, syncQueue]);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        isServiceWorkerReady,
        queue,
        queueCount: queue.length,
        syncQueue,
        isSyncing,
        lastSyncResult,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export const useOffline = () => useContext(OfflineContext);
