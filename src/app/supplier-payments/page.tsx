"use client";
import React, { useEffect, useState, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function SupplierPaymentsPage() {
  const { t } = useLang();

  const METHODS = [
    { value: "bank_transfer", label: t("bank_transfer") },
    { value: "tt", label: t("tt_payment") },
    { value: "lc", label: t("lc_payment") },
    { value: "cash", label: t("cash") },
    { value: "other", label: t("other") },
  ];

  const [payments, setPayments] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [form, setForm] = useState({ supplierId: 0, lotId: 0, paymentDate: new Date().toISOString().split("T")[0], amountUsd: 0, exchangeRate: 0, amountLocal: 0, paymentMethod: "bank_transfer", reference: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [payR, suppR, lotR] = await Promise.all([
      apiCall("/api/v1/supplier-payments", { params: { page, limit: 20 } }),
      apiCall("/api/v1/suppliers", { params: { limit: 100 } }),
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
    ]);
    if (payR.success) { setPayments(payR.data as any[]); setTotalPages((payR.pagination as any)?.totalPages || 1); setTotal((payR.pagination as any)?.total || 0); }
    if (suppR.success) setSuppliers(suppR.data as any[]);
    if (lotR.success) setLots(lotR.data as any[]);

    if (suppR.success && (suppR.data as any[]).length) {
      const r = await apiCall(`/api/v1/suppliers/${(suppR.data as any[])[0].id}`);
      if (r.success) setSummary(r.data);
    }
    setLoading(false);
  }, [page]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ supplierId: suppliers[0]?.id || 0, lotId: 0, paymentDate: new Date().toISOString().split("T")[0], amountUsd: 0, exchangeRate: 0, amountLocal: 0, paymentMethod: "bank_transfer", reference: "", notes: "" });
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.supplierId || !form.amountUsd) { setError(t("supplier") + " " + t("and") + " " + t("amount") + " required"); return; }
    setSubmitting(true);
    const body: any = { ...form };
    if (!body.lotId) delete body.lotId;
    if (!body.exchangeRate) delete body.exchangeRate;
    if (!body.amountLocal) delete body.amountLocal;
    const r = await apiCall("/api/v1/supplier-payments", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (p: any) => {
    setSelected(p);
    setForm({ supplierId: p.supplierId, lotId: p.lotId || 0, paymentDate: p.paymentDate, amountUsd: p.amountUsd, exchangeRate: p.exchangeRate || 0, amountLocal: p.amountLocal || 0, paymentMethod: p.paymentMethod, reference: p.reference || "", notes: p.notes || "" });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const r = await apiCall(`/api/v1/supplier-payments/${selected.id}`, { method: "PUT", body: { amountUsd: form.amountUsd, exchangeRate: form.exchangeRate || null, amountLocal: form.amountLocal || null, reference: form.reference, notes: form.notes } });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleDelete = async (p: any) => {
    if (!confirm(`${t("confirm_delete_payment")} $${p.amountUsd}`)) return;
    await apiCall(`/api/v1/supplier-payments/${p.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <PageHeader title={t("company_payments")} subtitle={t("payments_to_supplier_subtitle")} action={<button onClick={openCreate} className="btn-primary text-sm">+ {t("record_payment")}</button>} />

      {summary && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatsCard title={t("total_purchased")} value={`$${formatNumber(summary.totalPurchasedUsd)}`} icon="📦" color="blue" />
          <StatsCard title={t("total_paid")} value={`$${formatNumber(summary.totalPaidUsd)}`} icon="💰" color="green" />
          <StatsCard title={t("balance_owed")} value={`$${formatNumber(summary.balanceOwed)}`} icon={summary.balanceOwed > 0 ? "⚠️" : "✅"} color={summary.balanceOwed > 0 ? "red" : "green"} />
        </div>
      )}

      <DataTable columns={[
        { key: "paymentDate", label: t("date"), render: (p: any) => formatDate(p.paymentDate) },
        { key: "supplierName", label: t("suppliers") },
        { key: "lotNumber", label: t("lot"), render: (p: any) => p.lotNumber || <span className="text-gray-400">{t("general_not_linked")}</span> },
        { key: "amountUsd", label: t("amount_usd"), render: (p: any) => <span className="font-bold text-green-700">${p.amountUsd.toLocaleString("en-US")}</span> },
        { key: "exchangeRate", label: t("fx_rate"), render: (p: any) => p.exchangeRate || "-" },
        { key: "amountLocal", label: t("local_amount"), render: (p: any) => p.amountLocal ? p.amountLocal.toLocaleString("en-US") : "-" },
        { key: "paymentMethod", label: t("method"), render: (p: any) => METHODS.find(m => m.value === p.paymentMethod)?.label || p.paymentMethod },
        { key: "reference", label: t("reference"), render: (p: any) => p.reference || "-" },
        { key: "actions", label: "", render: (p: any) => (
          <div className="flex gap-2">
            <button onClick={() => openEdit(p)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
            <button onClick={() => handleDelete(p)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>
          </div>
        )},
      ]} data={payments} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      {/* Create modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("record_payment_to_company")} size="lg">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("supplier")} *</label><select value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select")}</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("lot_optional")}</label><select value={form.lotId} onChange={e => setForm(f => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("general_not_linked")}</option>{lots.map(l => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount_usd")} *</label><input type="number" step="0.01" value={form.amountUsd || ""} onChange={e => setForm(f => ({ ...f, amountUsd: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("method")} *</label><select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="select-field">{METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("exchange_rate")}</label><input type="number" step="0.01" value={form.exchangeRate || ""} onChange={e => setForm(f => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" placeholder="USD → Local" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("local_amount")}</label><input type="number" step="0.01" value={form.amountLocal || ""} onChange={e => setForm(f => ({ ...f, amountLocal: parseFloat(e.target.value) || 0 }))} className="input-field" placeholder="Auto or manual" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("reference")}</label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input-field" placeholder="TT/Bank ref" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button></div>
      </Modal>

      {/* Edit modal */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_payment")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount_usd")}</label><input type="number" step="0.01" value={form.amountUsd || ""} onChange={e => setForm(f => ({ ...f, amountUsd: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("exchange_rate")}</label><input type="number" step="0.01" value={form.exchangeRate || ""} onChange={e => setForm(f => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("reference")}</label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </div>
  );
}
