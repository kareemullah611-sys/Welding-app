import { isPackagedOfflineRuntime } from "@/lib/offline-cache";
import { importOfflineSyncPayload, isOfflineSyncStoreEmpty } from "@/lib/offline-seed-import";

export const OFFLINE_SEED_URL = "/offline-seed.json";
export const OFFLINE_SEED_APPLIED_KEY = "mrf-offline-seed-applied-v1";

export type OfflineSeedBundle = {
  version?: number;
  generatedAt?: string | null;
  modules?: Record<string, unknown>;
  syncPayload?: Record<string, unknown>;
};

export function parseOfflineSeedBundle(bundle: OfflineSeedBundle): Record<string, unknown> | null {
  return extractModules(bundle);
}

function extractModules(bundle: OfflineSeedBundle): Record<string, unknown> | null {
  const modules = bundle.modules ?? bundle.syncPayload;
  if (!modules || typeof modules !== "object") return null;
  const hasRows = Object.entries(modules).some(
    ([key, value]) => key !== "counts" && key !== "syncedAt" && Array.isArray(value) && value.length > 0
  );
  return hasRows ? modules : null;
}

/** On first packaged launch, import bundled seed if local archive is empty. */
export async function tryBootstrapBundledOfflineSeed(): Promise<{ applied: boolean; reason?: string }> {
  if (typeof window === "undefined") return { applied: false, reason: "no window" };
  if (!isPackagedOfflineRuntime()) return { applied: false, reason: "not packaged" };
  if (window.localStorage.getItem(OFFLINE_SEED_APPLIED_KEY)) {
    return { applied: false, reason: "already applied" };
  }
  if (!(await isOfflineSyncStoreEmpty())) {
    return { applied: false, reason: "local data exists" };
  }

  let bundle: OfflineSeedBundle;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(OFFLINE_SEED_URL, { signal: controller.signal, cache: "no-cache" });
    clearTimeout(timeout);
    if (!res.ok) return { applied: false, reason: `seed fetch ${res.status}` };
    bundle = (await res.json()) as OfflineSeedBundle;
  } catch {
    return { applied: false, reason: "seed fetch failed" };
  }

  const modules = extractModules(bundle);
  if (!modules) return { applied: false, reason: "empty seed" };

  await importOfflineSyncPayload(modules, { bundledAt: bundle.generatedAt || new Date().toISOString() });
  window.localStorage.setItem(OFFLINE_SEED_APPLIED_KEY, bundle.generatedAt || new Date().toISOString());
  window.dispatchEvent(new Event("mrf-offline-full-sync-complete"));
  window.dispatchEvent(new Event("mrf-offline-seed-applied"));
  return { applied: true };
}
