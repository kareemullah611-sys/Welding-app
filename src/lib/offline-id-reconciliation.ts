import { normalizeReadModelPath } from "@/lib/offline-local-read-model";

export const OFFLINE_ID_MAP_STORE = "id_reconciliation_map";

export interface OfflineIdMapRecord {
  key: string;
  pendingId: string;
  serverId: string;
  entityPath: string;
  mappedAt: number;
}

function normalizeEntityPath(url: string): string {
  return normalizeReadModelPath(url).replace(/\/+$/, "");
}

function buildMapKey(entityPath: string, pendingId: string) {
  return `${entityPath}::${pendingId}`;
}

export function buildPendingRecordId(queueId: string): string {
  return `pending-${queueId}`;
}

export function createIdMapRecord(url: string, queueId: string, serverId: string | number): OfflineIdMapRecord {
  const entityPath = normalizeEntityPath(url);
  const pendingId = buildPendingRecordId(queueId);
  const serverIdStr = String(serverId);
  return {
    key: buildMapKey(entityPath, pendingId),
    pendingId,
    serverId: serverIdStr,
    entityPath,
    mappedAt: Date.now(),
  };
}

export function extractServerId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.id === "number" || typeof data.id === "string") return String(data.id);
  if (data.data && typeof data.data === "object") {
    const nested = data.data as Record<string, unknown>;
    if (typeof nested.id === "number" || typeof nested.id === "string") return String(nested.id);
  }
  return null;
}

function replaceDeep(value: unknown, pendingId: string, serverId: string): unknown {
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, pendingId, serverId));
  if (!value || typeof value !== "object") {
    return String(value) === pendingId ? serverId : value;
  }
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "id" && String(v) === pendingId) {
      out[k] = serverId;
      continue;
    }
    out[k] = replaceDeep(v, pendingId, serverId);
  }
  return out;
}

export function reconcileIdsInReadModel(data: unknown, pendingId: string, serverId: string): unknown {
  return replaceDeep(data, pendingId, serverId);
}
