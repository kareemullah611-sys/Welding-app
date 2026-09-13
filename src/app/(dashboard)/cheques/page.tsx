"use client";
import React, { useEffect, useState, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, formatDate, FilterMenu } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { applyQueuedMutationsToCheques } from "@/lib/offline-remaining-mutations";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const CHEQUES_READ_CACHE_KEY = "mrf-cheques-read-cache-v1";

type GlassVariant = "primary" | "secondary" | "danger" | "warning" | "xlsx" | "pdf";

type ChequesReadSnapshot = {
  allCheques: any[];
  totalPages: number;
  total: number;
  statusCounts?: ChequeStatusCounts;
};

const CHEQUE_STATUS_CONFIG: Record<string, { label: string; shortLabel: string; color: string; icon: string; glassVariant: GlassVariant }> = {
  in_hand:            { label: "In Hand",            shortLabel: "In Hand",            icon: "🤲", color: "bg-yellow-50 text-yellow-700 border-yellow-200", glassVariant: "warning" },
  deposited_to_bank:  { label: "Deposited to Bank",  shortLabel: "Deposited",          icon: "🏦", color: "bg-blue-50 text-blue-700 border-blue-200",       glassVariant: "primary" },
  sent_to_haji:       { label: "Sent to Haji",       shortLabel: "Sent to Haji",       icon: "↗️", color: "bg-green-50 text-green-700 border-green-200",    glassVariant: "xlsx" },
  used_for_expense:   { label: "Used for Expense",   shortLabel: "Used for Expense",   icon: "🧾", color: "bg-orange-50 text-orange-700 border-orange-200", glassVariant: "warning" },
  used_for_liability: { label: "Used for Liability", shortLabel: "Used for Liability", icon: "🤝", color: "bg-orange-50 text-orange-700 border-orange-200", glassVariant: "warning" },
  used_for_withdrawal:{ label: "Used for Withdrawal", shortLabel: "Used for Withdrawal", icon: "👤", color: "bg-purple-50 text-purple-700 border-purple-200", glassVariant: "pdf" },
  bounced:            { label: "Bounced",             shortLabel: "Bounced",            icon: "⚠️", color: "bg-red-50 text-red-700 border-red-200",          glassVariant: "danger" },
};

const ALL_TAB = { shortLabel: "All", glassVariant: "primary" as const };

const filterBtnClass = (active: boolean, variant: GlassVariant) =>
  cn(
    "glass-btn px-3 py-1.5 text-sm",
    active ? `glass-btn-${variant}` : "glass-btn-secondary",
  );

const TABS = ["all", "in_hand", "deposited_to_bank", "sent_to_haji", "used_for_expense", "used_for_liability", "used_for_withdrawal", "bounced"] as const;
type Tab = typeof TABS[number];
type ChequeStatusCounts = Record<Tab, number>;

const EMPTY_STATUS_COUNTS: ChequeStatusCounts = {
  all: 0,
  in_hand: 0,
  deposited_to_bank: 0,
  sent_to_haji: 0,
  used_for_expense: 0,
  used_for_liability: 0,
  used_for_withdrawal: 0,
  bounced: 0,
};

export default function ChequesPage() {
  const { t } = useLang();
  const { isOnline, queuedItems } = useOffline();
  const [allCheques, setAllCheques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<ChequeStatusCounts>(EMPTY_STATUS_COUNTS);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  

  const buildPendingChequeRows = useCallback(() => {
    return (queuedItems || [])
      .filter((q: any) => q.pathname === "/payments" && q.method === "POST" && q.url === "/api/v1/payments")
      .map((q: any) => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(q.body || "{}");
        } catch {
          parsed = {};
        }
        if (String(parsed?.paymentMethod || "") !== "cheque") return null;
        return {
          id: `pending-${q.id}`,
          type: "payment",
          date: parsed?.paymentDate || new Date().toISOString(),
          person: parsed?.customerName || "Pending Customer",
          detail: parsed?.detail || "Pending cheque payment",
          amount: Number(parsed?.amount || 0),
          status: "active",
          raw: {
            paymentMethod: "cheque",
            chequeNumber: parsed?.chequeNumber || "",
            chequeStatus: "in_hand",
            bankName: parsed?.chequeBank || "",
            dueDate: parsed?.chequeDueDate || null,
          },
          _pending: true,
        };
      })
      .filter(Boolean) as any[];
  }, [queuedItems]);

  // Bounce modal
  const [showBounce, setShowBounce] = useState(false);
  const [bounceTarget, setBounceTarget] = useState<any>(null);
  const [bounceSubmitting, setBounceSubmitting] = useState(false);
  const [bounceError, setBounceError] = useState("");

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<ChequesReadSnapshot>(CHEQUES_READ_CACHE_KEY);
  }, []);

  const writeSnapshot = useCallback((data: ChequesReadSnapshot) => {
    writeOfflineReadSnapshot<ChequesReadSnapshot>(CHEQUES_READ_CACHE_KEY, data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { type: "payment", page, limit: DEFAULT_LIST_PAGE_SIZE, payment_method: "cheque" };
    if (tab !== "all") params.cheque_status = tab;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/finance/combined", { params });
    if (r.success) {
      const cheques = (r.data as any[]);
      let nextRows = [...buildPendingChequeRows(), ...cheques];
      nextRows = applyQueuedMutationsToCheques(nextRows, queuedItems as any[]);
      setAllCheques(nextRows);
      const nextTotalPages = (r.pagination as any)?.totalPages || 1;
      const nextTotal = (r.pagination as any)?.total || 0;
      const nextStatusCounts = {
        ...EMPTY_STATUS_COUNTS,
        ...((r.meta as any)?.chequeStatusCounts || {}),
      };
      setTotalPages(nextTotalPages);
      setTotal(nextTotal);
      setStatusCounts(nextStatusCounts);
      writeSnapshot({ allCheques: nextRows, totalPages: nextTotalPages, total: nextTotal, statusCounts: nextStatusCounts });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.allCheques) {
        const pendingRows = buildPendingChequeRows();
        const cleanedSnapshot = (snapshot.allCheques || []).filter((row: any) => {
          if (!row?._pending) return true;
          const id = String(row.id || "");
          if (!id.startsWith("pending-")) return true;
          return pendingRows.some((p) => String(p.id) === id);
        });
        let nextRows = [...pendingRows, ...cleanedSnapshot.filter((row: any) => !row?._pending)];
        nextRows = applyQueuedMutationsToCheques(nextRows, queuedItems as any[]);
        setAllCheques(nextRows);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || snapshot.allCheques.length || 0);
        setStatusCounts(snapshot.statusCounts || { ...EMPTY_STATUS_COUNTS, all: snapshot.total || snapshot.allCheques.length || 0 });
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [buildPendingChequeRows, isOnline, page, queuedItems, readSnapshot, searchQuery, tab, writeSnapshot]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => { setPage(1); }, [tab]);

  const filtered = allCheques;

  const handleBounce = async () => {
    if (!bounceTarget) return;
    if (String(bounceTarget?.id || "").startsWith("pending-")) {
      setBounceError("Pending cheque is not synced yet. Please sync first.");
      return;
    }
    setBounceSubmitting(true); setBounceError("");
    const r = await apiCall(`/api/v1/payments/${bounceTarget.id}`, { method: "PATCH", body: { action: "bounce_cheque" } });
    setBounceSubmitting(false);
    if (r.success) { setShowBounce(false); setBounceTarget(null); load(); }
    else { setBounceError(r.error || "Failed"); }
  };

  const tabCounts = statusCounts;

  const tabLabel = (tabKey: Tab) => {
    if (tabKey === "all") return ALL_TAB.shortLabel;
    const cfg = CHEQUE_STATUS_CONFIG[tabKey];
    return `${cfg.icon} ${cfg.shortLabel}`;
  };

  const tabGlassVariant = (tabKey: Tab): GlassVariant =>
    tabKey === "all" ? ALL_TAB.glassVariant : CHEQUE_STATUS_CONFIG[tabKey].glassVariant;

  const columns = [
    {
      key: "date", label: t("date"),
      render: (item: any) => <span className="whitespace-nowrap text-sm tabular-nums">{formatDate(item.date)}</span>,
    },
    {
      key: "chequeNumber", label: t("cheque_number"),
      render: (item: any) => item.raw?.chequeNumber
        ? <span className="font-mono text-sm font-semibold">#{item.raw.chequeNumber}</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: "person", label: t("customer"),
      render: (item: any) => <span className="text-sm font-medium">{item.person || "—"}</span>,
    },
    {
      key: "amount", label: t("amount"),
      render: (item: any) => (
        <span className="font-semibold text-sm text-green-700">
          {item.currencySymbol} {item.amount?.toLocaleString("en-US")}
        </span>
      ),
    },
    {
      key: "chequeStatus", label: t("status"),
      render: (item: any) => {
        const status = item.raw?.chequeStatus || "in_hand";
        const cfg = CHEQUE_STATUS_CONFIG[status] || CHEQUE_STATUS_CONFIG.in_hand;
        return (
          <span className={`text-xs px-2 py-0.5 rounded border font-medium ${cfg.color}`}>
            {cfg.icon} {cfg.label}
          </span>
        );
      },
    },
    {
      key: "actions", label: "",
      render: (item: any) => {
        if (item?._pending) {
          return <span className="text-xs text-amber-600">Pending sync</span>;
        }
        const status = item.raw?.chequeStatus;
        if (status !== "in_hand" || item.status !== "active") return <span className="text-gray-300">—</span>;
        return (
          <div className="flex gap-2">
            <button
              onClick={() => { setBounceTarget(item); setShowBounce(true); setBounceError(""); }}
              className="text-xs text-amber-600 hover:underline font-medium"
            >
              {t("mark_bounced")}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title={t("cheque_register")} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex justify-end">
      <FilterMenu activeCount={Number(tab !== "all")} onClear={() => setTab("all")}>
      <div className="flex flex-col gap-2">
        {TABS.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={filterBtnClass(tab === tabKey, tabGlassVariant(tabKey))}
          >
            {tabLabel(tabKey)}
            {tabCounts[tabKey] > 0 ? ` (${tabCounts[tabKey]})` : ""}
          </button>
        ))}
      </div>
      </FilterMenu>
      </div>

      <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        columns={columns}
        data={filtered}
        loading={loading}
        emptyMessage={tab === "all" ? "No cheques recorded yet" : `No ${CHEQUE_STATUS_CONFIG[tab]?.shortLabel || tab} cheques`}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />

      {/* Bounce Modal */}
      <Modal open={showBounce} onClose={() => { setShowBounce(false); setBounceTarget(null); }} title="⚠️ Mark Cheque as Bounced" size="sm">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-semibold mb-1">This will mark the cheque as bounced.</p>
            <p>The payment will be cancelled. You can then create a new payment for this customer.</p>
          </div>
          {bounceTarget && (
            <div className="border border-gray-200 rounded-lg p-3 text-sm bg-gray-50">
              <p className="font-medium text-gray-900">{bounceTarget.person || "—"}</p>
              <p className="text-gray-500 mt-0.5">{bounceTarget.detail}</p>
              <p className="font-bold text-red-600 mt-1">
                {bounceTarget.currencySymbol} {bounceTarget.amount?.toLocaleString("en-US")}
              </p>
              {bounceTarget.raw?.chequeNumber && (
                <p className="text-gray-400 text-xs mt-1">Cheque #{bounceTarget.raw.chequeNumber}</p>
              )}
              {bounceTarget.raw?.chequeBank && (
                <p className="text-gray-400 text-xs">Bank: {bounceTarget.raw.chequeBank}</p>
              )}
            </div>
          )}
          {bounceError && <p className="text-sm text-red-600">{bounceError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => { setShowBounce(false); setBounceTarget(null); }} className="btn-secondary text-sm">{t("cancel")}</button>
            <button
              onClick={handleBounce}
              disabled={bounceSubmitting}
              className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {bounceSubmitting ? "..." : t("mark_bounced")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
