"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

interface ActivityItem {
  id: number | string;
  user: { id: number; fullName: string; username: string };
  city: { id: number; name: string } | null;
  action: string;
  entityType: string;
  entityId: number;
  entityLabel: string;
  entityDetail: string;
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  createdAt: string;
  syncStatus?: "pending" | "syncing" | "failed" | "conflict" | "synced";
  isLocalQueue?: boolean;
  syncError?: string | null;
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  date: "Date", customer: "Customer", detail: "Detail", amount: "Amount",
  destination: "To", notes: "Notes", method: "Method", voucher: "Voucher",
  total: "Total", items: "Items", lot: "Lot", reason: "Reason",
};

function DetailPanel({ oldValues, newValues, action }: {
  oldValues: Record<string, any> | null;
  newValues: Record<string, any> | null;
  action: string;
}) {
  const [open, setOpen] = useState(false);
  const isUpdate = action === "update";
  const snapshot = isUpdate ? oldValues : (oldValues ?? newValues);
  const after = isUpdate ? newValues : null;
  const entries = Object.entries(snapshot ?? {}).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return null;

  const btnLabel = action === "hard_delete" || action === "delete" ? "View deleted record"
    : action === "cancel" ? "View cancelled record"
    : action === "create" ? "View details"
    : "View changes";

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-700 transition-colors"
      >
        <span className={cn("inline-block transition-transform duration-150", open ? "rotate-90" : "")}>›</span>
        {btnLabel}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden text-xs">
          {isUpdate && (
            <div className="flex text-[10px] font-semibold uppercase tracking-widest text-gray-400 bg-gray-100 border-b border-gray-200">
              <div className="w-20 flex-shrink-0 px-3 py-1.5 border-r border-gray-200" />
              <div className="flex-1 px-3 py-1.5">Before</div>
              <div className="flex-1 px-3 py-1.5 border-l border-gray-200">After</div>
            </div>
          )}
          <div className="divide-y divide-gray-100">
            {entries.map(([key, val]) => {
              const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
              const afterVal = after?.[key];
              const changed = isUpdate && afterVal !== undefined && String(afterVal) !== String(val);
              return (
                <div key={key} className={cn("flex", changed && "bg-amber-50/60")}>
                  <div className="w-20 flex-shrink-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-white border-r border-gray-100">
                    {label}
                  </div>
                  {isUpdate ? (
                    <>
                      <div className={cn("flex-1 px-3 py-1.5", changed ? "line-through text-gray-400" : "text-gray-700")}>
                        {String(val)}
                      </div>
                      <div className={cn("flex-1 px-3 py-1.5 border-l border-gray-100", changed ? "text-gray-900 font-medium" : "text-gray-400 italic")}>
                        {afterVal !== undefined ? String(afterVal) : "—"}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 px-3 py-1.5 text-gray-700 break-words">{String(val)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Config ───────────────────────────────────────────────────────────────────
const ACTION_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  create:      { label: "Created",   cls: "bg-green-100 text-green-700 border-green-200",     dot: "bg-green-500" },
  update:      { label: "Updated",   cls: "bg-blue-100 text-blue-700 border-blue-200",       dot: "bg-blue-500" },
  delete:      { label: "Deleted",   cls: "bg-red-100 text-red-700 border-red-200",          dot: "bg-red-500" },
  hard_delete: { label: "Deleted",   cls: "bg-red-100 text-red-800 border-red-300",          dot: "bg-red-600" },
  cancel:      { label: "Cancelled", cls: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  restore:     { label: "Restored",  cls: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-500" },
};

const SYNC_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  synced:   { label: "Synced",   cls: "bg-green-100 text-green-700 border-green-200" },
  pending:  { label: "Pending",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
  syncing:  { label: "Syncing",  cls: "bg-blue-100 text-blue-700 border-blue-200" },
  failed:   { label: "Failed",   cls: "bg-red-100 text-red-700 border-red-200" },
  conflict: { label: "Conflict", cls: "bg-orange-100 text-orange-700 border-orange-200" },
};

const ENTITY_CONFIG: Record<string, { icon: string; label: string }> = {
  sale:                { icon: "🧾", label: "Sale" },
  payment:             { icon: "💰", label: "Payment" },
  expense:             { icon: "💸", label: "Expense" },
  customer:            { icon: "👤", label: "Customer" },
  lot:                 { icon: "📦", label: "Lot" },
  godown_transfer:     { icon: "🔄", label: "Godown Transfer" },
  haji_transfer:       { icon: "↗️", label: "Haji Transfer" },
  personal_withdrawal: { icon: "🏦", label: "Withdrawal" },
  product:             { icon: "🏷️", label: "Product" },
  user:                { icon: "👤", label: "User" },
  city_transfer:       { icon: "🔄", label: "City Transfer" },
  supplier_payment:    { icon: "💵", label: "Supplier Payment" },
  lot_cost:            { icon: "🏷️", label: "Lot Cost" },
  lot_purchase:        { icon: "🛒", label: "Lot Purchase" },
  agent:               { icon: "🤝", label: "Agent" },
  agent_payment:       { icon: "💳", label: "Agent Payment" },
  offline_entry:       { icon: "📝", label: "Offline Entry" },
};

// Natural-language verb phrase: "created a new sale", "updated payment", etc.
function buildVerb(action: string, entityType: string): string {
  const entity = ENTITY_CONFIG[entityType]?.label.toLowerCase() ?? entityType.replace(/_/g, " ");
  switch (action) {
    case "create":  return `created a new ${entity}`;
    case "update":  return `updated a ${entity}`;
    case "delete":  return `deleted a ${entity}`;
    case "cancel":  return `cancelled a ${entity}`;
    case "restore": return `restored a ${entity}`;
    default:        return `${action} ${entity}`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string, t: (k: string) => string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return t("just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function getDayLabel(dateStr: string, t: (k: string) => string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t("today");
  if (date.toDateString() === yesterday.toDateString()) return t("yesterday");
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
}

function UserAvatar({ name }: { name: string }) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <div className="w-8 h-8 rounded-full bg-primary-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0 ring-2 ring-primary-500/20">
      {initials || "?"}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ActivityFeedPage() {
  const { user } = useAuth();
  const { queuedItems } = useOffline();
  const { t } = useLang();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [cities, setCities] = useState<{ id: number; name: string }[]>([]);
  const [filterCityId, setFilterCityId] = useState<number | "">("");

  useEffect(() => {
    if (user?.role === "super_admin") {
      apiCall<any[]>("/api/v1/cities").then((r) => { if (r.success) setCities(r.data as any[]); });
    }
  }, [user]);

  const load = useCallback(async (p = 1, cityId?: number | "") => {
    if (p === 1) setLoading(true);
    const params: any = { page: p, limit: 30 };
    const cid = cityId !== undefined ? cityId : filterCityId;
    if (cid) params.city_id = cid;
    const res = await apiCall<any>("/api/v1/activity-feed", { params });
    if (res.success) {
      setItems(res.data.items);
      setTotalPages(res.data.pagination.totalPages);
      setTotal(res.data.pagination.total);
      setPage(p);
    }
    setLoading(false);
  }, [filterCityId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh || page !== 1) return;
    const interval = setInterval(() => load(1), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, page, load]);

  const localQueueItems: ActivityItem[] = user?.role === "city_admin" && page === 1
    ? queuedItems.map((entry) => ({
        id: `local-${entry.id}`,
        user: {
          id: Number(user.id),
          fullName: user.fullName,
          username: user.username,
        },
        city: user.cityId && user.cityName ? { id: user.cityId, name: user.cityName } : null,
        action: entry.auditMeta?.action || "create",
        entityType: entry.auditMeta?.entityType || "offline_entry",
        entityId: 0,
        entityLabel: entry.auditMeta?.entityLabel || "Offline Entry",
        entityDetail: entry.auditMeta?.entityDetail || "Waiting for internet sync",
        oldValues: null,
        newValues: null,
        createdAt: new Date(entry.timestamp).toISOString(),
        syncStatus: entry.syncStatus,
        isLocalQueue: true,
        syncError: entry.lastError || null,
      }))
    : [];

  const feedItems = [...localQueueItems, ...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Group by day
  const grouped: { label: string; items: ActivityItem[] }[] = [];
  let currentDay = "";
  for (const item of feedItems) {
    const day = getDayLabel(item.createdAt, t);
    if (day !== currentDay) { currentDay = day; grouped.push({ label: day, items: [] }); }
    grouped[grouped.length - 1].items.push(item);
  }

  return (
    <div>
      <PageHeader
        title={t("activity_feed")}
        subtitle={`${total} ${t("records")}${filterCityId ? ` · ${cities.find(c => c.id === filterCityId)?.name}` : ""}`}
        action={
          <div className="flex items-center gap-3 flex-wrap">
            {user?.role === "super_admin" && (
              <select
                value={filterCityId}
                onChange={(e) => {
                  const v = e.target.value === "" ? "" : parseInt(e.target.value);
                  setFilterCityId(v);
                  load(1, v);
                }}
                className="input-field text-sm py-1.5 pr-8"
              >
                <option value="">All Cities</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded border-gray-300" />
              {t("auto_refresh")}
            </label>
            <button onClick={() => load(1)} className="btn-secondary text-sm">{t("refresh")}</button>
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : feedItems.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">{t("no_activity")}</div>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.label}>
              {/* Day header */}
              <div className="sticky top-0 z-10 bg-gray-50 pb-2 mb-3">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{group.label}</span>
                </span>
              </div>

              {/* Items */}
              <div className="space-y-2">
                {group.items.map((item) => {
                  const actionCfg = ACTION_CONFIG[item.action] ?? { label: item.action, cls: "bg-gray-100 text-gray-600 border-gray-200", dot: "bg-gray-400" };
                  const entityCfg = ENTITY_CONFIG[item.entityType] ?? { icon: "📝", label: item.entityType };
                  const verb = buildVerb(item.action, item.entityType);
                  const syncKey = item.syncStatus || "synced";
                  const syncCfg = SYNC_STATUS_CONFIG[syncKey] || SYNC_STATUS_CONFIG.synced;

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-xl border border-gray-100 px-4 py-3.5 hover:border-gray-200 hover:shadow-sm transition-all duration-150"
                    >
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <UserAvatar name={item.user.fullName} />

                        {/* Body */}
                        <div className="flex-1 min-w-0">
                          {/* Line 1: Who did what */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{item.user.fullName}</span>
                            <span className={cn(
                              "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border",
                              actionCfg.cls
                            )}>
                              <span className={cn("w-1.5 h-1.5 rounded-full", actionCfg.dot)} />
                              {actionCfg.label}
                            </span>
                            <span className="text-sm text-gray-500">
                              {entityCfg.icon} <span className="text-gray-700 font-medium">{item.entityLabel}</span>
                            </span>
                            {item.city && (
                              <span className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                                📍 {item.city.name}
                              </span>
                            )}
                          </div>

                          {/* Line 2: Summary detail */}
                          {item.entityDetail && (
                            <p className="mt-1 text-sm text-gray-500 leading-snug break-words">
                              {item.entityDetail}
                            </p>
                          )}

                          {/* Line 3: Collapsible full record panel */}
                          <DetailPanel
                            oldValues={item.oldValues}
                            newValues={item.newValues}
                            action={item.action}
                          />

                          {/* Line 4: Natural language summary */}
                          <p className="mt-1.5 text-xs text-gray-400 italic">
                            {item.user.fullName.split(" ")[0]} {verb}
                          </p>
                        </div>

                        {/* Timestamp */}
                        <div className="flex-shrink-0 text-right pt-0.5 space-y-1">
                          <div className="flex justify-end">
                            <span
                              className={cn("inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border", syncCfg.cls)}
                              title={item.syncError || undefined}
                            >
                              {syncCfg.label}
                            </span>
                          </div>
                          <span
                            className="text-xs text-gray-400 whitespace-nowrap"
                            title={formatFullDate(item.createdAt)}
                          >
                            {timeAgo(item.createdAt, t)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">{t("page")} {page} {t("of")} {totalPages}</p>
              <div className="flex gap-2">
                <button onClick={() => load(page - 1)} disabled={page <= 1} className="btn-secondary text-xs px-3 py-1">← {t("previous")}</button>
                <button onClick={() => load(page + 1)} disabled={page >= totalPages} className="btn-secondary text-xs px-3 py-1">{t("next")} →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
