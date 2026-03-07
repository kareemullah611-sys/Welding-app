"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/lang";

interface ActivityItem {
  id: number;
  user: { id: number; fullName: string; username: string };
  city: { id: number; name: string } | null;
  action: string;
  entityType: string;
  entityId: number;
  entityLabel: string;
  entityDetail: string;
  createdAt: string;
}

const ACTION_ICONS: Record<string, string> = {
  create: "➕", update: "✏️", delete: "🗑️", cancel: "❌", restore: "♻️",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-700 border-green-200",
  update: "bg-blue-100 text-blue-700 border-blue-200",
  delete: "bg-red-100 text-red-700 border-red-200",
  cancel: "bg-orange-100 text-orange-700 border-orange-200",
  restore: "bg-purple-100 text-purple-700 border-purple-200",
};

const ENTITY_ICONS: Record<string, string> = {
  sale: "🧾", payment: "💰", expense: "💸", customer: "👤", lot: "📦",
  godown_transfer: "🔄", haji_transfer: "↗️", personal_withdrawal: "🏦",
  product: "🏷️", user: "👤", city_transfer: "🔄", supplier_payment: "💵",
  lot_cost: "🏷️", lot_purchase: "🛒", agent: "🤝", agent_payment: "💳",
};

function timeAgo(dateStr: string, t: (k: string) => string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return t("just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

export default function ActivityFeedPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async (p = 1) => {
    if (p === 1) setLoading(true);
    const res = await apiCall<any>("/api/v1/activity-feed", { params: { page: p, limit: 30 } });
    if (res.success) {
      setItems(res.data.items);
      setTotalPages(res.data.pagination.totalPages);
      setTotal(res.data.pagination.total);
      setPage(p);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh || page !== 1) return;
    const interval = setInterval(() => load(1), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, page, load]);

  const grouped: { label: string; items: ActivityItem[] }[] = [];
  let currentDay = "";
  for (const item of items) {
    const day = getDayLabel(item.createdAt, t);
    if (day !== currentDay) { currentDay = day; grouped.push({ label: day, items: [] }); }
    grouped[grouped.length - 1].items.push(item);
  }

  return (
    <div>
      <PageHeader
        title={t("activity_feed")}
        subtitle={`${total} ${t("records")}`}
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
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
      ) : items.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">{t("no_activity")}</div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="sticky top-0 z-10 bg-gray-50 px-3 py-2 rounded-lg mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{group.label}</h3>
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.id} className="bg-white rounded-lg border border-gray-100 px-4 py-3 hover:border-gray-200 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base flex-shrink-0 mt-0.5">
                        {ENTITY_ICONS[item.entityType] || "📝"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-900">{item.user.fullName}</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${ACTION_COLORS[item.action] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {ACTION_ICONS[item.action] || "•"} {item.action}
                          </span>
                          <span className="text-sm text-gray-700 font-medium">{item.entityLabel}</span>
                          {item.city && <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{item.city.name}</span>}
                        </div>
                        {item.entityDetail && <p className="text-sm text-gray-500 mt-0.5 truncate">{item.entityDetail}</p>}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <span className="text-xs text-gray-400" title={formatFullDate(item.createdAt)}>{timeAgo(item.createdAt, t)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">{t("page")} {page} {t("of")} {totalPages}</p>
              <div className="flex gap-2">
                <button onClick={() => load(page - 1)} disabled={page <= 1} className="btn-secondary text-xs px-3 py-1">{t("previous")}</button>
                <button onClick={() => load(page + 1)} disabled={page >= totalPages} className="btn-secondary text-xs px-3 py-1">{t("next")}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
