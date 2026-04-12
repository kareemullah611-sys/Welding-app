"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { getActionMenuDirection } from "@/lib/action-menu";

export default function BankAccountsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const isSA = user?.role === "super_admin";

  const [accounts, setAccounts] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ bankName: "", accountNumber: "", cityId: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/bank-accounts", {
      params: isSA ? { scope: "super_admin" } : undefined,
    });
    if (r.success) setAccounts(r.data as any[]);
    setLoading(false);
  }, [isSA]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleClick = () => setOpenActionId(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (isSA) {
      apiCall("/api/v1/currencies").then(r => {
        if (r.success) setCurrencies(r.data as any[]);
      });
    }
  }, [isSA]);

  const openCreate = () => {
    setForm({ bankName: "", accountNumber: "", cityId: isSA ? (currencies[0]?.id?.toString() || "") : "" });
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.bankName.trim()) { setError("Bank name is required"); return; }
    setSubmitting(true);
    const body: any = { bankName: form.bankName, accountNumber: form.accountNumber };
    if (isSA) body.currencyId = Number(form.cityId);
    const r = await apiCall("/api/v1/bank-accounts", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (acc: any) => {
    setSelected(acc);
    setForm({ bankName: acc.bankName, accountNumber: acc.accountNumber || "", cityId: isSA ? String(acc.currencyId || "") : (acc.cityId?.toString() || "") });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    if (!form.bankName.trim()) { setError("Bank name is required"); return; }
    setSubmitting(true);
    const body: any = { bankName: form.bankName, accountNumber: form.accountNumber };
    if (isSA) body.currencyId = Number(form.cityId);
    const r = await apiCall(`/api/v1/bank-accounts/${selected.id}`, { method: "PATCH", body });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const toggleActive = async (acc: any) => {
    if (!confirm(`${acc.isActive ? "Deactivate" : "Reactivate"} "${acc.bankName}"?`)) return;
    const body: any = { isActive: !acc.isActive };
    if (isSA) {
      body.bankName = acc.bankName;
      body.accountNumber = acc.accountNumber;
      body.currencyId = acc.currencyId;
    }
    await apiCall(`/api/v1/bank-accounts/${acc.id}`, { method: "PATCH", body });
    load();
  };

  const columns: any[] = [
    ...(isSA ? [{
      key: "currency", label: "Currency",
      render: (acc: any) => <span className="text-sm text-gray-600 font-medium">{acc.currency?.code} {acc.currency?.symbol}</span>,
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
      key: "balance", label: "Running Balance",
      render: (acc: any) => (
        <div className="text-sm font-medium text-gray-700 space-y-0.5">
          {isSA ? (
            <span>{acc.currency?.code} {Number(acc.runningBalance || 0).toLocaleString("en-US")}</span>
          ) : acc.runningBalanceByCurrency && Object.keys(acc.runningBalanceByCurrency).length > 0 ? (
            Object.entries(acc.runningBalanceByCurrency).map(([currencyCode, amount]: [string, any]) => (
              <div key={currencyCode}>{currencyCode} {Number(amount).toLocaleString("en-US")}</div>
            ))
          ) : (
            <span className="text-gray-300">0</span>
          )}
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
        <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onPointerDown={(event) => { event.stopPropagation(); }}
            onClick={(event) => {
              event.stopPropagation();
              setActionMenuDirection(getActionMenuDirection(event.currentTarget as HTMLElement));
              setOpenActionId((current) => current === acc.id ? null : acc.id);
            }}
            className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
          >
            ⋯
          </button>
          {openActionId === acc.id && (
            <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`}>
              <button onClick={() => { setOpenActionId(null); openEdit(acc); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("edit")}</button>
              <button onClick={() => { setOpenActionId(null); toggleActive(acc); }} className={`w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-gray-50 ${acc.isActive ? "text-gray-600" : "text-green-700 hover:bg-green-50"}`}>
                {acc.isActive ? t("deactivate") : t("reactivate")}
              </button>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("bank_accounts")}
        subtitle={isSA ? "Manage super admin bank accounts" : "Manage bank accounts for your city"}
        action={<button onClick={openCreate} className="btn-primary text-sm">+ {t("new_bank_account")}</button>}
      />

      <DataTable columns={columns} data={accounts} loading={loading} />

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_bank_account")} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isSA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency *</label>
              <select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} className="select-field">
                <option value="">Select currency…</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.symbol}</option>)}
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
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit — ${selected?.bankName}`} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isSA && selected && (
            <div className="text-sm text-gray-500 bg-gray-50 rounded px-3 py-2">
              Currency: <strong className="text-gray-700">{selected.currency?.code} {selected.currency?.symbol}</strong>
            </div>
          )}
          {isSA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency *</label>
              <select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} className="select-field">
                <option value="">Select currency…</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.symbol}</option>)}
              </select>
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
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
