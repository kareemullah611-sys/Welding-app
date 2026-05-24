import { getSyncedModuleData } from "@/lib/offline-full-sync";
import { getOfflineAggregateForApiRequest, getOfflineSpecialApiRequest } from "@/lib/offline-aggregate-prefetch";

/** Re-pull server data when online if last full sync is older than this. */
export const FULL_SYNC_STALE_MS = 12 * 60 * 60 * 1000;

const API_PATH_TO_MODULE: Record<string, string> = {
  "/api/v1/customers": "customers",
  "/api/v1/sales": "sales",
  "/api/v1/payments": "payments",
  "/api/v1/expenses": "expenses",
  "/api/v1/godowns": "godowns",
  "/api/v1/products": "products",
  "/api/v1/cities": "cities",
  "/api/v1/currencies": "currencies",
  "/api/v1/countries": "countries",
  "/api/v1/lots": "lots",
  "/api/v1/suppliers": "suppliers",
  "/api/v1/agents": "agents",
  "/api/v1/shipping-lines": "shippingLines",
  "/api/v1/intermediaries": "intermediaries",
  "/api/v1/investors": "investors",
  "/api/v1/bank-accounts": "bankAccounts",
  "/api/v1/personal-withdrawals": "personalWithdrawals",
  "/api/v1/haji-transfers": "hajiTransfers",
  "/api/v1/bank-deposits": "bankDeposits",
  "/api/v1/city-transfers": "cityTransfers",
  "/api/v1/supplier-payments": "supplierPayments",
  "/api/v1/agent-payments": "agentPayments",
  "/api/v1/shipping-line-payments": "shippingLinePayments",
  "/api/v1/super-admin-personal-expenses": "superAdminExpenses",
};

function normalizeApiPath(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      return new URL(raw).pathname;
    } catch {
      return raw;
    }
  }
  return raw.split("?")[0] || raw;
}

function toBoolParam(value: string | number | undefined): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

export function filterSyncedListRows(
  rows: unknown[],
  params?: Record<string, string | number | undefined>
): unknown[] {
  if (!Array.isArray(rows) || !params) return rows;
  let next = rows;

  const active = toBoolParam(params.is_active);
  if (active !== null) {
    next = next.filter((row) => {
      const record = row as { isActive?: boolean };
      return Boolean(record?.isActive) === active;
    });
  }

  const status = params.status;
  if (status !== undefined && status !== null && status !== "") {
    next = next.filter((row) => String((row as { status?: string })?.status || "") === String(status));
  }

  const q = String(params.q || params.search || "").trim().toLowerCase();
  if (q.length >= 2) {
    next = next.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }

  return next;
}

export function paginateSyncedList<T>(
  rows: T[],
  params?: Record<string, string | number | undefined>
): { data: T[]; pagination: { total: number; totalPages: number; page: number; limit: number } } {
  const total = rows.length;
  const limit = Math.max(1, Number(params?.limit || 20) || 20);
  const page = Math.max(1, Number(params?.page || 1) || 1);
  const skip = (page - 1) * limit;
  const data = rows.slice(skip, skip + limit);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { data, pagination: { total, totalPages, page, limit } };
}

export function getModuleKeyForApiPath(url: string): string | null {
  const path = normalizeApiPath(url);
  const listMatch = path.match(/^(\/api\/v1\/[^/]+)(?:\/|$)/);
  const listPath = listMatch?.[1] ?? path;
  return API_PATH_TO_MODULE[listPath] ?? null;
}

function findSyncedEntityById(rows: unknown[], entityId: string): unknown | null {
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => String((row as { id?: unknown })?.id ?? "") === entityId) ?? null;
}

export async function getFullSyncDetailForApiRequest<T = unknown>(
  url: string
): Promise<{ data: T } | null> {
  const path = normalizeApiPath(url);
  const detailMatch = path.match(/^(\/api\/v1\/[^/]+)\/([^/]+)$/);
  if (!detailMatch) return null;

  const listPath = detailMatch[1];
  const entityId = detailMatch[2];
  if (!entityId || entityId === "hard-delete") return null;

  const moduleKey = API_PATH_TO_MODULE[listPath];
  if (!moduleKey) return null;

  const raw = await getSyncedModuleData(moduleKey);
  const found = findSyncedEntityById(Array.isArray(raw) ? raw : [], entityId);
  if (!found) return null;
  return { data: found as T };
}

export async function getFullSyncDataForApiRequest<T = unknown>(
  url: string,
  params?: Record<string, string | number | undefined>
): Promise<{ data: T; pagination?: { total: number; totalPages: number; page: number; limit: number } } | null> {
  const aggregate = getOfflineAggregateForApiRequest<T>(url, params);
  if (aggregate) return aggregate;

  const special = await getOfflineSpecialApiRequest<T>(url, params);
  if (special) return special;

  const detail = await getFullSyncDetailForApiRequest<T>(url);
  if (detail) return detail;

  const moduleKey = getModuleKeyForApiPath(url);
  if (!moduleKey) return null;

  const raw = await getSyncedModuleData(moduleKey);
  if (!Array.isArray(raw)) return null;

  const filtered = filterSyncedListRows(raw, params);
  const { data, pagination } = paginateSyncedList(filtered, params);
  return { data: data as T, pagination };
}
