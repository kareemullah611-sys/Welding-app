import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

export interface SyncRequestMeta {
  requestId: string;
  deviceId: string | null;
}

const REQUEST_ID_HEADER = "x-sync-request-id";
const DEVICE_ID_HEADER = "x-sync-device-id";

function normalizeHeaderValue(raw: string | null, maxLen: number): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed;
}

export function getSyncRequestMeta(request: NextRequest): SyncRequestMeta | null {
  const requestId = normalizeHeaderValue(request.headers.get(REQUEST_ID_HEADER), 120);
  if (!requestId) return null;
  const deviceId = normalizeHeaderValue(request.headers.get(DEVICE_ID_HEADER), 120);
  return { requestId, deviceId };
}

export function isSyncRequestDuplicateError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = Array.isArray((error.meta as any)?.target) ? (error.meta as any).target.join(",") : String((error.meta as any)?.target || "");
  return target.includes("unique_sync_request_per_city_module") || target.includes("sync_requests_city_id_module_request_id_key");
}
