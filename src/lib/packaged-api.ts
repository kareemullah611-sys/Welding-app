const ACCESS_TOKEN_KEY = "mrf-packaged-access-token";
const DEVICE_TOKEN_KEY = "mrf-offline-device-token";
const DEVICE_ID_KEY = "mrf-offline-device-id";
const OFFLINE_SHELL_TOKEN_KEY = "mrf-packaged-offline-shell-token";
const OFFLINE_SHELL_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function isCapacitorRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.Capacitor);
}

export function getPackagedPlatform(): "capacitor" | "electron" | null {
  if (typeof window === "undefined") return null;
  if (window.Capacitor) return "capacitor";
  if (window.platformInfo?.runtime === "electron") return "electron";
  return null;
}

export function getPackagedApiBaseUrl(): string {
  return String(process.env.NEXT_PUBLIC_PACKAGED_API_URL || "").replace(/\/$/, "");
}

export function resolvePackagedApiUrl(url: string): string {
  if (!isCapacitorRuntime() || !url.startsWith("/api/")) return url;
  const baseUrl = getPackagedApiBaseUrl();
  if (!baseUrl) throw new Error("NEXT_PUBLIC_PACKAGED_API_URL is required for Capacitor builds");
  return `${baseUrl}${url}`;
}

export function getOrCreatePackagedDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export function storePackagedCredentials(accessToken: string, deviceToken: string, offlineShellToken?: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
  if (offlineShellToken) window.localStorage.setItem(OFFLINE_SHELL_TOKEN_KEY, offlineShellToken);
}

export function restoreOfflineShellCookie(): boolean {
  if (typeof window === "undefined") return false;
  const token = window.localStorage.getItem(OFFLINE_SHELL_TOKEN_KEY);
  if (!token) return false;
  document.cookie = `offline_shell=${encodeURIComponent(token)}; Path=/; Max-Age=${OFFLINE_SHELL_MAX_AGE_SECONDS}; SameSite=Lax`;
  return true;
}

export function clearPackagedCredentials(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(DEVICE_TOKEN_KEY);
  window.localStorage.removeItem(OFFLINE_SHELL_TOKEN_KEY);
  document.cookie = "offline_shell=; Path=/; Max-Age=0; SameSite=Lax";
}

export function getOfflineDeviceToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(DEVICE_TOKEN_KEY);
}

export function hasPackagedAccessToken(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage.getItem(ACCESS_TOKEN_KEY));
}

export async function packagedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const resolvedUrl = resolvePackagedApiUrl(url);
  const headers = new Headers(init.headers);
  if (isCapacitorRuntime()) {
    const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    if (accessToken && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return fetch(resolvedUrl, { ...init, headers });
}

export async function packagedFetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<Response>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      packagedFetch(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
