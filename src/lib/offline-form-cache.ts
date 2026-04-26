type OfflineFormCacheEnvelope = {
  cachedAt: number;
  data: Record<string, unknown>;
};

export function readOfflineFormCache<T extends Record<string, unknown>>(
  key: string,
  requiredArrayFields: Array<keyof T>,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineFormCacheEnvelope;
    if (!parsed || typeof parsed !== "object" || typeof parsed.data !== "object" || !parsed.data) return null;
    const data = parsed.data as T;
    for (const field of requiredArrayFields) {
      if (!Array.isArray(data[field])) return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function writeOfflineFormCache<T extends Record<string, unknown>>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  const envelope: OfflineFormCacheEnvelope = { cachedAt: Date.now(), data };
  window.localStorage.setItem(key, JSON.stringify(envelope));
}
