export type OfflineModuleHashes = Record<string, string>;

export type OfflineSyncMetadata = {
  mode: "full" | "incremental";
  cursor: string;
  moduleHashes: OfflineModuleHashes;
};

function moduleEntries(payload: Record<string, unknown>) {
  return Object.entries(payload).filter(([key]) => !["counts", "syncedAt", "_sync"].includes(key));
}

function hashValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function computeOfflineModuleHashes(payload: Record<string, unknown>): OfflineModuleHashes {
  return Object.fromEntries(moduleEntries(payload).map(([key, value]) => [key, hashValue(value)]));
}

export function buildOfflineSyncDelta(
  payload: Record<string, unknown>,
  previousHashes: OfflineModuleHashes | null
): Record<string, unknown> & { _sync: OfflineSyncMetadata } {
  const moduleHashes = computeOfflineModuleHashes(payload);
  const incremental = Boolean(previousHashes && Object.keys(previousHashes).length > 0);
  const response: Record<string, unknown> = {
    counts: payload.counts ?? {},
    syncedAt: payload.syncedAt ?? new Date().toISOString(),
  };

  for (const [key, value] of moduleEntries(payload)) {
    if (!incremental || previousHashes?.[key] !== moduleHashes[key]) response[key] = value;
  }

  return {
    ...response,
    _sync: {
      mode: incremental ? "incremental" : "full",
      cursor: String(response.syncedAt),
      moduleHashes,
    },
  } as Record<string, unknown> & { _sync: OfflineSyncMetadata };
}

export function mergeOfflineSyncModules(
  existing: Record<string, unknown>,
  changed: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries([
    ...moduleEntries(existing),
    ...moduleEntries(changed),
  ]);
}
