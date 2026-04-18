"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";

const CHEQUE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  in_hand:           { label: "In Hand",           icon: "🤲", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  deposited_to_bank: { label: "Deposited to Bank", icon: "🏦", color: "bg-blue-50 text-blue-700 border-blue-200" },
  sent_to_haji:      { label: "Sent to Haji",      icon: "↗️", color: "bg-green-50 text-green-700 border-green-200" },
  used_for_expense:  { label: "Used for Expense",  icon: "🧾", color: "bg-orange-50 text-orange-700 border-orange-200" },
  used_for_withdrawal:{ label: "Used for Withdrawal", icon: "👤", color: "bg-purple-50 text-purple-700 border-purple-200" },
  bounced:           { label: "Bounced",            icon: "⚠️", color: "bg-red-50 text-red-700 border-red-200" },
};

const TABS = ["all", "in_hand", "deposited_to_bank", "sent_to_haji", "used_for_expense", "used_for_withdrawal", "bounced"] as const;
type Tab = typeof TABS[number];

export default function ChequesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [allCheques, setAllCheques] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const PAGE_SIZE = 50;

  // Bounce modal
  const [showBounce, setShowBounce] = useState(false);
  const [bounceTarget, setBounceTarget] = useState<any>(null);
  const [bounceSubmitting, setBounceSubmitting] = useState(false);
  const [bounceError, setBounceError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { type: "payment", page, limit: PAGE_SIZE };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/finance/combined", { params });
    if (r.success) {
      // Filter for cheque payments only
      const cheques = (r.data as any[]).filter(
        (item: any) => item.type === "payment" && item.raw?.paymentMethod === "cheque"
      );
      setAllCheques(cheques);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
    }
    setLoading(false);
  }, [page, searchQuery]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery]);

  const filtered = tab === "all"
    ? allCheques
    : allCheques.filter((c: any) => c.raw?.chequeStatus === tab);

  const handleBounce = async () => {
    if (!bounceTarget) return;
    setBounceSubmitting(true); setBounceError("");
    const r = await apiCall(`/api/v1/payments/${bounceTarget.id}`, { method: "PATCH", body: { action: "bounce_cheque" } });
    setBounceSubmitting(false);
    if (r.success) { setShowBounce(false); setBounceTarget(null); load(); }
    else { setBounceError(r.error || "Failed"); }
  };

  const tabCounts = TABS.reduce((acc, t) => {
    acc[t] = t === "all" ? allCheques.length : allCheques.filter(c => c.raw?.chequeStatus === t).length;
    return acc;
  }, {} as Record<Tab, number>);

  const tabLabels: Record<Tab, string> = {
    all: "All",
    in_hand: "🤲 In Hand",
    deposited_to_bank: "🏦 Deposited",
    sent_to_haji: "↗️ Sent to Haji",
    used_for_expense: "🧾 Used for Expense",
    used_for_withdrawal: "👤 Used for Withdrawal",
    bounced: "⚠️ Bounced",
  };

  const columns = [
    {
      key: "date", label: t("date"),
      render: (item: any) => <span className="whitespace-nowrap text-sm">{item.date}</span>,
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
      key: "chequeBank", label: t("drawn_on_bank"),
      render: (item: any) => item.raw?.chequeBank
        ? <span className="text-sm text-gray-600">{item.raw.chequeBank}</span>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: "dueDate", label: t("due_date"),
      render: (item: any) => item.raw?.chequeDueDate
        ? <span className="text-sm whitespace-nowrap">{formatDate(item.raw.chequeDueDate)}</span>
        : <span className="text-gray-400">—</span>,
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
      <PageHeader
        title={t("cheque_register")}
        subtitle="All cheques received from customers"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS.map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              tab === tabKey
                ? "bg-primary-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tabLabels[tabKey]}
            {tabCounts[tabKey] > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === tabKey ? "bg-white/20 text-white" : "bg-gray-200 text-gray-700"}`}>
                {tabCounts[tabKey]}
              </span>
            )}
          </button>
        ))}
      </div>

      <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        searchPlaceholder="Search cheques (min 2 chars)"
        columns={columns}
        data={filtered}
        loading={loading}
        emptyMessage={tab === "all" ? "No cheques recorded yet" : `No ${tabLabels[tab].replace(/^[^\s]+ /, "")} cheques`}
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
