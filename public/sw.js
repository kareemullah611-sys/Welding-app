// Service Worker for MRF Hardware Management System
// Provides offline caching and background sync

const CACHE_NAME = "mrf-hardware-v3";
const API_CACHE_NAME = "mrf-hardware-api-v1";

// Static assets to precache
const STATIC_ASSETS = [
  "/login",
  "/dashboard",
  "/sales",
  "/payments",
  "/expenses",
  "/personal-withdrawals",
  "/haji-transfers",
  "/customers",
  "/inventory",
  "/city-transfers",
  "/bank-deposits",
  "/settings",
  "/settings/bank-accounts",
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

    // For mutating requests (POST, PUT, DELETE) — network only.
    // Offline queueing is handled centrally in the app layer (IndexedDB + useOffline).
    if (event.request.method !== "GET") {
      event.respondWith(
        fetch(event.request.clone()).catch(() => {
          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: "OFFLINE",
                message: "You are offline. Please retry when connected.",
              },
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
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedExact = await caches.match(event.request, { ignoreSearch: true });
          if (cachedExact) return cachedExact;

          const urlPath = url.pathname || "/dashboard";
          const cachedByPath = await caches.match(urlPath);
          if (cachedByPath) return cachedByPath;

          return caches.match("/dashboard");
        })
    );
    return;
  }

  // Static assets (JS, CSS, images) — network-first so design changes apply immediately
  // when online; cache is only used as offline fallback.
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/favicon")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});
