"use client";

import { useState, useCallback } from "react";
import {
  OFFLINE_API_CACHE_STORE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_QUEUE_STORE,
  OFFLINE_STOCK_STORE,
  buildApiCacheKey,
  shouldAutoQueueOfflineWrite,
} from "@/lib/offline-cache";

interface FetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface ApiCacheRecord<T> {
  key: string;
  data: T;
  pagination?: unknown;
  cachedAt: number;
}

interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
  pathname: string;
  syncStatus: "pending";
  syncAttempts: number;
  lastError?: string | null;
  auditMeta?: {
    action?: string;
    entityType?: string;
    entityLabel?: string;
    entityDetail?: string;
  };
}

function buildFullUrl(url: string, params?: Record<string, string | number | undefined>): string {
  let fullUrl = url;
  if (params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.append(key, String(value));
      }
    });
    const qs = query.toString();
    if (qs) fullUrl += `?${qs}`;
  }
  return fullUrl;
}

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("offline db unavailable"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STOCK_STORE)) {
        db.createObjectStore(OFFLINE_STOCK_STORE, { keyPath: "godownId" });
      }
      if (!db.objectStoreNames.contains(OFFLINE_API_CACHE_STORE)) {
        db.createObjectStore(OFFLINE_API_CACHE_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheApiResponse<T>(
  url: string,
  params: Record<string, string | number | undefined> | undefined,
  data: T,
  pagination?: unknown
) {
  if (typeof window === "undefined") return;
  const db = await openOfflineDb();
  const key = buildApiCacheKey(url, params);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_API_CACHE_STORE, "readwrite");
    tx.objectStore(OFFLINE_API_CACHE_STORE).put({
      key,
      data,
      pagination,
      cachedAt: Date.now(),
    } satisfies ApiCacheRecord<T>);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getCachedApiResponse<T>(
  url: string,
  params?: Record<string, string | number | undefined>
): Promise<ApiCacheRecord<T> | null> {
  if (typeof window === "undefined") return null;
  const db = await openOfflineDb();
  const key = buildApiCacheKey(url, params);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_API_CACHE_STORE, "readonly");
    const req = tx.objectStore(OFFLINE_API_CACHE_STORE).get(key);
    req.onsuccess = () => resolve((req.result as ApiCacheRecord<T>) || null);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueOfflineWrite(
  url: string,
  method: string,
  body: unknown
): Promise<string> {
  const db = await openOfflineDb();
  const id = crypto.randomUUID();
  const queueItem: QueuedRequest = {
    id,
    url,
    method: String(method || "POST").toUpperCase(),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    timestamp: Date.now(),
    pathname: typeof window !== "undefined" ? window.location.pathname : "/",
    syncStatus: "pending",
    syncAttempts: 0,
    lastError: null,
    auditMeta: {
      action: "create",
      entityType: "offline_entry",
      entityLabel: "Offline Entry",
      entityDetail: `${String(method || "POST").toUpperCase()} ${url}`,
    },
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    tx.objectStore(OFFLINE_QUEUE_STORE).put(queueItem);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("mrf-offline-queue-updated"));
  }
  return id;
}

export function useApi<T = unknown>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const request = useCallback(async (url: string, options: FetchOptions = {}) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const method = options.method || "GET";
      const fullUrl = buildFullUrl(url, options.params);

      const fetchOptions: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };

      if (options.body && method !== "GET") {
        fetchOptions.body = JSON.stringify(options.body);
      }

      if (method === "GET" && typeof window !== "undefined" && !navigator.onLine) {
        const cached = await getCachedApiResponse<T>(url, options.params);
        if (cached) {
          setState({ data: cached.data, loading: false, error: null });
          return { success: true, data: cached.data, pagination: cached.pagination, cached: true };
        }
      }

      if (
        typeof window !== "undefined" &&
        !navigator.onLine &&
        shouldAutoQueueOfflineWrite(url, method)
      ) {
        const queueId = await enqueueOfflineWrite(url, method, options.body);
        return {
          success: true,
          data: { queued: true, queueId } as T,
          queued: true,
        };
      }

      const res = await fetch(fullUrl, fetchOptions);
      const data = await res.json();

      if (data.success) {
        if (method === "GET") {
          await cacheApiResponse(url, options.params, data.data as T, data.pagination);
        }
        setState({ data: data.data as T, loading: false, error: null });
        return { success: true, data: data.data as T, pagination: data.pagination };
      } else {
        const error = data.error?.message || "Request failed";
        if (method === "GET") {
          const cached = await getCachedApiResponse<T>(url, options.params);
          if (cached) {
            setState({ data: cached.data, loading: false, error: null });
            return { success: true, data: cached.data, pagination: cached.pagination, cached: true };
          }
        }
        setState({ data: null, loading: false, error });
        return { success: false, error };
      }
    } catch (err) {
      const method = options.method || "GET";
      if (
        shouldAutoQueueOfflineWrite(url, method) &&
        typeof window !== "undefined"
      ) {
        const queueId = await enqueueOfflineWrite(url, method, options.body);
        return {
          success: true,
          data: { queued: true, queueId } as T,
          queued: true,
        };
      }
      if (method === "GET") {
        const cached = await getCachedApiResponse<T>(url, options.params);
        if (cached) {
          setState({ data: cached.data, loading: false, error: null });
          return { success: true, data: cached.data, pagination: cached.pagination, cached: true };
        }
      }
      const error = "Network error";
      setState({ data: null, loading: false, error });
      return { success: false, error };
    }
  }, []);

  return { ...state, request };
}

// Simplified fetch helper for one-off calls
export async function apiCall<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<{ success: boolean; data?: T; error?: string; pagination?: unknown; cached?: boolean; queued?: boolean }> {
  try {
    const method = options.method || "GET";
    const fullUrl = buildFullUrl(url, options.params);

    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    if (options.body && method !== "GET") {
      fetchOptions.body = JSON.stringify(options.body);
    }

    if (
      typeof window !== "undefined" &&
      !navigator.onLine &&
      shouldAutoQueueOfflineWrite(url, method)
    ) {
      const queueId = await enqueueOfflineWrite(url, method, options.body);
      return { success: true, data: { queued: true, queueId } as T, queued: true };
    }

    if (method === "GET" && typeof window !== "undefined" && !navigator.onLine) {
      const cached = await getCachedApiResponse<T>(url, options.params);
      if (cached) {
        return { success: true, data: cached.data, pagination: cached.pagination, cached: true };
      }
    }

    const res = await fetch(fullUrl, fetchOptions);
    const data = await res.json();

    if (data.success) {
      if (method === "GET") {
        await cacheApiResponse(url, options.params, data.data as T, data.pagination);
      }
      return { success: true, data: data.data as T, pagination: data.pagination };
    }
    if (method === "GET") {
      const cached = await getCachedApiResponse<T>(url, options.params);
      if (cached) {
        return { success: true, data: cached.data, pagination: cached.pagination, cached: true };
      }
    }
    return { success: false, error: data.error?.message || "Request failed" };
  } catch {
    const method = options.method || "GET";
    if (
      typeof window !== "undefined" &&
      shouldAutoQueueOfflineWrite(url, method)
    ) {
      const queueId = await enqueueOfflineWrite(url, method, options.body);
      return { success: true, data: { queued: true, queueId } as T, queued: true };
    }
    if (method === "GET") {
      const cached = await getCachedApiResponse<T>(url, options.params);
      if (cached) {
        return { success: true, data: cached.data, pagination: cached.pagination, cached: true };
      }
    }
    return { success: false, error: "Network error" };
  }
}
