/** Server reachability for packaged apps (Electron / Capacitor). Wi‑Fi state is ignored. */

const PROBE_URL = "/api/health";
const PROBE_TIMEOUT_MS = 6000;

let packagedServerReachable = true;

export function getPackagedServerReachable(): boolean {
  return packagedServerReachable;
}

export function setPackagedServerReachable(reachable: boolean): void {
  packagedServerReachable = reachable;
}

export async function probeServerReachable(): Promise<boolean> {
  if (typeof window === "undefined") return true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(PROBE_URL, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
