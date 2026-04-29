import { buildApiCacheKey } from "@/lib/offline-cache";

export interface LocalReadModelRecord<T = unknown> {
  key: string;
  data: T;
  pagination?: unknown;
  updatedAt: number;
}

const CREATE_LIST_PATHS = new Set([
  "/api/v1/customers",
  "/api/v1/sales",
  "/api/v1/payments",
  "/api/v1/expenses",
  "/api/v1/personal-withdrawals",
  "/api/v1/haji-transfers",
  "/api/v1/bank-deposits",
  "/api/v1/city-transfers",
]);

function safeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function normalizePath(url: string): string {
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

function makePendingId(queueId: string) {
  return `pending-${queueId}`;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pendingCustomer(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  return {
    id: makePendingId(queueId),
    name: String(payload.name || "Pending Customer"),
    phone: String(payload.phone || ""),
    cityId: payload.cityId ?? null,
    area: String(payload.area || ""),
    createdAt: new Date(timestamp).toISOString(),
    isActive: true,
  };
}

function pendingSale(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  const amount = toNumber(payload.totalAmount) ?? toNumber(payload.amount) ?? 0;
  return {
    id: makePendingId(queueId),
    voucherNo: String(payload.voucherNo || payload.manualVoucherNo || "PENDING"),
    date: String(payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    customerName: String(payload.customerName || "Pending Customer"),
    amount,
    totalAmount: amount,
    status: "active",
    createdAt: new Date(timestamp).toISOString(),
  };
}

function pendingPayment(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  const amount = toNumber(payload.amount) ?? 0;
  return {
    id: makePendingId(queueId),
    date: String(payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    customerName: String(payload.customerName || "Pending Customer"),
    detail: String(payload.detail || "Pending offline payment"),
    amount,
    status: "active",
    createdAt: new Date(timestamp).toISOString(),
  };
}

function pendingExpense(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  const amount = toNumber(payload.amount) ?? 0;
  return {
    id: makePendingId(queueId),
    date: String(payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    detail: String(payload.detail || "Pending offline expense"),
    amount,
    status: "active",
    createdAt: new Date(timestamp).toISOString(),
  };
}

function pendingWithdrawal(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  const amount = toNumber(payload.amount) ?? 0;
  return {
    id: makePendingId(queueId),
    date: String(payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    withdrawnBy: String(payload.withdrawnBy || "Pending"),
    reason: String(payload.reason || ""),
    amount,
    status: "approved",
    approvalStatus: "pending",
    createdAt: new Date(timestamp).toISOString(),
  };
}

function pendingHajiTransfer(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  const amount = toNumber(payload.amount) ?? 0;
  return {
    id: makePendingId(queueId),
    date: String(payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    detail: String(payload.detail || "Pending offline haji transfer"),
    amount,
    status: "active",
    createdAt: new Date(timestamp).toISOString(),
  };
}

function pendingBankDeposit(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  const amount = toNumber(payload.cashAmount) ?? toNumber(payload.amount) ?? 0;
  return {
    id: makePendingId(queueId),
    date: String(payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    amount,
    transferType: String(payload.transferType || payload.depositType || "cash_to_bank"),
    status: "active",
    createdAt: new Date(timestamp).toISOString(),
  };
}

function pendingCityTransfer(body: unknown, queueId: string, timestamp: number) {
  const payload = safeObject(body);
  return {
    id: makePendingId(queueId),
    transferDate: String(payload.transferDate || payload.date || new Date(timestamp).toISOString().slice(0, 10)),
    qty: toNumber(payload.qty) ?? 0,
    status: "active",
    createdAt: new Date(timestamp).toISOString(),
  };
}

export function buildPendingReadModelRow(path: string, body: unknown, queueId: string, timestamp: number): Record<string, unknown> | null {
  if (path === "/api/v1/customers") return pendingCustomer(body, queueId, timestamp);
  if (path === "/api/v1/sales") return pendingSale(body, queueId, timestamp);
  if (path === "/api/v1/payments") return pendingPayment(body, queueId, timestamp);
  if (path === "/api/v1/expenses") return pendingExpense(body, queueId, timestamp);
  if (path === "/api/v1/personal-withdrawals") return pendingWithdrawal(body, queueId, timestamp);
  if (path === "/api/v1/haji-transfers") return pendingHajiTransfer(body, queueId, timestamp);
  if (path === "/api/v1/bank-deposits") return pendingBankDeposit(body, queueId, timestamp);
  if (path === "/api/v1/city-transfers") return pendingCityTransfer(body, queueId, timestamp);
  return null;
}

function dedupeById(rows: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const row of rows) {
    const id = safeObject(row).id;
    const key = String(id ?? "");
    if (!key) {
      result.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export function mergeReadModelRows(baseData: unknown, readModelRows: unknown[]): unknown {
  if (!Array.isArray(baseData)) return baseData;
  if (!readModelRows.length) return baseData;
  return dedupeById([...readModelRows, ...baseData]);
}

export function canApplyCreateToReadModel(url: string, method: string): boolean {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod !== "POST") return false;
  return CREATE_LIST_PATHS.has(normalizePath(url));
}

export function getReadModelKey(url: string, params?: Record<string, string | number | undefined>): string {
  return buildApiCacheKey(normalizePath(url), params);
}

export function removePendingReadModelRowsByQueueId(baseData: unknown, queueId: string): unknown {
  if (!Array.isArray(baseData)) return baseData;
  const pendingId = makePendingId(queueId);
  return baseData.filter((row) => String(safeObject(row).id || "") !== pendingId);
}
