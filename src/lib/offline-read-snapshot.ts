export type OfflineReadSnapshotEnvelope<T> = {
  cachedAt: number;
  data: T;
};

export function readOfflineReadSnapshot<T>(key: string): OfflineReadSnapshotEnvelope<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineReadSnapshotEnvelope<T>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.cachedAt !== "number" || parsed.data === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeOfflineReadSnapshot<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  const payload: OfflineReadSnapshotEnvelope<T> = { cachedAt: Date.now(), data };
  window.localStorage.setItem(key, JSON.stringify(payload));
}
