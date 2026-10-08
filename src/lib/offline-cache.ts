import { isOfflineFeaturesEnabled } from "@/lib/offline-features";
import { getPackagedServerReachable } from "@/lib/offline-reachability";
import {
  isAllowlistedOfflineMutationPath as isPolicyAllowlistedOfflineMutationPath,
  isOfflineQueueBlockedPath as isPolicyOfflineQueueBlockedPath,
} from "@/lib/offline-route-policy";

export const OFFLINE_DB_NAME = "mrf-offline";
export const OFFLINE_DB_VERSION = 7;
export const OFFLINE_QUEUE_STORE = "queue";
export const OFFLINE_STOCK_STORE = "stock_cache";
export const OFFLINE_API_CACHE_STORE = "api_cache";
export const OFFLINE_LOCAL_READ_MODEL_STORE = "local_read_models";
export const OFFLINE_ID_MAP_STORE = "id_reconciliation_map";
export const OFFLINE_FULL_SYNC_STORE = "full_sync_data";
export const OFFLINE_FULL_SYNC_META_STORE = "full_sync_meta";

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.reject(new Error("offline db unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE))
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(OFFLINE_STOCK_STORE))
        db.createObjectStore(OFFLINE_STOCK_STORE, { keyPath: "godownId" });
      if (!db.objectStoreNames.contains(OFFLINE_API_CACHE_STORE))
        db.createObjectStore(OFFLINE_API_CACHE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OFFLINE_LOCAL_READ_MODEL_STORE))
        db.createObjectStore(OFFLINE_LOCAL_READ_MODEL_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OFFLINE_ID_MAP_STORE))
        db.createObjectStore(OFFLINE_ID_MAP_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OFFLINE_FULL_SYNC_STORE))
        db.createObjectStore(OFFLINE_FULL_SYNC_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OFFLINE_FULL_SYNC_META_STORE))
        db.createObjectStore(OFFLINE_FULL_SYNC_META_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("offline db upgrade blocked"));
  });
}

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

export interface OfflineAuditMeta {
  action: "create" | "update" | "delete";
  entityType: string;
  entityLabel: string;
  entityDetail: string;
}

const OFFLINE_AUDIT_META_BY_PATH: Record<string, { entityType: string; entityLabel: string }> = {
  "/api/v1/sales": { entityType: "sale", entityLabel: "Sale" },
  "/api/v1/payments": { entityType: "payment", entityLabel: "Payment" },
  "/api/v1/expenses": { entityType: "expense", entityLabel: "Expense" },
  "/api/v1/personal-withdrawals": { entityType: "personal_withdrawal", entityLabel: "Personal Withdrawal" },
  "/api/v1/haji-transfers": { entityType: "haji_transfer", entityLabel: "Haji Transfer" },
  "/api/v1/customers": { entityType: "customer", entityLabel: "Customer" },
  "/api/v1/bank-deposits": { entityType: "bank_deposit", entityLabel: "Bank Deposit" },
  "/api/v1/suppliers": { entityType: "supplier", entityLabel: "Supplier" },
  "/api/v1/intermediaries": { entityType: "intermediary", entityLabel: "Intermediary" },
  "/api/v1/supplier-payments": { entityType: "supplier_payment", entityLabel: "Supplier Payment" },
  "/api/v1/shipping-line-payments": { entityType: "shipping_line_payment", entityLabel: "Shipping Line Payment" },
  "/api/v1/super-admin-personal-expenses": { entityType: "super_admin_personal_expense", entityLabel: "Home Expense" },
  "/api/v1/agent-payments": { entityType: "agent_payment", entityLabel: "Agent Payment" },
  "/api/v1/lot-costs": { entityType: "lot_cost", entityLabel: "Lot Cost" },
  "/api/v1/openings": { entityType: "opening_entry", entityLabel: "Opening Entry" },
  "/api/v1/lots": { entityType: "lot", entityLabel: "Lot" },
  "/api/v1/lot-purchases": { entityType: "lot_purchase", entityLabel: "Lot Purchase" },
  "/api/v1/products": { entityType: "product", entityLabel: "Product" },
  "/api/v1/users": { entityType: "user", entityLabel: "User" },
  "/api/v1/shipping-lines": { entityType: "shipping_line", entityLabel: "Shipping Line" },
  "/api/v1/agents": { entityType: "agent", entityLabel: "Agent" },
  "/api/v1/bank-accounts": { entityType: "bank_account", entityLabel: "Bank Account" },
  "/api/v1/super-admin-account-transfers": { entityType: "super_admin_account_transfer", entityLabel: "Account Transfer" },
  "/api/v1/city-transfers": { entityType: "city_transfer", entityLabel: "City Transfer" },
  "/api/v1/godowns/transfers": { entityType: "godown_transfer", entityLabel: "Godown Transfer" },
  "/api/v1/investors": { entityType: "investor", entityLabel: "Investor" },
};

function getDynamicAuditMeta(path: string): { entityType: string; entityLabel: string } | null {
  if (/^\/api\/v1\/intermediaries\/\d+\/deposits$/.test(path)) {
    return { entityType: "intermediary_deposit", entityLabel: "Intermediary Deposit" };
  }
  if (/^\/api\/v1\/intermediaries\/\d+\/exchanges$/.test(path)) {
    return { entityType: "intermediary_exchange", entityLabel: "Intermediary Exchange" };
  }
  if (/^\/api\/v1\/investors\/\d+\/transactions$/.test(path)) {
    return { entityType: "investor_transaction", entityLabel: "Investor Transaction" };
  }
  return null;
}

function detailFromBody(path: string, body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (path === "/api/v1/customers" && typeof record.name === "string" && record.name.trim()) {
    return `Customer: ${record.name.trim()}`;
  }
  if (path === "/api/v1/sales" && typeof record.notes === "string" && record.notes.trim()) {
    return `Notes: ${record.notes.trim()}`;
  }
  if (path === "/api/v1/payments" && typeof record.detail === "string" && record.detail.trim()) {
    return `Detail: ${record.detail.trim()}`;
  }
  if (path === "/api/v1/expenses" && typeof record.detail === "string" && record.detail.trim()) {
    return `Detail: ${record.detail.trim()}`;
  }
  if (path === "/api/v1/personal-withdrawals" && typeof record.withdrawnBy === "string" && record.withdrawnBy.trim()) {
    return `By: ${record.withdrawnBy.trim()}`;
  }
  if (path === "/api/v1/haji-transfers" && typeof record.detail === "string" && record.detail.trim()) {
    return `Detail: ${record.detail.trim()}`;
  }
  if (path === "/api/v1/bank-deposits" && typeof record.depositType === "string" && record.depositType.trim()) {
    return `Type: ${record.depositType.trim()}`;
  }
  if (path === "/api/v1/suppliers" && typeof record.name === "string" && record.name.trim()) {
    return `Supplier: ${record.name.trim()}`;
  }
  if (path === "/api/v1/intermediaries" && typeof record.name === "string" && record.name.trim()) {
    return `Intermediary: ${record.name.trim()}`;
  }
  if (path === "/api/v1/supplier-payments" && typeof record.amountUsd !== "undefined") {
    return `Amount USD: ${record.amountUsd}`;
  }
  if (path === "/api/v1/shipping-line-payments" && typeof record.amountUsd !== "undefined") {
    return `Amount USD: ${record.amountUsd}`;
  }
  if (path === "/api/v1/super-admin-personal-expenses" && typeof record.amount !== "undefined") {
    return `Amount: ${record.amount}`;
  }
  if (path === "/api/v1/agent-payments" && typeof record.amount !== "undefined") {
    return `Amount: ${record.amount}`;
  }
  if (path === "/api/v1/lot-costs" && typeof record.amount !== "undefined") {
    return `Amount: ${record.amount}`;
  }
  if (/^\/api\/v1\/intermediaries\/\d+\/deposits$/.test(path) && typeof record.amount !== "undefined") {
    return `Amount: ${record.amount}`;
  }
  if (/^\/api\/v1\/intermediaries\/\d+\/exchanges$/.test(path) && typeof record.fromAmount !== "undefined") {
    return `From Amount: ${record.fromAmount}`;
  }
  if (path === "/api/v1/lots" && typeof record.lotNumber === "string" && record.lotNumber.trim()) {
    return `Lot: ${record.lotNumber.trim()}`;
  }
  if (path === "/api/v1/lot-purchases" && typeof record.lotId !== "undefined") {
    return `Lot ID: ${record.lotId}`;
  }
  if (path === "/api/v1/products" && typeof record.name === "string" && record.name.trim()) {
    return `Product: ${record.name.trim()}`;
  }
  if (path === "/api/v1/users" && typeof record.fullName === "string" && record.fullName.trim()) {
    return `User: ${record.fullName.trim()}`;
  }
  if (path === "/api/v1/shipping-lines" && typeof record.name === "string" && record.name.trim()) {
    return `Shipping Line: ${record.name.trim()}`;
  }
  if (path === "/api/v1/agents" && typeof record.name === "string" && record.name.trim()) {
    return `Agent: ${record.name.trim()}`;
  }
  if (path === "/api/v1/bank-accounts" && typeof record.bankName === "string" && record.bankName.trim()) {
    return `Bank: ${record.bankName.trim()}`;
  }
  if (path === "/api/v1/city-transfers" && typeof record.qty !== "undefined") {
    return `Qty: ${record.qty}`;
  }
  if (path === "/api/v1/godowns/transfers" && typeof record.qty !== "undefined") {
    return `Qty: ${record.qty}`;
  }
  if (/^\/api\/v1\/investors\/\d+\/transactions$/.test(path) && typeof record.type === "string") {
    return `Type: ${record.type}`;
  }
  if (path === "/api/v1/openings") {
    const kind = typeof record.kind === "string" && record.kind.trim() ? record.kind.trim() : "entry";
    return `Kind: ${kind}`;
  }
  if (path === "/api/v1/investors" && typeof record.name === "string" && record.name.trim()) {
    return `Investor: ${record.name.trim()}`;
  }
  return null;
}

function getAuditMetaForMutationPath(path: string): { entityType: string; entityLabel: string } | null {
  const listMatch = path.match(/^(\/api\/v1\/[^/]+)(?:\/|$)/);
  const listPath = listMatch?.[1];
  if (!listPath) return null;
  if (OFFLINE_AUDIT_META_BY_PATH[listPath]) return OFFLINE_AUDIT_META_BY_PATH[listPath];
  return getDynamicAuditMeta(path);
}

function mutationActionLabel(method: string): "update" | "delete" {
  return method === "DELETE" ? "delete" : "update";
}

export function buildOfflineAuditMeta(url: string, method: string, body: unknown): OfflineAuditMeta {
  const normalizedMethod = String(method || "POST").toUpperCase();
  const path = normalizeApiPath(url);
  const mapped = OFFLINE_AUDIT_META_BY_PATH[path] ?? getDynamicAuditMeta(path) ?? getAuditMetaForMutationPath(path);
  if (normalizedMethod === "POST" && mapped) {
    return {
      action: "create",
      entityType: mapped.entityType,
      entityLabel: mapped.entityLabel,
      entityDetail: detailFromBody(path, body) || `Queued offline ${mapped.entityLabel.toLowerCase()} entry`,
    };
  }
  if (["PUT", "PATCH", "DELETE"].includes(normalizedMethod) && mapped) {
    const verb = normalizedMethod === "DELETE" ? "Delete" : "Update";
    return {
      action: mutationActionLabel(normalizedMethod),
      entityType: mapped.entityType,
      entityLabel: mapped.entityLabel,
      entityDetail: detailFromBody(path, body) || `Queued offline ${verb.toLowerCase()} ${mapped.entityLabel.toLowerCase()}`,
    };
  }
  return {
    action: normalizedMethod === "DELETE" ? "delete" : normalizedMethod === "POST" ? "create" : "update",
    entityType: "offline_entry",
    entityLabel: "Offline Entry",
    entityDetail: `${normalizedMethod} ${url}`,
  };
}

export function isOfflineQueueBlockedPath(path: string): boolean {
  return isPolicyOfflineQueueBlockedPath(path);
}

export function isAllowlistedOfflineMutationPath(path: string): boolean {
  return isPolicyAllowlistedOfflineMutationPath(path);
}

export function buildApiCacheKey(
  url: string,
  params?: Record<string, string | number | undefined>
): string {
  if (!params) return url;
  const normalized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!normalized.length) return url;
  const qs = normalized
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${url}?${qs}`;
}

/** Electron DMG or Capacitor APK — browser uses live API only. */
export function isPackagedOfflineRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return window.platformInfo?.runtime === "electron" || Boolean(window.Capacitor);
}

/** Packaged runtime with offline features turned on via NEXT_PUBLIC_OFFLINE_ENABLED. */
export function isPackagedOfflineActive(): boolean {
  return isPackagedOfflineRuntime() && isOfflineFeaturesEnabled();
}

export function shouldUseOfflineApiCache(): boolean {
  return isPackagedOfflineActive();
}

export function shouldAutoQueueOfflineWrite(url: string, method: string): boolean {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const path = normalizeApiPath(url);
  if (!path.startsWith("/api/v1/")) return false;
  if (path.startsWith("/api/v1/auth/")) return false;
  if (path === "/api/v1/auth/logout") return false;
  if (isOfflineQueueBlockedPath(path)) return false;

  if (normalizedMethod === "POST") {
    return isAllowlistedOfflineMutationPath(path);
  }

  if (["PUT", "PATCH", "DELETE"].includes(normalizedMethod)) {
    return isAllowlistedOfflineMutationPath(path);
  }

  return false;
}

/** Queue before attempting network when the server is unreachable (packaged apps only). */
export function shouldQueueOfflineWriteNow(url: string, method: string): boolean {
  if (!isPackagedOfflineActive()) return false;
  if (getPackagedServerReachable()) return false;
  return shouldAutoQueueOfflineWrite(url, method);
}

/** Queue after a failed request when packaged (Wi‑Fi may be on but server is not). */
export function shouldQueueOfflineWriteOnNetworkFailure(url: string, method: string): boolean {
  if (!isPackagedOfflineActive()) return false;
  return shouldAutoQueueOfflineWrite(url, method);
}
