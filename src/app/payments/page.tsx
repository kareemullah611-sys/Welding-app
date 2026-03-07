"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatusBadge, formatCurrency, formatNumber } from "@/components/ui";
import CustomerSearch from "@/components/CustomerSearch";
import { useLang } from "@/lib/lang";

async function openAttachment(filePath: string) {
  try {
    const res = await fetch(filePath);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } catch {
    window.open(filePath, "_blank");
  }
}

async function uploadFile(file: File, entityType: string, entityId: number) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("entityType", entityType);
  fd.append("entityId", String(entityId));
  await fetch("/api/v1/upload", { method: "POST", body: fd });
}

function AttachCell({ item, entityType, uploadingFor, setUploadingFor, reload }: { item: any; entityType: string; uploadingFor: number | null; setUploadingFor: (v: number | null) => void; reload: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      {(item.attachments || []).map((a: any) => (
        <button key={a.id} onClick={() => openAttachment(a.filePath)} className="text-xs text-primary-600 hover:underline truncate max-w-[90px] text-left">
          {a.fileType === "pdf" ? "📄" : "🖼️"} {a.fileName}
        </button>
      ))}
      <label className="text-xs text-gray-400 hover:text-primary-600 cursor-pointer">
        {uploadingFor === item.id ? "..." : "+ Attach"}
        <input type="file" accept="image/*,.pdf" className="hidden" onChange={async e => {
          const f = e.target.files?.[0];
          if (!f) return;
          setUploadingFor(item.id);
          await uploadFile(f, entityType, item.id);
          setUploadingFor(null);
          reload();
          e.target.value = "";
        }} />
      </label>
    </div>
  );
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const { t } = useLang();

  const TABS = [
    { key: "payments", label: t("tab_payments") },
    { key: "expenses", label: t("tab_expenses") },
    { key: "haji", label: t("tab_haji") },
    { key: "withdrawals", label: t("tab_withdrawals") },
  ];

  const [tab, setTab] = useState("payments");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [hardDeleteSubmitting, setHardDeleteSubmitting] = useState(false);
  // Voucher duplicate warning
  const [voucherWarning, setVoucherWarning] = useState<{ matches: any[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const endpoint = tab === "payments" ? "/api/v1/payments" : tab === "expenses" ? "/api/v1/expenses" : tab === "haji" ? "/api/v1/haji-transfers" : "/api/v1/personal-withdrawals";
    const r = await apiCall(endpoint, { params: { page, limit: 20 } });
    if (r.success) { setItems(r.data as any[]); setTotalPages((r.pagination as any)?.totalPages || 1); setTotal((r.pagination as any)?.total || 0); }
    setLoading(false);
  }, [tab, page]);
  useEffect(() => { setPage(1); }, [tab]);
  useEffect(() => { load(); }, [load]);

  const loadHelpers = async () => {
    const [cR, lR, ciR] = await Promise.all([
      Promise.resolve({ success: true, data: [] }), // customers loaded on-demand via CustomerSearch
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/cities"),
    ]);
    if (cR.success) setCustomers(cR.data as any[]);
    if (lR.success) setLots(lR.data as any[]);
    let loadedCurrencies: any[] = [];
    if (ciR.success && user?.cityId) {
      const city = (ciR.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { loadedCurrencies = city.currencies; setCurrencies(city.currencies); }
    }
    return loadedCurrencies;
  };

  const openCreate = async () => {
    const loadedCurrencies = await loadHelpers();
    if (tab === "payments") {
      const usdCurrency = loadedCurrencies.find((c: any) => c.code === "USD") || loadedCurrencies[0];
      setForm({ customerId: 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", currencyId: usdCurrency?.id || 0, paymentMethod: "cash", destination: "haji", notes: "", exchangeRate: 280, usdEquivalent: null });
    }
    else if (tab === "expenses") setForm({ expenseDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", notes: "" });
    else if (tab === "haji") setForm({ transferDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", transferType: "from_in_hand", notes: "" });
    else setForm({ withdrawalDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", notes: "" });
    setPendingFile(null);
    setShowCreate(true); setError("");
  };

  const handleCreate = async (forceVoucher = false) => {
    setSubmitting(true); setError("");
    let endpoint = "", body: any = {};
    if (tab === "payments") {
      if (!form.customerId || !form.amount || !form.detail) { setError(t("customer") + ", " + t("amount") + ", " + t("detail") + " required"); setSubmitting(false); return; }
      // Check for duplicate voucher before submitting
      if (!forceVoucher && form.manualVoucherNo?.trim()) {
        const check = await apiCall(`/api/v1/payments/check-voucher?voucher_no=${encodeURIComponent(form.manualVoucherNo.trim())}`);
        if (check.success && (check.data as any).isDuplicate) {
          setVoucherWarning({ matches: (check.data as any).matches });
          setSubmitting(false);
          return;
        }
      }
      endpoint = "/api/v1/payments";
      body = { ...form, currencyId: form.currencyId || currencies[0]?.id };
    } else if (tab === "expenses") {
      if (!form.amount || !form.detail) { setError(t("amount") + " " + t("and") + " " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/expenses";
      body = { ...form, currencyId: currencies[0]?.id };
    } else if (tab === "haji") {
      if (!form.amount || !form.detail) { setError(t("amount") + " " + t("and") + " " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/haji-transfers";
      body = { ...form, currencyId: currencies[0]?.id };
    } else {
      if (!form.amount || !form.detail) { setError(t("amount") + " " + t("and") + " " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/personal-withdrawals";
      body = { ...form, currencyId: currencies[0]?.id };
    }
    const r = await apiCall(endpoint, { method: "POST", body });
    if (r.success) {
      const entityType = tab === "payments" ? "payment" : tab === "expenses" ? "expense" : "haji_transfer";
      if (pendingFile && r.data?.id && tab !== "withdrawals") await uploadFile(pendingFile, entityType, r.data.id);
      setShowCreate(false); load();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  const openEdit = (item: any) => {
    setSelected(item);
    if (tab === "payments") setForm({ amount: item.amount, detail: item.detail, notes: item.notes || "" });
    else if (tab === "expenses") setForm({ amount: item.amount, detail: item.detail, notes: item.notes || "" });
    else if (tab === "haji") setForm({ amount: item.amount, detail: item.detail, transferType: item.transferType, notes: item.notes || "" });
    else setForm({ amount: item.amount, detail: item.detail, notes: item.notes || "" });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const endpoint = tab === "payments" ? `/api/v1/payments/${selected.id}` : tab === "expenses" ? `/api/v1/expenses/${selected.id}` : tab === "haji" ? `/api/v1/haji-transfers/${selected.id}` : `/api/v1/personal-withdrawals/${selected.id}`;
    const r = await apiCall(endpoint, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openHardDelete = (item: any) => { setHardDeleteTarget(item); setHardDeletePassword(""); setHardDeleteError(""); setShowHardDelete(true); };
  const handleHardDelete = async () => {
    if (!hardDeletePassword.trim()) { setHardDeleteError(t("password_required")); return; }
    if (tab !== "payments") { setHardDeleteError("Permanent delete is only available for payments"); return; }
    setHardDeleteSubmitting(true);
    const result = await apiCall(`/api/v1/payments/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setHardDeleteSubmitting(false);
    if (result.success) { setShowHardDelete(false); load(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  const handleDelete = async (item: any) => {
    const label = tab === "payments" ? t("payment") : tab === "expenses" ? t("expense") : tab === "haji" ? t("haji_transfer") : t("withdrawal");
    const reason = window.prompt(`${t("cancel_reason")} (${label}):`);
    if (reason === null) return;
    if (!reason.trim()) { alert(t("reason_required")); return; }
    const endpoint = tab === "payments" ? `/api/v1/payments/${item.id}/cancel` : tab === "expenses" ? `/api/v1/expenses/${item.id}` : tab === "haji" ? `/api/v1/haji-transfers/${item.id}` : `/api/v1/personal-withdrawals/${item.id}`;
    const method = tab === "payments" ? "PUT" : "DELETE";
    const body = tab === "payments" ? { reason: reason.trim() } : undefined;
    await apiCall(endpoint, { method, body });
    load();
  };

  const getColumns = () => {
    if (tab === "payments") return [
      { key: "paymentDate", label: t("date") },
      { key: "customer", label: t("customer"), render: (p: any) => p.customer?.name },
      { key: "detail", label: t("detail"), render: (p: any) => (
        <div>
          <span>{p.detail}</span>
          {p.manualVoucherNo && <p className="text-xs text-gray-400 mt-0.5">#{p.manualVoucherNo}</p>}
        </div>
      )},
      { key: "amount", label: t("amount"), render: (p: any) => (
        <div>
          <span className="font-medium text-green-700">{p.currency?.symbol} {p.amount?.toLocaleString()}</span>
          {p.currency?.code === "AFN" && p.usdEquivalent && (
            <p className="text-xs text-gray-500 mt-0.5">≈ ${Number(p.usdEquivalent).toLocaleString()} @ {p.exchangeRate}</p>
          )}
        </div>
      )},
      { key: "paymentMethod", label: t("method") },
      { key: "destination", label: t("destination"), render: (p: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${p.destination === "haji" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700"}`}>{p.destination === "haji" ? t("haji_label") : t("our_account")}</span> },
      { key: "status", label: t("status"), render: (p: any) => (
          <div>
            <StatusBadge status={p.status} />
            {p.status === "cancelled" && p.cancellationReason && (
              <p className="text-xs text-gray-500 mt-0.5 max-w-[160px] truncate" title={p.cancellationReason}>
                {p.cancellationReason}
              </p>
            )}
          </div>
        )},
      { key: "attachment", label: "📎", render: (p: any) => <AttachCell item={p} entityType="payment" uploadingFor={uploadingFor} setUploadingFor={setUploadingFor} reload={load} /> },
      { key: "actions", label: "", render: (p: any) => <div className="flex gap-2">{p.status === "active" && <><button onClick={() => openEdit(p)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button><button onClick={() => handleDelete(p)} className="text-xs text-red-600 hover:underline">{t("cancel")}</button></>}{user?.role === "super_admin" && <button onClick={() => openHardDelete(p)} className="text-xs text-red-800 font-semibold hover:underline">{t("hard_delete")}</button>}</div> },
    ];
    if (tab === "expenses") return [
      { key: "expenseDate", label: t("date") },
      { key: "detail", label: t("detail") },
      { key: "amount", label: t("amount"), render: (e: any) => <span className="font-medium text-red-600">{e.currency?.symbol} {e.amount?.toLocaleString()}</span> },
      { key: "lotNumber", label: t("lot"), render: (e: any) => e.lot?.lotNumber || e.lotNumber || "-" },
      { key: "attachment", label: "📎", render: (e: any) => <AttachCell item={e} entityType="expense" uploadingFor={uploadingFor} setUploadingFor={setUploadingFor} reload={load} /> },
      { key: "actions", label: "", render: (e: any) => <div className="flex gap-2"><button onClick={() => openEdit(e)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button><button onClick={() => handleDelete(e)} className="text-xs text-red-600 hover:underline">{t("delete")}</button></div> },
    ];
    if (tab === "haji") return [
      { key: "transferDate", label: t("date") },
      { key: "detail", label: t("detail"), render: (h: any) => <div><span>{h.detail}</span>{h.transferredTo && <p className="text-xs text-blue-600 mt-0.5">→ {h.transferredTo}</p>}</div> },
      { key: "amount", label: t("amount"), render: (h: any) => <span className="font-medium text-orange-600">{h.currency?.symbol} {h.amount?.toLocaleString()}</span> },
      { key: "transferType", label: t("type"), render: (h: any) => <span className="text-xs">{h.transferType === "direct" ? t("direct_transfer") : t("from_in_hand")}</span> },
      { key: "lotNumber", label: t("lot"), render: (h: any) => h.lot?.lotNumber || h.lotNumber || "-" },
      { key: "attachment", label: "📎", render: (h: any) => <AttachCell item={h} entityType="haji_transfer" uploadingFor={uploadingFor} setUploadingFor={setUploadingFor} reload={load} /> },
      { key: "actions", label: "", render: (h: any) => <div className="flex gap-2"><button onClick={() => openEdit(h)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button><button onClick={() => handleDelete(h)} className="text-xs text-red-600 hover:underline">{t("delete")}</button></div> },
    ];
    return [ // withdrawals
      { key: "withdrawalDate", label: t("date") },
      { key: "detail", label: t("detail") },
      { key: "amount", label: t("amount"), render: (w: any) => <span className="font-medium text-purple-600">{w.currency?.symbol} {w.amount?.toLocaleString()}</span> },
      { key: "actions", label: "", render: (w: any) => <div className="flex gap-2"><button onClick={() => openEdit(w)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>{user?.role === "super_admin" && <button onClick={() => handleDelete(w)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>}</div> },
    ];
  };

  const btnLabel = tab === "payments" ? t("add_payment") : tab === "expenses" ? t("add_expense") : tab === "haji" ? t("add_haji_transfer") : t("add_withdrawal");
  const createTitle = tab === "payments" ? t("new_payment_title") : tab === "expenses" ? t("new_expense_title") : tab === "haji" ? t("new_haji_title") : t("new_withdrawal_title");

  return (
    <div>
      <PageHeader title={t("payments")} subtitle={`${total} ${t("records").toLowerCase()}`} action={<button onClick={openCreate} className="btn-primary text-sm">{btnLabel}</button>} />
      <div className="flex flex-wrap gap-1 mb-4 bg-gray-100 p-1 rounded-lg">
        {TABS.map(tab_item => <button key={tab_item.key} onClick={() => setTab(tab_item.key)} className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${tab === tab_item.key ? "bg-white shadow text-primary-700" : "text-gray-500 hover:text-gray-700"}`}>{tab_item.label}</button>)}
      </div>
      <DataTable columns={getColumns()} data={items} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={createTitle} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {tab === "payments" && <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("customer")} *</label><CustomerSearch value={form.customerId || 0} onChange={(id) => setForm((f: any) => ({ ...f, customerId: id }))} placeholder={t("search_customer")} /></div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label><input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          {tab === "payments" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Voucher No <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                value={form.manualVoucherNo || ""}
                onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))}
                className="input-field"
                placeholder="e.g. CHQ-1234, TRF-001"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><input type="date" value={form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || ""} onChange={e => { const d = e.target.value; setForm((f: any) => ({ ...f, paymentDate: d, expenseDate: d, transferDate: d, withdrawalDate: d })); }} className="input-field" /></div>
            {tab === "payments" ? (
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
            ) : (
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            )}
          </div>
          {tab === "payments" && (() => {
            const selectedCur = currencies.find((c: any) => c.id === form.currencyId);
            const isAfn = selectedCur?.code === "AFN";
            const usdEq = isAfn && form.amount > 0 && form.exchangeRate > 0 ? (form.amount / form.exchangeRate).toFixed(2) : null;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} ({selectedCur?.code || "—"}) *</label>
                    <input type="number" value={form.amount || ""} onChange={e => {
                      const amt = parseFloat(e.target.value) || 0;
                      const eq = isAfn && form.exchangeRate > 0 ? amt / form.exchangeRate : null;
                      setForm((f: any) => ({ ...f, amount: amt, usdEquivalent: eq }));
                    }} className="input-field" />
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
                    {t("usd_equivalent_label")}: <span className="font-bold">${usdEq}</span> &nbsp;
                    <span className="text-blue-500">(AFN {form.amount?.toLocaleString()} ÷ {form.exchangeRate})</span>
                  </div>
                )}
              </div>
            );
          })()}
          {tab === "payments" && <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("method")}</label><select value={form.paymentMethod} onChange={e => setForm((f: any) => ({ ...f, paymentMethod: e.target.value }))} className="select-field"><option value="cash">{t("cash")}</option><option value="bank_transfer">{t("bank_transfer")}</option><option value="cheque">{t("cheque")}</option><option value="online">{t("online")}</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("destination")}</label><select value={form.destination} onChange={e => setForm((f: any) => ({ ...f, destination: e.target.value }))} className="select-field"><option value="haji">{t("haji_label")}</option><option value="our_account">{t("our_account")}</option></select></div>
          </div>}
          {tab === "haji" && <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label><select value={form.transferType} onChange={e => setForm((f: any) => ({ ...f, transferType: e.target.value }))} className="select-field"><option value="from_in_hand">{t("from_in_hand")}</option><option value="direct">{t("direct_transfer")}</option></select></div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
          {tab !== "withdrawals" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Attach File <span className="text-gray-400 font-normal">(photo or PDF, optional)</span></label>
              <input type="file" accept="image/*,.pdf" onChange={e => setPendingFile(e.target.files?.[0] || null)} className="text-sm text-gray-600" />
              {pendingFile && <p className="text-xs text-green-600 mt-1">📎 {pendingFile.name}</p>}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      {/* EDIT */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          {tab === "haji" && <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label><select value={form.transferType || "from_in_hand"} onChange={e => setForm((f: any) => ({ ...f, transferType: e.target.value }))} className="select-field"><option value="from_in_hand">{t("from_in_hand")}</option><option value="direct">{t("direct_transfer")}</option></select></div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      {/* VOUCHER DUPLICATE WARNING */}
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
                    <p className="text-gray-400 text-xs mt-0.5">{m.paymentDate} · {m.paymentMethod}</p>
                  </div>
                  <span className="font-bold text-green-700">{m.currencySymbol} {m.amount.toLocaleString()}</span>
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

      {/* HARD DELETE 2FA MODAL */}
      <Modal open={showHardDelete} onClose={() => setShowHardDelete(false)} title={`⚠️ ${t("permanently_delete")}`} size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">{t("cannot_undo")}</p>
            <p>{t("permanent_delete_warning")}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("enter_password_confirm")}</label>
            <input
              type="password"
              value={hardDeletePassword}
              onChange={e => setHardDeletePassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleHardDelete()}
              className="input-field"
              placeholder={t("admin_password_placeholder")}
              autoFocus
            />
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
    </div>
  );
}
