"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function SuppliersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const router = useRouter();
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
    setSelected(s);
    setShowLedger(true);
    setLedgerData(null);
    const r = await apiCall(`/api/v1/suppliers/${s.id}`);
    if (r.success) setLedgerData(r.data);
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

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("supplier")}: ${selected?.name || ""}`} size="lg">
        {!ledgerData ? <div className="py-8 text-center text-gray-400">{t("loading")}</div> : <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatsCard title={t("total_purchased")} value={`$${formatNumber(ledgerData.totalPurchasedUsd)}`} icon="📦" color="blue" />
            <StatsCard title={t("total_paid")} value={`$${formatNumber(ledgerData.totalPaidUsd)}`} icon="💰" color="green" />
            <StatsCard title={t("balance_owed")} value={`$${formatNumber(ledgerData.balanceOwed)}`} icon={ledgerData.balanceOwed > 0 ? "⚠️" : "✅"} color={ledgerData.balanceOwed > 0 ? "red" : "green"} />
          </div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-500">{t("ledger")}</h4>
            {isSuperAdmin && selected && (
              <button
                onClick={() => router.push(`/supplier-payments?supplier_id=${selected.id}&create=1`)}
                className="text-xs text-primary-600 hover:underline font-medium"
              >
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
    </div>
  );
}
