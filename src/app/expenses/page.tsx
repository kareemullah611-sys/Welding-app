"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, StatsCard, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function ExpensesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [cashPosition, setCashPosition] = useState<any>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [form, setForm] = useState({ expenseDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", notes: "", lotId: 0, currencyId: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [result, cashRes] = await Promise.all([apiCall("/api/v1/expenses", { params: { page, limit: 20 } }), apiCall("/api/v1/cash-position")]);
    if (result.success) { setExpenses(result.data as any[]); setTotalPages((result.pagination as any)?.totalPages || 1); setTotal((result.pagination as any)?.total || 0); }
    if (cashRes.success) setCashPosition(cashRes.data);
    setLoading(false);
  }, [page]);
  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    const [lotRes, cityRes] = await Promise.all([apiCall("/api/v1/lots", { params: { limit: 100, status: "ongoing" } }), apiCall("/api/v1/cities")]);
    if (lotRes.success) setLots(lotRes.data as any[]);
    if (cityRes.success && user?.cityId) { const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId); if (city?.currencies?.length) { setCurrencies(city.currencies); setForm((f) => ({ ...f, currencyId: city.currencies[0].id })); } }
    setForm((f) => ({ ...f, expenseDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", notes: "", lotId: 0 }));
    setShowCreate(true); setFormError("");
  };

  const handleCreate = async () => {
    if (!form.amount || !form.detail) { setFormError(t("amount") + " " + t("and") + " " + t("detail") + " required"); return; }
    setSubmitting(true);
    const result = await apiCall("/api/v1/expenses", { method: "POST", body: { ...form, lotId: form.lotId || null } });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const openEdit = (e: any) => { setSelected(e); setForm({ expenseDate: e.expenseDate, amount: e.amount, detail: e.detail, notes: e.notes || "", lotId: 0, currencyId: 0 }); setShowEdit(true); setFormError(""); };
  const handleEdit = async () => {
    setSubmitting(true);
    const result = await apiCall(`/api/v1/expenses/${selected.id}`, { method: "PUT", body: { amount: form.amount, detail: form.detail, notes: form.notes } });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };
  const handleDelete = async (e: any) => {
    if (!confirm(`${t("confirm_delete")} "${e.detail}"?`)) return;
    await apiCall(`/api/v1/expenses/${e.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <PageHeader title={t("expenses")} subtitle={`${total} ${t("records").toLowerCase()}`}
        action={user?.role === "city_admin" ? <button onClick={openCreate} className="btn-primary text-sm">+ {t("record_expense")}</button> : undefined} />
      {cashPosition && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          💰 {t("cash_in_hand")}: <strong>{formatNumber(cashPosition.netCashInHand)}</strong> — {t("expenses_cash_note")}
        </div>
      )}
      <DataTable columns={[
        { key: "expenseDate", label: t("date"), render: (e: any) => formatDate(e.expenseDate) },
        { key: "detail", label: t("detail"), className: "max-w-xs" },
        { key: "amount", label: t("amount"), render: (e: any) => <span className="font-medium text-red-600">{e.currency?.symbol} {e.amount.toLocaleString("en-US")}</span> },
        { key: "lot", label: t("lot"), render: (e: any) => e.lot?.lotNumber || e.lotNumber },
        { key: "notes", label: t("notes"), render: (e: any) => e.notes || "-", className: "max-w-xs truncate" },
        { key: "source", label: t("deducted_from"), render: () => <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">{t("cash_in_hand")}</span> },
        { key: "actions", label: "", render: (e: any) => (
          <div className="flex gap-2">
            <button onClick={() => openEdit(e)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
            <button onClick={() => handleDelete(e)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>
          </div>
        )},
      ]} data={expenses} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("record_expense")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><input type="date" value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label><input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label><select value={form.lotId} onChange={(e) => setForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("auto_fifo")}</option>{lots.map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">💸 {t("deducted_from_cash_note")}</div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record_expense")}</button></div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_expense")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </div>
  );
}
