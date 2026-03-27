"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatusBadge, formatDate } from "@/components/ui";
import CustomerSearch from "@/components/CustomerSearch";
import { useLang } from "@/lib/lang";
import { ChevronDown } from "lucide-react";

async function uploadFile(file: File, entityType: string, entityId: number) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("entityType", entityType);
  fd.append("entityId", String(entityId));
  await fetch("/api/v1/upload", { method: "POST", body: fd });
}

function AttachCell({ item, entityType, uploadingFor, setUploadingFor, reload, onView }: {
  item: any; entityType: string; uploadingFor: number | null;
  setUploadingFor: (v: number | null) => void; reload: () => void; onView: (a: any) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {(item.attachments || []).map((a: any) => (
        <button key={a.id} onClick={() => onView(a)} className="text-xs text-primary-600 hover:underline truncate max-w-[90px] text-left">
          {a.fileType === "pdf" ? "📄" : "🖼️"} {a.fileName}
        </button>
      ))}
      <label className="text-xs text-gray-400 hover:text-primary-600 cursor-pointer">
        {uploadingFor === item.id ? "..." : "+ Attach"}
        <input type="file" accept="image/*,.pdf" className="hidden" onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          setUploadingFor(item.id);
          await uploadFile(f, entityType, item.id);
          setUploadingFor(null); reload(); e.target.value = "";
        }} />
      </label>
    </div>
  );
}

const TYPE_CONFIG: Record<string, { label: string; color: string; amountColor: string }> = {
  payment:      { label: "Payment",    color: "bg-blue-50 text-blue-700",   amountColor: "text-green-700" },
  expense:      { label: "Expense",    color: "bg-red-50 text-red-700",     amountColor: "text-red-600" },
  haji_transfer:{ label: "Haji",       color: "bg-orange-50 text-orange-700", amountColor: "text-orange-600" },
  withdrawal:   { label: "Withdrawal", color: "bg-purple-50 text-purple-700", amountColor: "text-purple-600" },
};

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] || { label: type, color: "bg-gray-50 text-gray-700" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cfg.color}`}>{cfg.label}</span>;
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, enqueue, lastSyncResult } = useOffline();
  const recordMenuRef = useRef<HTMLDivElement>(null);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Type filter for the list
  const [typeFilter, setTypeFilter] = useState("all");
  // Which type is being created/edited
  const [createType, setCreateType] = useState("payment");

  // Modal visibility
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showRecordMenu, setShowRecordMenu] = useState(false);

  const [selected, setSelected] = useState<any>(null);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);

  // Hard delete
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [hardDeleteSubmitting, setHardDeleteSubmitting] = useState(false);

  // Bounce cheque
  const [showBounce, setShowBounce] = useState(false);
  const [bounceTarget, setBounceTarget] = useState<any>(null);
  const [bounceSubmitting, setBounceSubmitting] = useState(false);

  // Voucher duplicate warning
  const [voucherWarning, setVoucherWarning] = useState<{ matches: any[] } | null>(null);

  // Attachment viewer
  const [viewingAttachment, setViewingAttachment] = useState<any | null>(null);

  // ── Batch payment queue ──────────────────────────────────────────────────
  const [paymentQueue, setPaymentQueue] = useState<Array<{ tempId: string; customerName: string; voucherNo: string; amount: number; currencySymbol: string; detail: string; date: string; body: any }>>([]);
  const [savingQueue, setSavingQueue] = useState(false);
  const [queueSaved, setQueueSaved] = useState(false);

  // Close record menu when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (recordMenuRef.current && !recordMenuRef.current.contains(e.target as Node)) {
        setShowRecordMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    if (typeFilter !== "all") params.type = typeFilter;
    const r = await apiCall("/api/v1/finance/combined", { params });
    if (r.success) {
      setItems(r.data as any[]);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
    }
    setLoading(false);
  }, [typeFilter, page]);

  useEffect(() => { setPage(1); }, [typeFilter]);
  useEffect(() => { load(); }, [load]);

  // Reload from server after queued entries sync
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.synced > 0) load();
  }, [lastSyncResult, load]);

  const loadHelpers = async () => {
    const [lR, ciR] = await Promise.all([
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/cities"),
    ]);
    if (lR.success) setLots(lR.data as any[]);
    let loadedCurrencies: any[] = [];
    if (ciR.success && user?.cityId) {
      const city = (ciR.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { loadedCurrencies = city.currencies; setCurrencies(city.currencies); }
    }
    return loadedCurrencies;
  };

  const openCreate = async (type: string) => {
    setCreateType(type);
    setShowRecordMenu(false);
    const loadedCurrencies = await loadHelpers();
    const today = new Date().toISOString().split("T")[0];
    if (type === "payment") {
      const usdCurrency = loadedCurrencies.find((c: any) => c.code === "USD") || loadedCurrencies[0];
      setForm({ customerId: 0, customerName: "", paymentDate: today, amount: 0, detail: "", currencyId: usdCurrency?.id || 0, paymentMethod: "cash", destination: "haji", notes: "", exchangeRate: 280, usdEquivalent: null, chequeNumber: "", chequeBank: "", chequeDueDate: "" });
    } else if (type === "expense") {
      setForm({ expenseDate: today, amount: 0, detail: "", notes: "" });
    } else if (type === "haji_transfer") {
      setForm({ transferDate: today, amount: 0, detail: "", transferType: "from_in_hand", notes: "" });
    } else {
      setForm({ withdrawalDate: today, amount: 0, detail: "", notes: "" });
    }
    setPendingFile(null);
    setPaymentQueue([]);
    setQueueSaved(false);
    setShowCreate(true); setError("");
  };

  const handleCreate = async (forceVoucher = false) => {
    setSubmitting(true); setError("");
    let endpoint = "", body: any = {};
    if (createType === "payment") {
      if (!form.customerId || !(form.amount > 0) || !form.detail) { setError(t("customer") + ", " + t("amount") + " (must be > 0), " + t("detail") + " required"); setSubmitting(false); return; }
      if (!forceVoucher && form.manualVoucherNo?.trim()) {
        const check = await apiCall(`/api/v1/payments/check-voucher?voucher_no=${encodeURIComponent(form.manualVoucherNo.trim())}`);
        if (check.success && (check.data as any).isDuplicate) {
          setVoucherWarning({ matches: (check.data as any).matches });
          setSubmitting(false); return;
        }
      }
      endpoint = "/api/v1/payments";
      body = { ...form, currencyId: form.currencyId || currencies[0]?.id };
    } else if (createType === "expense") {
      if (!(form.amount > 0) || !form.detail) { setError(t("amount") + " (must be > 0) and " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/expenses";
      body = { ...form, currencyId: currencies[0]?.id };
    } else if (createType === "haji_transfer") {
      if (!(form.amount > 0) || !form.detail) { setError(t("amount") + " (must be > 0) and " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/haji-transfers";
      body = { ...form, currencyId: currencies[0]?.id };
    } else {
      if (!(form.amount > 0) || !form.detail) { setError(t("amount") + " (must be > 0) and " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/personal-withdrawals";
      body = { ...form, currencyId: currencies[0]?.id };
    }
    // ── Offline: queue and optimistically add to list ──
    if (!isOnline) {
      await enqueue({
        url: endpoint,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/payments",
      });
      setItems((prev) => [{
        id: `pending-${Date.now()}`,
        type: createType,
        paymentDate: (body as any).paymentDate || new Date().toISOString().split("T")[0],
        amount: (body as any).amount || 0,
        detail: (body as any).detail || "",
        status: "active",
        _pending: true,
      }, ...prev]);
      setShowCreate(false);
      setSubmitting(false);
      return;
    }

    // ── Online: normal submit ──
    const r = await apiCall(endpoint, { method: "POST", body });
    if (r.success) {
      const entityType = createType === "payment" ? "payment" : createType === "expense" ? "expense" : "haji_transfer";
      if (pendingFile && (r.data as any)?.id && createType !== "withdrawal") {
        await uploadFile(pendingFile, entityType, (r.data as any).id);
      }
      setShowCreate(false);
      if (page !== 1) setPage(1);
      if (typeFilter !== "all") setTypeFilter("all");
      load();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  // ── Add current form to batch queue (payment only) ──────────────────────
  const addToQueue = async () => {
    setError("");
    if (!form.customerId || !(form.amount > 0) || !form.detail) {
      setError(t("customer") + ", amount (must be > 0), detail required");
      return;
    }
    // Voucher duplicate check
    if (form.manualVoucherNo?.trim()) {
      const check = await apiCall(`/api/v1/payments/check-voucher?voucher_no=${encodeURIComponent(form.manualVoucherNo.trim())}`);
      if (check.success && (check.data as any).isDuplicate) {
        setVoucherWarning({ matches: (check.data as any).matches });
        return;
      }
    }
    const selectedCur = currencies.find((c: any) => c.id === form.currencyId);
    const body = { ...form, currencyId: form.currencyId || currencies[0]?.id };
    setPaymentQueue(prev => [...prev, {
      tempId: `q-${Date.now()}-${Math.random()}`,
      customerName: form.customerName || "Customer",
      voucherNo: form.manualVoucherNo?.trim() || "",
      amount: form.amount,
      currencySymbol: selectedCur?.symbol ?? "",
      detail: form.detail,
      date: form.paymentDate,
      body,
    }]);
    // Reset form for next entry, keep modal open
    const today = new Date().toISOString().split("T")[0];
    const usdCurrency = currencies.find((c: any) => c.code === "USD") || currencies[0];
    setForm({ customerId: 0, customerName: "", paymentDate: today, amount: 0, detail: "", currencyId: usdCurrency?.id || 0, paymentMethod: "cash", destination: "haji", notes: "", exchangeRate: 280, usdEquivalent: null, chequeNumber: "", chequeBank: "", chequeDueDate: "" });
    setPendingFile(null);
    setQueueSaved(false);
  };

  // ── Save all queued payments ─────────────────────────────────────────────
  const saveQueue = async () => {
    if (paymentQueue.length === 0) return;
    setSavingQueue(true);
    for (const item of paymentQueue) {
      const r = await apiCall("/api/v1/payments", { method: "POST", body: item.body });
      if (r.success && pendingFile && (r.data as any)?.id) {
        await uploadFile(pendingFile, "payment", (r.data as any).id);
      }
    }
    setSavingQueue(false);
    setPaymentQueue([]);
    setQueueSaved(true);
    setShowCreate(false);
    setTimeout(() => setQueueSaved(false), 3000);
    // Reset to page 1 + all-types so the new payment is visible
    if (page !== 1) setPage(1);
    if (typeFilter !== "all") setTypeFilter("all");
    // Always reload to show the new entry
    load();
  };

  const openEdit = async (item: any) => {
    setCreateType(item.type);
    setSelected(item);
    await loadHelpers();
    const raw = item.raw;
    if (item.type === "payment") {
      setForm({ amount: raw.amount, detail: raw.detail, notes: raw.notes || "" });
    } else if (item.type === "haji_transfer") {
      setForm({ amount: raw.amount, detail: raw.detail, transferType: raw.transferType || "from_in_hand", notes: raw.notes || "" });
    } else {
      setForm({ amount: raw.amount, detail: raw.detail, notes: raw.notes || "" });
    }
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const id = selected.id;
    const endpoint = createType === "payment" ? `/api/v1/payments/${id}` : createType === "expense" ? `/api/v1/expenses/${id}` : createType === "haji_transfer" ? `/api/v1/haji-transfers/${id}` : `/api/v1/personal-withdrawals/${id}`;
    const r = await apiCall(endpoint, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openHardDelete = (item: any) => { setHardDeleteTarget(item); setHardDeletePassword(""); setHardDeleteError(""); setShowHardDelete(true); };
  const handleHardDelete = async () => {
    if (!hardDeletePassword.trim()) { setHardDeleteError(t("password_required")); return; }
    setHardDeleteSubmitting(true);
    const result = await apiCall(`/api/v1/payments/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setHardDeleteSubmitting(false);
    if (result.success) { setShowHardDelete(false); load(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  const handleDelete = async (item: any) => {
    const typeLabel = TYPE_CONFIG[item.type]?.label || item.type;
    const reason = window.prompt(`Cancel / Delete reason (${typeLabel}):`);
    if (reason === null) return;
    if (!reason.trim()) { alert(t("reason_required")); return; }
    const endpoint = item.type === "payment" ? `/api/v1/payments/${item.id}/cancel` : item.type === "expense" ? `/api/v1/expenses/${item.id}` : item.type === "haji_transfer" ? `/api/v1/haji-transfers/${item.id}` : `/api/v1/personal-withdrawals/${item.id}`;
    const method = item.type === "payment" ? "PUT" : "DELETE";
    const body = item.type === "payment" ? { reason: reason.trim() } : undefined;
    await apiCall(endpoint, { method, body });
    load();
  };

  const handleApproveWithdrawal = async (item: any) => {
    if (!window.confirm("Approve this withdrawal? This will create a Haji Transfer.")) return;
    await apiCall(`/api/v1/personal-withdrawals/${item.id}/approve`, { method: "POST" });
    load();
  };

  const handleBounce = async () => {
    if (!bounceTarget) return;
    setBounceSubmitting(true);
    const r = await apiCall(`/api/v1/payments/${bounceTarget.id}`, { method: "PATCH", body: { action: "bounce_cheque" } });
    setBounceSubmitting(false);
    if (r.success) { setShowBounce(false); setBounceTarget(null); load(); }
    else { setError(r.error || "Failed to mark cheque as bounced"); }
  };

  const columns = [
    {
      key: "type", label: "Type",
      render: (item: any) => <TypeBadge type={item.type} />,
    },
    {
      key: "date", label: t("date"),
      render: (item: any) => <span className="whitespace-nowrap text-sm">{formatDate(item.date)}</span>,
    },
    {
      key: "detail", label: t("detail"),
      render: (item: any) => (
        <div>
          <span className="text-sm">{item.detail}</span>
          {item.raw?.manualVoucherNo && <p className="text-xs text-gray-400 mt-0.5">#{item.raw.manualVoucherNo}</p>}
          {item.type === "haji_transfer" && item.raw?.lotNumber && <p className="text-xs text-gray-400 mt-0.5">Lot {item.raw.lotNumber}</p>}
          {item.type === "expense" && item.raw?.lotNumber && <p className="text-xs text-gray-400 mt-0.5">Lot {item.raw.lotNumber}</p>}
        </div>
      ),
    },
    {
      key: "person", label: t("customer"),
      render: (item: any) => item.person ? (
        <div>
          <span className="text-sm text-gray-600">{item.person}</span>
          {user?.role === "super_admin" && item.cityName && (
            <p className="text-xs text-indigo-500 mt-0.5">{item.cityName}</p>
          )}
        </div>
      ) : <span className="text-gray-300">—</span>,
    },
    {
      key: "amount", label: t("amount"),
      render: (item: any) => {
        const cfg = TYPE_CONFIG[item.type];
        return (
          <div>
            <span className={`font-semibold text-sm ${cfg?.amountColor || "text-gray-700"}`}>
              {item.currencySymbol} {item.amount?.toLocaleString("en-US")}
            </span>
            {item.type === "payment" && item.raw?.currencyCode === "AFN" && item.raw?.usdEquivalent && (
              <p className="text-xs text-gray-400 mt-0.5">≈ ${Number(item.raw.usdEquivalent).toLocaleString("en-US")}</p>
            )}
            {item.type === "payment" && item.raw?.destination && (
              <p className="text-xs text-gray-400 mt-0.5">→ {item.raw.destination === "haji" ? t("haji_label") : t("our_account")}</p>
            )}
          </div>
        );
      },
    },
    {
      key: "status", label: t("status"),
      render: (item: any) => {
        if (item._pending) return (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700">⏳ Pending Sync</span>
        );
        if (item.type === "payment") {
          const chequeStatusColors: Record<string, string> = {
            in_hand: "bg-yellow-50 text-yellow-700",
            deposited_to_bank: "bg-blue-50 text-blue-700",
            sent_to_haji: "bg-green-50 text-green-700",
            bounced: "bg-red-50 text-red-700",
          };
          const chequeStatusLabels: Record<string, string> = {
            in_hand: t("in_hand_status"),
            deposited_to_bank: t("deposited_to_bank"),
            sent_to_haji: t("sent_to_haji_status"),
            bounced: t("bounced"),
          };
          return (
            <div>
              <StatusBadge status={item.status} />
              {item.status === "cancelled" && item.raw?.cancellationReason && (
                <p className="text-xs text-gray-400 mt-0.5 max-w-[120px] truncate" title={item.raw.cancellationReason}>{item.raw.cancellationReason}</p>
              )}
              {item.raw?.chequeStatus && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${chequeStatusColors[item.raw.chequeStatus] || "bg-gray-50 text-gray-700"}`}>
                  🧾 {chequeStatusLabels[item.raw.chequeStatus] || item.raw.chequeStatus}
                </span>
              )}
            </div>
          );
        }
        if (item.type === "withdrawal") return (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.status === "approved" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
            {item.status}
          </span>
        );
        return <span className="text-gray-300">—</span>;
      },
    },
    {
      key: "attachment", label: "📎",
      render: (item: any) => item.type !== "withdrawal" ? (
        <AttachCell item={item.raw} entityType={item.type === "haji_transfer" ? "haji_transfer" : item.type} uploadingFor={uploadingFor} setUploadingFor={setUploadingFor} reload={load} onView={setViewingAttachment} />
      ) : <span className="text-gray-300">—</span>,
    },
    {
      key: "actions", label: "",
      render: (item: any) => {
        // Pending (offline) rows have no server ID — disable all mutating actions
        if (item._pending) return <span className="text-xs text-gray-400 italic">syncing…</span>;
        return (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openEdit(item)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
          {item.type === "payment" && item.status === "active" && (
            <button onClick={() => handleDelete(item)} className="text-xs text-red-600 hover:underline">{t("cancel")}</button>
          )}
          {item.type !== "payment" && (
            <button onClick={() => handleDelete(item)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>
          )}
          {item.type === "payment" && user?.role === "super_admin" && (
            <button onClick={() => openHardDelete(item)} className="text-xs text-red-800 font-semibold hover:underline">{t("hard_delete")}</button>
          )}
          {item.type === "withdrawal" && item.status === "pending" && user?.role === "super_admin" && (
            <button onClick={() => handleApproveWithdrawal(item)} className="text-xs text-green-700 font-semibold hover:underline">Approve</button>
          )}
          {item.type === "payment" && item.status === "active" && item.raw?.paymentMethod === "cheque" && item.raw?.chequeStatus === "in_hand" && (
            <button onClick={() => { setBounceTarget(item); setShowBounce(true); setError(""); }} className="text-xs text-amber-600 font-semibold hover:underline">{t("mark_bounced")}</button>
          )}
        </div>
        );
      },
    },
  ];

  const RECORD_OPTIONS = [
    { type: "payment",       label: "💰 Customer Payment" },
    { type: "expense",       label: "📋 Expense" },
    { type: "haji_transfer", label: "🤝 Haji Transfer" },
    { type: "withdrawal",    label: "💸 Withdrawal" },
  ];

  const createTitle =
    createType === "payment" ? t("new_payment_title") :
    createType === "expense" ? t("new_expense_title") :
    createType === "haji_transfer" ? t("new_haji_title") :
    t("new_withdrawal_title");

  return (
    <div>
      <PageHeader
        title={t("payments")}
        subtitle={`${total} ${t("records").toLowerCase()}`}
        action={
          <div className="flex items-center gap-3">
            {/* Type filter */}
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="select-field text-sm py-1.5 pr-8"
            >
              <option value="all">All Types</option>
              <option value="payment">Payments</option>
              <option value="expense">Expenses</option>
              <option value="haji_transfer">Haji Transfers</option>
              <option value="withdrawal">Withdrawals</option>
            </select>

            {/* Record ▼ dropdown button */}
            <div className="relative" ref={recordMenuRef}>
              <button
                onClick={() => setShowRecordMenu(v => !v)}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                + Record <ChevronDown size={13} />
              </button>
              {showRecordMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-30 overflow-hidden">
                  {RECORD_OPTIONS.map(opt => (
                    <button
                      key={opt.type}
                      onClick={() => openCreate(opt.type)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        }
      />

      {queueSaved && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          ✓ All payments saved successfully!
        </div>
      )}

      <DataTable
        columns={columns}
        data={items}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />

      {/* ── CREATE MODAL ───────────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={createTitle} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {/* ── DATE — always first ── */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
            <input type="date"
              value={form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || ""}
              onChange={e => {
                const d = e.target.value;
                setForm((f: any) => ({ ...f, paymentDate: d, expenseDate: d, transferDate: d, withdrawalDate: d }));
              }}
              className="input-field"
              autoFocus
            />
          </div>

          {createType === "payment" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("customer")} *</label>
              <CustomerSearch
                value={form.customerId || 0}
                onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
                placeholder={t("search_customer")}
              />
            </div>
          )}

          {createType === "payment" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Voucher No <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.manualVoucherNo || ""} onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))} className="input-field" placeholder="e.g. CHQ-1234"
                onKeyDown={e => e.key === "Enter" && addToQueue()} />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field"
              onKeyDown={e => { if (e.key === "Enter") { if (createType === "payment") addToQueue(); else handleCreate(); } }} />
          </div>

          {createType === "payment" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
              <select value={form.currencyId || 0} onChange={e => {
                const cid = parseInt(e.target.value);
                const cur = currencies.find((c: any) => c.id === cid);
                setForm((f: any) => ({ ...f, currencyId: cid, exchangeRate: cur?.code === "AFN" ? (f.exchangeRate || 280) : null, usdEquivalent: null }));
              }} className="select-field">
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          )}

          {createType !== "payment" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
              <input type="number" min="0.01" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field"
                onKeyDown={e => e.key === "Enter" && handleCreate()} />
            </div>
          )}

          {createType === "payment" && (() => {
            const selectedCur = currencies.find((c: any) => c.id === form.currencyId);
            const isAfn = selectedCur?.code === "AFN";
            const usdEq = isAfn && form.amount > 0 && form.exchangeRate > 0 ? (form.amount / form.exchangeRate).toFixed(2) : null;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} ({selectedCur?.code || "—"}) *</label>
                    <input type="number" min="0.01" value={form.amount || ""} onChange={e => {
                      const amt = parseFloat(e.target.value) || 0;
                      const eq = isAfn && form.exchangeRate > 0 ? amt / form.exchangeRate : null;
                      setForm((f: any) => ({ ...f, amount: amt, usdEquivalent: eq }));
                    }} className="input-field" onKeyDown={e => e.key === "Enter" && addToQueue()} />
                  </div>
                  {isAfn && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("exchange_rate_afn")}</label>
                      <input type="number" value={form.exchangeRate || ""} onChange={e => {
                        const rate = parseFloat(e.target.value) || 0;
                        const eq = rate > 0 && form.amount > 0 ? form.amount / rate : null;
                        setForm((f: any) => ({ ...f, exchangeRate: rate, usdEquivalent: eq }));
                      }} className="input-field" placeholder="e.g. 280" />
                    </div>
                  )}
                </div>
                {isAfn && usdEq && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
                    {t("usd_equivalent_label")}: <span className="font-bold">${usdEq}</span>
                    <span className="text-blue-500 ml-2">(AFN {form.amount?.toLocaleString("en-US")} ÷ {form.exchangeRate})</span>
                  </div>
                )}
              </div>
            );
          })()}

          {createType === "payment" && (
            <div className={user?.countryName === "Afghanistan" ? "" : "grid grid-cols-2 gap-3"}>
              {/* Hide method selector for Afghanistan — always cash */}
              {user?.countryName !== "Afghanistan" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("method")}</label>
                  <select value={form.paymentMethod} onChange={e => setForm((f: any) => ({ ...f, paymentMethod: e.target.value }))} className="select-field">
                    <option value="cash">{t("cash")}</option>
                    <option value="bank_transfer">{t("bank_transfer")}</option>
                    <option value="cheque">{t("cheque")}</option>
                    <option value="online">{t("online")}</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("destination")}</label>
                <select value={form.destination} onChange={e => setForm((f: any) => ({ ...f, destination: e.target.value }))} className="select-field">
                  <option value="haji">{t("haji_label")}</option>
                  <option value="our_account">{t("our_account")}</option>
                </select>
              </div>
            </div>
          )}

          {createType === "payment" && form.paymentMethod === "cheque" && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm font-semibold text-blue-800">
                🧾 {t("cheque_number")} — {t("drawn_on_bank")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("cheque_number")}</label>
                  <input value={form.chequeNumber || ""} onChange={e => setForm((f: any) => ({ ...f, chequeNumber: e.target.value }))} className="input-field" placeholder="e.g. 001234" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("drawn_on_bank")}</label>
                  <input value={form.chequeBank || ""} onChange={e => setForm((f: any) => ({ ...f, chequeBank: e.target.value }))} className="input-field" placeholder="e.g. HBL" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("due_date")}</label>
                <input type="date" value={form.chequeDueDate || ""} onChange={e => setForm((f: any) => ({ ...f, chequeDueDate: e.target.value }))} className="input-field" />
              </div>
            </div>
          )}

          {createType === "haji_transfer" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label>
              <select value={form.transferType} onChange={e => setForm((f: any) => ({ ...f, transferType: e.target.value }))} className="select-field">
                <option value="from_in_hand">{t("from_in_hand")}</option>
                <option value="direct">{t("direct_transfer")}</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

          {createType !== "withdrawal" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attach File <span className="text-gray-400 font-normal">(photo or PDF, optional)</span></label>
              <input type="file" accept="image/*,.pdf" onChange={e => setPendingFile(e.target.files?.[0] || null)} className="text-sm text-gray-600" />
              {pendingFile && <p className="text-xs text-green-600 mt-1">📎 {pendingFile.name}</p>}
            </div>
          )}
        </div>
        {/* ── Batch queue (payment only) ── */}
        {createType === "payment" && paymentQueue.length > 0 && (
          <div className="mt-4 border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Queued ({paymentQueue.length})</p>
            {/* Header row */}
            <div className="grid grid-cols-[70px_1fr_80px_70px_24px] gap-1 px-3 py-1">
              <span className="text-[9px] font-bold text-gray-400 uppercase">Date</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase">Name</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase">Voucher</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase text-right">Amount</span>
              <span />
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {paymentQueue.map((q, i) => (
                <div key={q.tempId} className="grid grid-cols-[70px_1fr_80px_70px_24px] gap-1 items-center bg-blue-50 rounded-lg px-3 py-2">
                  <span className="text-[10px] text-blue-600 font-medium whitespace-nowrap">{q.date}</span>
                  <span className="text-xs font-semibold text-blue-900 truncate">{q.customerName}</span>
                  <span className="text-[10px] text-blue-500 truncate">{q.voucherNo || "—"}</span>
                  <span className="text-xs font-bold text-blue-800 text-right whitespace-nowrap">{q.currencySymbol} {q.amount.toLocaleString("en-US")}</span>
                  <button onClick={() => setPaymentQueue(prev => prev.filter(p => p.tempId !== q.tempId))}
                    className="text-blue-300 hover:text-red-400 transition-colors text-center">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
          <button onClick={() => { setShowCreate(false); setPaymentQueue([]); }} className="btn-secondary text-sm">{t("cancel")}</button>
          {createType === "payment" ? (
            <>
              <button onClick={addToQueue} disabled={submitting}
                className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
                + Add to Queue
              </button>
              {paymentQueue.length > 0 && (
                <button onClick={saveQueue} disabled={savingQueue}
                  className="btn-primary text-sm flex items-center gap-1.5">
                  {savingQueue ? "Saving…" : `✓ Confirm & Save (${paymentQueue.length})`}
                </button>
              )}
            </>
          ) : (
            <button onClick={() => handleCreate()} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
          )}
        </div>
      </Modal>

      {/* ── EDIT MODAL ──────────────────────────────────────────────────────── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          {createType === "haji_transfer" && (
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label><select value={form.transferType || "from_in_hand"} onChange={e => setForm((f: any) => ({ ...f, transferType: e.target.value }))} className="select-field"><option value="from_in_hand">{t("from_in_hand")}</option><option value="direct">{t("direct_transfer")}</option></select></div>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* ── VOUCHER DUPLICATE WARNING ────────────────────────────────────────── */}
      <Modal open={!!voucherWarning} onClose={() => setVoucherWarning(null)} title="⚠️ Duplicate Voucher Number" size="md">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-semibold mb-1">This voucher number already exists in your city.</p>
            <p>Please review the existing record(s) below. Are you sure this is a different payment?</p>
          </div>
          <div className="space-y-2">
            {voucherWarning?.matches.map((m: any) => (
              <div key={m.id} className="border border-gray-200 rounded-lg p-3 text-sm bg-gray-50">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-gray-900">{m.customerName}</p>
                    <p className="text-gray-500">{m.detail}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{formatDate(m.paymentDate)} · {m.paymentMethod}</p>
                  </div>
                  <span className="font-bold text-green-700">{m.currencySymbol} {m.amount?.toLocaleString("en-US")}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setVoucherWarning(null)} className="btn-secondary text-sm">Cancel — go back</button>
            <button onClick={() => { setVoucherWarning(null); handleCreate(true); }} className="btn-danger text-sm">Save Anyway</button>
          </div>
        </div>
      </Modal>

      {/* ── HARD DELETE 2FA ──────────────────────────────────────────────────── */}
      <Modal open={showHardDelete} onClose={() => setShowHardDelete(false)} title={`⚠️ ${t("permanently_delete")}`} size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">{t("cannot_undo")}</p>
            <p>{t("permanent_delete_warning")}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("enter_password_confirm")}</label>
            <input type="password" value={hardDeletePassword} onChange={e => setHardDeletePassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleHardDelete()} className="input-field" placeholder={t("admin_password_placeholder")} autoFocus />
          </div>
          {hardDeleteError && <p className="text-sm text-red-600">{hardDeleteError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setShowHardDelete(false)} className="btn-secondary text-sm">{t("cancel")}</button>
            <button onClick={handleHardDelete} disabled={hardDeleteSubmitting} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {hardDeleteSubmitting ? t("deleting") : t("permanently_delete")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── BOUNCE CHEQUE MODAL ──────────────────────────────────────────────── */}
      <Modal open={showBounce} onClose={() => { setShowBounce(false); setBounceTarget(null); }} title="⚠️ Mark Cheque as Bounced" size="sm">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-semibold mb-1">This will mark the cheque as bounced.</p>
            <p>This action cannot be undone. The cheque status will be updated to "Bounced".</p>
          </div>
          {bounceTarget && (
            <div className="border border-gray-200 rounded-lg p-3 text-sm bg-gray-50">
              <p className="font-medium text-gray-900">{bounceTarget.person || "—"}</p>
              <p className="text-gray-500 mt-0.5">{bounceTarget.detail}</p>
              <p className="font-bold text-red-600 mt-1">{bounceTarget.currencySymbol} {bounceTarget.amount?.toLocaleString("en-US")}</p>
              {bounceTarget.raw?.chequeNumber && <p className="text-gray-400 text-xs mt-0.5">Cheque #{bounceTarget.raw.chequeNumber}</p>}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => { setShowBounce(false); setBounceTarget(null); }} className="btn-secondary text-sm">{t("cancel")}</button>
            <button onClick={handleBounce} disabled={bounceSubmitting} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {bounceSubmitting ? "..." : t("mark_bounced")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── ATTACHMENT VIEWER ────────────────────────────────────────────────── */}
      {viewingAttachment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setViewingAttachment(null)}>
          <div className="relative max-w-3xl w-full max-h-[90vh] mx-4" onClick={e => e.stopPropagation()}>
            <button onClick={() => setViewingAttachment(null)} className="absolute -top-8 right-0 text-white text-2xl font-bold">✕</button>
            {viewingAttachment.fileType === "pdf" ? (
              <iframe src={viewingAttachment.filePath} className="w-full h-[80vh] rounded-lg" />
            ) : (
              <img src={viewingAttachment.filePath} alt={viewingAttachment.fileName} className="w-full max-h-[80vh] object-contain rounded-lg bg-white" />
            )}
            <p className="text-white text-sm text-center mt-2">{viewingAttachment.fileName}</p>
          </div>
        </div>
      )}
    </div>
  );
}
