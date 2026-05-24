/** Server reachability for packaged apps (Electron / Capacitor). Wi‑Fi state is ignored. */

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const PROBE_URL = "/api/health";
const PROBE_TIMEOUT_MS = 4000;

/** Assume offline until a quick health probe succeeds (offline-first startup). */
let packagedServerReachable = false;

export function getPackagedServerReachable(): boolean {
  return packagedServerReachable;
}

export function setPackagedServerReachable(reachable: boolean): void {
  packagedServerReachable = reachable;
}

export async function probeServerReachable(): Promise<boolean> {
  if (typeof window === "undefined") return true;

  try {
    const res = await fetchWithTimeout(
      PROBE_URL,
      { credentials: "include", cache: "no-store" },
      PROBE_TIMEOUT_MS
    );
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return Boolean(json?.ok);
  } catch {
    return false;
  }
}
