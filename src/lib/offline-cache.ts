export const OFFLINE_DB_NAME = "mrf-offline";
export const OFFLINE_DB_VERSION = 3;
export const OFFLINE_QUEUE_STORE = "queue";
export const OFFLINE_STOCK_STORE = "stock_cache";
export const OFFLINE_API_CACHE_STORE = "api_cache";

export function buildApiCacheKey(
  url: string,
  params?: Record<string, string | number | undefined>
): string {
  if (!params) return url;
  const normalized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!normalized.length) return url;
  const qs = normalized
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${url}?${qs}`;
}

export function shouldAutoQueueOfflineWrite(url: string, method: string): boolean {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod === "GET") return false;
  if (!url.startsWith("/api/v1/")) return false;
  if (url.startsWith("/api/v1/auth/")) return false;
  if (url === "/api/v1/auth/logout") return false;
  return true;
}
