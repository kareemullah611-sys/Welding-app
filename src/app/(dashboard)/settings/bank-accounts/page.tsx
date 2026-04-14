"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatDate, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

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
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [ledgerBalanceByCurrency, setLedgerBalanceByCurrency] = useState<Record<string, number>>({});
  const [ledgerAccount, setLedgerAccount] = useState<any>(null);

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
    if (!openActionId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-action-menu-root='true']")) return;
      setOpenActionId(null);
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [openActionId]);

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

  const openLedger = async (acc: any) => {
    setLedgerAccount(acc);
    setLedgerLoading(true);
    setShowLedger(true);
    const r = await apiCall(`/api/v1/bank-accounts/${acc.id}`, { params: { view: "ledger" } });
    if (r.success) {
      const payload: any = r.data || {};
      setLedgerRows(payload.ledger || []);
      setLedgerBalanceByCurrency(payload.balanceByCurrency || {});
    } else {
      setLedgerRows([]);
      setLedgerBalanceByCurrency({});
      setError(r.error || "Failed to load ledger");
    }
    setLedgerLoading(false);
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
        <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-action-menu-root="true">
          <button
            type="button"
            onPointerDown={(event) => { event.stopPropagation(); }}
            onClick={(event) => {
              event.stopPropagation();
              setActionMenuDirection("down");
              setOpenActionId((current) => current === acc.id ? null : acc.id);
            }}
            className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
          >
            ⋯
          </button>
          {openActionId === acc.id && (
            <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
              <button onClick={() => { setOpenActionId(null); openLedger(acc); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">Ledger</button>
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

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Ledger — ${ledgerAccount?.bankName || ""}`} size="xl">
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e8dccd] bg-[#fbf6ef]/80 p-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {Object.keys(ledgerBalanceByCurrency || {}).length > 0 ? (
                Object.entries(ledgerBalanceByCurrency).map(([code, amount]) => (
                  <span key={code} className="rounded-lg border border-[#e5d7c4] bg-white px-2.5 py-1 font-medium text-[#3c2d20]">
                    {code} {formatNumber(Number(amount || 0))}
                  </span>
                ))
              ) : (
                <span className="text-gray-500">No balance</span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f8f1e7]">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Type</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Detail</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ref</th>
                    <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ccy</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Credit</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Debit</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Running</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading && (
                    <tr><td colSpan={8} className="py-10 text-center text-gray-500">Loading ledger…</td></tr>
                  )}
                  {!ledgerLoading && ledgerRows.length === 0 && (
                    <tr><td colSpan={8} className="py-10 text-center text-gray-400">No ledger entries</td></tr>
                  )}
                  {!ledgerLoading && ledgerRows.map((row: any) => (
                    <tr key={row.key} className="border-t border-[#f3e8db]">
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-600">{formatDate(row.date)}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-gray-700">{row.type}</td>
                      <td className="px-3 py-2.5 text-sm text-gray-800">{row.detail}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{row.reference || "—"}</td>
                      <td className="px-2 py-2.5 text-center"><span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{row.currencyCode}</span></td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-emerald-700 tabular-nums">{row.credit > 0 ? formatNumber(row.credit) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-rose-700 tabular-nums">{row.debit > 0 ? formatNumber(row.debit) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-800 tabular-nums">{formatNumber(row.runningBalance || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
