"use client";
import React, { useEffect, useState, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function SuppliersPage() {
  const { t } = useLang();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [form, setForm] = useState({ name: "", country: "", contact: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => { setLoading(true); const r = await apiCall("/api/v1/suppliers", { params: { limit: 100 } }); if (r.success) setSuppliers(r.data as any[]); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) { setError(t("name") + " required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/suppliers", { method: "POST", body: form });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openLedger = async (s: any) => {
    setSelected(s); setShowLedger(true); setLedgerData(null);
    const r = await apiCall(`/api/v1/suppliers/${s.id}`);
    if (r.success) setLedgerData(r.data);
  };

  return (
    <div>
      <PageHeader title={t("suppliers")} subtitle={t("company_accounts_subtitle")} action={<button onClick={() => { setForm({ name: "", country: "", contact: "", notes: "" }); setShowCreate(true); setError(""); }} className="btn-primary text-sm">+ {t("new_supplier")}</button>} />
      <DataTable columns={[
        { key: "name", label: t("suppliers"), render: (s: any) => <button onClick={() => openLedger(s)} className="font-medium text-primary-600 hover:underline">{s.name}</button> },
        { key: "country", label: t("country"), render: (s: any) => s.country || "-" },
        { key: "totalPurchases", label: t("purchases") },
        { key: "totalPayments", label: t("payments") },
      ]} data={suppliers} loading={loading} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_supplier")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("country")}</label><input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("contact")}</label><input value={form.contact} onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("supplier")}: ${selected?.name || ""}`} size="lg">
        {!ledgerData ? <div className="py-8 text-center text-gray-400">{t("loading")}</div> : <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatsCard title={t("total_purchased")} value={`$${formatNumber(ledgerData.totalPurchasedUsd)}`} icon="📦" color="blue" />
            <StatsCard title={t("total_paid")} value={`$${formatNumber(ledgerData.totalPaidUsd)}`} icon="💰" color="green" />
            <StatsCard title={t("balance_owed")} value={`$${formatNumber(ledgerData.balanceOwed)}`} icon={ledgerData.balanceOwed > 0 ? "⚠️" : "✅"} color={ledgerData.balanceOwed > 0 ? "red" : "green"} />
          </div>
          <h4 className="text-sm font-semibold text-gray-500 mb-2">{t("ledger")}</h4>
          <DataTable columns={[
            { key: "date", label: t("date") },
            { key: "type", label: t("type"), render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "purchase" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{e.type}</span> },
            { key: "description", label: t("description") },
            { key: "debit", label: t("debit_usd"), render: (e: any) => e.debit ? <span className="text-red-600">${e.debit.toLocaleString()}</span> : "" },
            { key: "credit", label: t("credit_usd"), render: (e: any) => e.credit ? <span className="text-green-600">${e.credit.toLocaleString()}</span> : "" },
            { key: "balance", label: t("balance"), render: (e: any) => <span className="font-medium">${e.balance.toLocaleString()}</span> },
          ]} data={ledgerData.ledger || []} loading={false} />
        </>}
      </Modal>
    </div>
  );
}
