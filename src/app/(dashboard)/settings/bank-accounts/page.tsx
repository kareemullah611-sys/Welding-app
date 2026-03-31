"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function BankAccountsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const isSA = user?.role === "super_admin";

  const [accounts, setAccounts] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ bankName: "", accountNumber: "", cityId: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/bank-accounts");
    if (r.success) setAccounts(r.data as any[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isSA) {
      apiCall("/api/v1/cities", { params: { all: "true" } }).then(r => {
        if (r.success) setCities(r.data as any[]);
      });
    }
  }, [isSA]);

  const openCreate = () => {
    setForm({ bankName: "", accountNumber: "", cityId: cities[0]?.id?.toString() || "" });
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.bankName.trim()) { setError("Bank name is required"); return; }
    if (isSA && !form.cityId) { setError("City is required"); return; }
    setSubmitting(true);
    const body: any = { bankName: form.bankName, accountNumber: form.accountNumber };
    if (isSA) body.cityId = form.cityId;
    const r = await apiCall("/api/v1/bank-accounts", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (acc: any) => {
    setSelected(acc);
    setForm({ bankName: acc.bankName, accountNumber: acc.accountNumber || "", cityId: acc.cityId?.toString() || "" });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    if (!form.bankName.trim()) { setError("Bank name is required"); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/bank-accounts/${selected.id}`, { method: "PATCH", body: { bankName: form.bankName, accountNumber: form.accountNumber } });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const toggleActive = async (acc: any) => {
    if (!confirm(`${acc.isActive ? "Deactivate" : "Reactivate"} "${acc.bankName}"?`)) return;
    await apiCall(`/api/v1/bank-accounts/${acc.id}`, { method: "PATCH", body: { isActive: !acc.isActive } });
    load();
  };

  const columns: any[] = [
    ...(isSA ? [{
      key: "cityName", label: "City",
      render: (acc: any) => <span className="text-sm text-gray-600 font-medium">{acc.cityName}</span>,
    }] : []),
    {
      key: "bankName", label: t("bank_name"),
      render: (acc: any) => (
        <div>
          <span className="font-medium">{acc.bankName}</span>
          {!acc.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
        </div>
      ),
    },
    {
      key: "accountNumber", label: t("account_number"),
      render: (acc: any) => acc.accountNumber
        ? <span className="font-mono text-sm text-gray-600">{acc.accountNumber}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: "stats", label: "Usage",
      render: (acc: any) => (
        <div className="text-xs text-gray-500 space-y-0.5">
          {acc._count?.deposits > 0 && <div>📥 {acc._count.deposits} deposit{acc._count.deposits !== 1 ? "s" : ""}</div>}
          {acc._count?.hajiTransfers > 0 && <div>↗️ {acc._count.hajiTransfers} haji transfer{acc._count.hajiTransfers !== 1 ? "s" : ""}</div>}
          {acc._count?.expenses > 0 && <div>💸 {acc._count.expenses} expense{acc._count.expenses !== 1 ? "s" : ""}</div>}
          {!acc._count?.deposits && !acc._count?.hajiTransfers && !acc._count?.expenses && <span className="text-gray-300">No transactions yet</span>}
        </div>
      ),
    },
    {
      key: "status", label: t("status"),
      render: (acc: any) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${acc.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {acc.isActive ? t("active") : t("inactive")}
        </span>
      ),
    },
    {
      key: "actions", label: "",
      render: (acc: any) => (
        <div className="flex gap-2">
          <button onClick={() => openEdit(acc)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
          <button onClick={() => toggleActive(acc)} className={`text-xs hover:underline ${acc.isActive ? "text-gray-500" : "text-green-600"}`}>
            {acc.isActive ? t("deactivate") : t("reactivate")}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("bank_accounts")}
        subtitle={isSA ? "All cities' bank accounts" : "Manage bank accounts for your city"}
        action={<button onClick={openCreate} className="btn-primary text-sm">+ {t("new_bank_account")}</button>}
      />

      <DataTable columns={columns} data={accounts} loading={loading} />

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_bank_account")} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isSA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
              <select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} className="select-field">
                <option value="">Select city…</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("bank_name")} *</label>
            <input
              value={form.bankName}
              onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
              className="input-field"
              placeholder="e.g. HBL, MCB, UBL"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("account_number")} <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              value={form.accountNumber}
              onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
              className="input-field font-mono"
              placeholder="e.g. 1234-5678901234"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit — ${selected?.bankName}`} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isSA && selected && (
            <div className="text-sm text-gray-500 bg-gray-50 rounded px-3 py-2">
              City: <strong className="text-gray-700">{selected.cityName}</strong>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("bank_name")} *</label>
            <input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("account_number")} <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} className="input-field font-mono" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
