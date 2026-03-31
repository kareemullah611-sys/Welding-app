"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function SuppliersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [form, setForm] = useState({ name: "", country: "", contact: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [showPayment,    setShowPayment]    = useState(false);
  const [bankAccounts,   setBankAccounts]   = useState<any[]>([]);
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [payForm,        setPayForm]        = useState({
    paymentDate: new Date().toISOString().split("T")[0],
    amountUsd: "",
    exchangeRate: "",
    amountLocal: "",
    paymentMethod: "bank_transfer",
    paidVia: "bank",         // "bank" | "intermediary"
    bankAccountId: 0,
    intermediaryId: 0,
    lotId: "",
    reference: "",
    notes: "",
  });
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError,      setPayError]      = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/suppliers", { params: { limit: 100 } });
    if (r.success) setSuppliers(r.data as any[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) { setError(t("name") + " required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/suppliers", { method: "POST", body: form });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (s: any) => {
    setSelected(s);
    setForm({ name: s.name || "", country: s.country || "", contact: s.contact || "", notes: s.notes || "" });
    setError("");
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!form.name.trim()) { setError(t("name") + " required"); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/suppliers/${selected.id}`, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openDelete = (s: any) => {
    setSelected(s);
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    const r = await apiCall(`/api/v1/suppliers/${selected.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.success) { setShowDeleteConfirm(false); setSelected(null); load(); }
    else { alert(r.error || "Failed to delete"); }
  };

  const openLedger = async (s: any) => {
    setSelected(s); setShowLedger(true); setLedgerData(null);
    const r = await apiCall(`/api/v1/suppliers/${s.id}`);
    if (r.success) setLedgerData(r.data);
  };

  const openPayment = async () => {
    const [br, ir] = await Promise.all([
      bankAccounts.length ? Promise.resolve({ success: true, data: bankAccounts }) : apiCall("/api/v1/bank-accounts"),
      intermediaries.length ? Promise.resolve({ success: true, data: intermediaries }) : apiCall("/api/v1/intermediaries"),
    ]);
    if (br.success) setBankAccounts(br.data as any[]);
    if (ir.success) setIntermediaries(ir.data as any[]);
    setPayForm({
      paymentDate: new Date().toISOString().split("T")[0],
      amountUsd: "", exchangeRate: "", amountLocal: "",
      paymentMethod: "bank_transfer", paidVia: "bank",
      bankAccountId: 0, intermediaryId: 0,
      lotId: "", reference: "", notes: "",
    });
    setPayError(""); setShowPayment(true);
  };

  const handleRecordPayment = async () => {
    if (!selected) return;
    if (!payForm.amountUsd || Number(payForm.amountUsd) <= 0) { setPayError("Amount is required"); return; }
    if (!payForm.paymentDate) { setPayError("Date is required"); return; }
    setPaySubmitting(true);
    const body: any = {
      supplierId:    selected.id,
      paymentDate:   payForm.paymentDate,
      amountUsd:     Number(payForm.amountUsd),
      paymentMethod: payForm.paymentMethod,
      reference:     payForm.reference || undefined,
      notes:         payForm.notes || undefined,
    };
    if (Number(payForm.exchangeRate) > 0) body.exchangeRate = Number(payForm.exchangeRate);
    if (Number(payForm.amountLocal) > 0) body.amountLocal = Number(payForm.amountLocal);
    if (payForm.paidVia === "bank" && payForm.bankAccountId > 0) body.bankAccountId = payForm.bankAccountId;
    if (payForm.paidVia === "intermediary" && payForm.intermediaryId > 0) body.intermediaryId = payForm.intermediaryId;
    if (Number(payForm.lotId) > 0) body.lotId = Number(payForm.lotId);
    const r = await apiCall("/api/v1/supplier-payments", { method: "POST", body });
    setPaySubmitting(false);
    if (r.success) {
      setShowPayment(false);
      // Refresh ledger
      const lr = await apiCall(`/api/v1/suppliers/${selected.id}`);
      if (lr.success) setLedgerData(lr.data);
      load();
    } else { setPayError(r.error || "Failed"); }
  };

  const isSuperAdmin = user?.role === "super_admin";

  return (
    <div>
      <PageHeader
        title={t("suppliers")}
        subtitle={t("company_accounts_subtitle")}
        action={
          <button
            onClick={() => { setForm({ name: "", country: "", contact: "", notes: "" }); setShowCreate(true); setError(""); }}
            className="btn-primary text-sm"
          >
            + {t("new_supplier")}
          </button>
        }
      />
      <DataTable
        columns={[
          {
            key: "name", label: t("suppliers"),
            render: (s: any) => (
              <button onClick={() => openLedger(s)} className="font-medium text-primary-600 hover:underline">
                {s.name}
              </button>
            ),
          },
          { key: "country", label: t("country"), render: (s: any) => s.country || "-" },
          { key: "totalPurchases", label: t("purchases") },
          { key: "totalPayments", label: t("payments") },
          ...(isSuperAdmin ? [{
            key: "actions", label: "",
            render: (s: any) => (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => openEdit(s)}
                  className="text-xs text-primary-600 hover:underline font-medium"
                >
                  {t("edit")}
                </button>
                <button
                  onClick={() => openDelete(s)}
                  className="text-xs text-red-500 hover:underline font-medium"
                >
                  {t("delete")}
                </button>
              </div>
            ),
          }] : []),
        ]}
        data={suppliers}
        loading={loading}
      />

      {/* ── CREATE MODAL ──────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_supplier")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("country")}</label><input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("contact")}</label><input value={form.contact} onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button>
        </div>
      </Modal>

      {/* ── EDIT MODAL ────────────────────────────────────────────── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit Supplier: ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("country")}</label><input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("contact")}</label><input value={form.contact} onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* ── DELETE CONFIRM MODAL ──────────────────────────────────── */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Supplier" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">Are you sure you want to delete this supplier?</p>
            <p>
              <span className="font-medium">{selected?.name}</span> will be removed. This action cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary text-sm">{t("cancel")}</button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {deleting ? "Deleting..." : "Delete Supplier"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── LEDGER MODAL ──────────────────────────────────────────── */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("supplier")}: ${selected?.name || ""}`} size="lg">
        {!ledgerData ? <div className="py-8 text-center text-gray-400">{t("loading")}</div> : <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatsCard title={t("total_purchased")} value={`$${formatNumber(ledgerData.totalPurchasedUsd)}`} icon="📦" color="blue" />
            <StatsCard title={t("total_paid")} value={`$${formatNumber(ledgerData.totalPaidUsd)}`} icon="💰" color="green" />
            <StatsCard title={t("balance_owed")} value={`$${formatNumber(ledgerData.balanceOwed)}`} icon={ledgerData.balanceOwed > 0 ? "⚠️" : "✅"} color={ledgerData.balanceOwed > 0 ? "red" : "green"} />
          </div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-500">{t("ledger")}</h4>
            {isSuperAdmin && (
              <button onClick={openPayment} className="text-xs text-primary-600 hover:underline font-medium">
                + Record Payment
              </button>
            )}
          </div>
          <DataTable columns={[
            { key: "date", label: t("date") },
            { key: "type", label: t("type"), render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "purchase" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{e.type}</span> },
            { key: "description", label: t("description") },
            { key: "debit", label: t("debit_usd"), render: (e: any) => e.debit ? <span className="text-red-600">${e.debit.toLocaleString("en-US")}</span> : "" },
            { key: "credit", label: t("credit_usd"), render: (e: any) => e.credit ? <span className="text-green-600">${e.credit.toLocaleString("en-US")}</span> : "" },
            { key: "balance", label: t("balance"), render: (e: any) => <span className="font-medium">${e.balance.toLocaleString("en-US")}</span> },
          ]} data={ledgerData.ledger || []} loading={false} />
        </>}
      </Modal>
      {/* ── RECORD PAYMENT MODAL ──────────────────────────────── */}
      <Modal open={showPayment} onClose={() => setShowPayment(false)} title={`Record Payment — ${selected?.name || ""}`} size="md">
        {payError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{payError}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" value={payForm.paymentDate}
                onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (USD) *</label>
              <input type="number" value={payForm.amountUsd}
                onChange={e => setPayForm(f => ({ ...f, amountUsd: e.target.value }))}
                className="input-field" placeholder="0.00" min="0.01" step="0.01" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paid Via</label>
            <div className="flex gap-2 mb-2">
              {["bank", "intermediary"].map(v => (
                <button key={v} type="button"
                  onClick={() => setPayForm(f => ({ ...f, paidVia: v, bankAccountId: 0, intermediaryId: 0 }))}
                  className={`px-3 py-1 rounded text-sm border ${payForm.paidVia === v ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300"}`}>
                  {v === "bank" ? "Bank Account" : "Intermediary (Hawala)"}
                </button>
              ))}
            </div>
            {payForm.paidVia === "bank" && (
              <select value={payForm.bankAccountId}
                onChange={e => setPayForm(f => ({ ...f, bankAccountId: Number(e.target.value) }))}
                className="select-field">
                <option value={0}>— Unspecified / Cash —</option>
                {bankAccounts.filter((b: any) => b.isActive).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""} — {b.cityName}</option>
                ))}
              </select>
            )}
            {payForm.paidVia === "intermediary" && (
              <select value={payForm.intermediaryId}
                onChange={e => setPayForm(f => ({ ...f, intermediaryId: Number(e.target.value) }))}
                className="select-field">
                <option value={0}>— Select intermediary —</option>
                {intermediaries.map((i: any) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method *</label>
              <select value={payForm.paymentMethod}
                onChange={e => setPayForm(f => ({ ...f, paymentMethod: e.target.value }))}
                className="select-field">
                <option value="bank_transfer">Bank Transfer</option>
                <option value="tt">TT (Telegraphic Transfer)</option>
                <option value="lc">LC (Letter of Credit)</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reference / TT No.</label>
              <input value={payForm.reference}
                onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                className="input-field" placeholder="e.g. TT-2026-001" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">USD/PKR Rate <span className="text-gray-400 font-normal">(optional)</span></label>
              <input type="number" value={payForm.exchangeRate}
                onChange={e => setPayForm(f => ({ ...f, exchangeRate: e.target.value }))}
                className="input-field" placeholder="e.g. 278.50" step="0.01" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) <span className="text-gray-400 font-normal">(auto)</span></label>
              <input type="number" value={
                Number(payForm.exchangeRate) > 0 && Number(payForm.amountUsd) > 0
                  ? Math.round(Number(payForm.amountUsd) * Number(payForm.exchangeRate))
                  : payForm.amountLocal
              }
                onChange={e => setPayForm(f => ({ ...f, amountLocal: e.target.value }))}
                className="input-field" placeholder="auto-calculated" step="1" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={payForm.notes}
              onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
              className="input-field" rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowPayment(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleRecordPayment} disabled={paySubmitting} className="btn-primary text-sm">
            {paySubmitting ? "Recording..." : "Record Payment"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
