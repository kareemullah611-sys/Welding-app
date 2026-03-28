// Service Worker for MRF Hardware Management System
// Provides offline caching and background sync

const CACHE_NAME = "mrf-hardware-v1";
const API_CACHE_NAME = "mrf-hardware-api-v1";
const OFFLINE_QUEUE_KEY = "offline-queue";

// Static assets to precache
const STATIC_ASSETS = [
  "/login",
  "/dashboard",
];

// API routes that are safe to cache (GET only)
const CACHEABLE_API_ROUTES = [
  "/api/v1/products",
  "/api/v1/cities",
  "/api/v1/customers",
  "/api/v1/godowns",
  "/api/v1/lots",
  "/api/v1/suppliers",
  "/api/v1/agents",
  "/api/v1/inventory",
  "/api/v1/dashboard",
  "/api/v1/cash-position",
];

// Install event — precache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("SW: precache failed for some assets:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event — clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch event — network-first for API, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests
  if (url.pathname.startsWith("/api/")) {
    // For GET requests to cacheable routes — network first, fallback to cache
    if (event.request.method === "GET" && CACHEABLE_API_ROUTES.some((route) => url.pathname.startsWith(route))) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(API_CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            return caches.match(event.request).then((cached) => {
              if (cached) return cached;
              return new Response(
                JSON.stringify({
                  success: false,
                  error: { code: "OFFLINE", message: "You are offline. This data is not available in cache." },
                  _offline: true,
                }),
                { headers: { "Content-Type": "application/json" } }
              );
            });
          })
      );
      return;
    }

    // For mutating requests (POST, PUT, DELETE) — try network, queue if offline
    if (event.request.method !== "GET") {
      event.respondWith(
        fetch(event.request.clone()).catch(async () => {
          // Queue the request for later sync
          const body = await event.request.clone().text();
          const queueItem = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            url: event.request.url,
            method: event.request.method,
            headers: Object.fromEntries(event.request.headers.entries()),
            body,
            timestamp: Date.now(),
            pathname: url.pathname,
          };

          // Store in IndexedDB via message to client
          const clients = await self.clients.matchAll();
          for (const client of clients) {
            client.postMessage({
              type: "QUEUE_OFFLINE_REQUEST",
              payload: queueItem,
            });
          }

          return new Response(
            JSON.stringify({
              success: true,
              data: { _queued: true, _queueId: queueItem.id },
              message: "Request queued for sync when online",
              _offline: true,
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        })
      );
      return;
    }
  }

  // Next.js pages — network first, fallback to cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || caches.match("/dashboard");
        });
      })
    );
    return;
  }

  // Static assets (JS, CSS, images) — stale while revalidate
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/favicon")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
});

// Listen for sync events
self.addEventListener("message", (event) => {
  if (event.data?.type === "SYNC_OFFLINE_QUEUE") {
    // Trigger sync from the client
    syncOfflineQueue(event);
  }
});

async function syncOfflineQueue(event) {
  const queue = event.data?.queue || [];
  const results = [];

  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.method !== "GET" ? item.body : undefined,
      });
      const data = await response.json();
      results.push({ id: item.id, success: data.success, data });
    } catch (error) {
      results.push({ id: item.id, success: false, error: "Network error" });
    }
  }

  // Notify all clients
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({
      type: "SYNC_RESULTS",
      payload: results,
    });
  }
}
