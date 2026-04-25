"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, formatDate } from "@/components/ui";
import * as XLSX from "xlsx";

const EMPTY_DEPOSIT = {
  depositDate: new Date().toISOString().split("T")[0],
  amount: "",
  currencyId: "",
  superAdminBankAccountId: "",
  notes: "",
};

const EMPTY_EXCHANGE = {
  exchangeDate: new Date().toISOString().split("T")[0],
  baseCurrencyId: "",
  quoteCurrencyId: "",
  fromCurrencyId: "",
  fromAmount: "",
  toCurrencyId: "",
  exchangeRate: "",
  notes: "",
};

function parseAmountInput(raw: string): number | null {
  const normalized = String(raw || "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function calculateToAmount(
  fromAmount: string,
  exchangeRate: string,
  baseCurrencyId: string,
  quoteCurrencyId: string,
  fromCurrencyId: string,
  toCurrencyId: string,
): { toAmount: number; operation: "multiply" | "divide" | null; isPairValid: boolean } {
  const from = parseAmountInput(fromAmount);
  const rate = parseAmountInput(exchangeRate);
  if (!from || !rate || !baseCurrencyId || !quoteCurrencyId || !fromCurrencyId || !toCurrencyId) {
    return { toAmount: 0, operation: null, isPairValid: true };
  }
  if (fromCurrencyId === baseCurrencyId && toCurrencyId === quoteCurrencyId) {
    return { toAmount: Math.round((from * rate) * 100) / 100, operation: "multiply", isPairValid: true };
  }
  if (fromCurrencyId === quoteCurrencyId && toCurrencyId === baseCurrencyId) {
    return { toAmount: Math.round((from / rate) * 100) / 100, operation: "divide", isPairValid: true };
  }
  return { toAmount: 0, operation: null, isPairValid: false };
}

export default function IntermediariesPage() {
  const { user } = useAuth();
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ ...EMPTY_DEPOSIT });
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositError, setDepositError] = useState("");

  const [showEditDeposit, setShowEditDeposit] = useState(false);
  const [editDepositId, setEditDepositId] = useState<number | null>(null);
  const [editDepositForm, setEditDepositForm] = useState({ ...EMPTY_DEPOSIT });
  const [editDepositSubmitting, setEditDepositSubmitting] = useState(false);
  const [editDepositError, setEditDepositError] = useState("");

  const [exchangeForm, setExchangeForm] = useState({ ...EMPTY_EXCHANGE });
  const [exchangeSubmitting, setExchangeSubmitting] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [showEditExchange, setShowEditExchange] = useState(false);
  const [editExchangeId, setEditExchangeId] = useState<number | null>(null);
  const [editExchangeForm, setEditExchangeForm] = useState({ ...EMPTY_EXCHANGE });
  const [editExchangeSubmitting, setEditExchangeSubmitting] = useState(false);
  const [editExchangeError, setEditExchangeError] = useState("");

  const [currencies, setCurrencies] = useState<any[]>([]);
  const [superAdminBankAccounts, setSuperAdminBankAccounts] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/intermediaries");
    if (r.success) setIntermediaries(r.data as any[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadRefData = async () => {
    const [c, saBanks] = await Promise.all([
      apiCall("/api/v1/currencies"),
      apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }),
    ]);
    if (c.success) {
      const loadedCurrencies = c.data as any[];
      setCurrencies(loadedCurrencies);
      if (loadedCurrencies.length >= 2) {
        setExchangeForm((prev) => ({
          ...prev,
          baseCurrencyId: prev.baseCurrencyId || String(loadedCurrencies[0].id),
          quoteCurrencyId: prev.quoteCurrencyId || String(loadedCurrencies[1].id),
          fromCurrencyId: prev.fromCurrencyId || String(loadedCurrencies[0].id),
          toCurrencyId: prev.toCurrencyId || String(loadedCurrencies[1].id),
        }));
      }
    }
    if (saBanks.success) setSuperAdminBankAccounts(saBanks.data as any[]);
  };

  const openLedger = async (item: any) => {
    setExchangeForm({ ...EMPTY_EXCHANGE });
    setExchangeError("");
    await loadRefData();
    setSelected(item);
    setShowLedger(true);
    setLedgerLoading(true);
    const r = await apiCall(`/api/v1/intermediaries/${item.id}`);
    if (r.success) setLedger(r.data);
    setLedgerLoading(false);
  };

  const openDeposit = async () => {
    await loadRefData();
    setDepositForm({ ...EMPTY_DEPOSIT });
    setDepositError("");
    setShowDeposit(true);
  };

  const handleDeposit = async () => {
    const parsedAmount = parseAmountInput(depositForm.amount);
    if (!parsedAmount) { setDepositError("Enter a valid amount greater than 0"); return; }
    if (!depositForm.currencyId) { setDepositError("Currency is required"); return; }
    if (!depositForm.superAdminBankAccountId) { setDepositError("Super admin bank account is required"); return; }
    setDepositSubmitting(true);
    const body: any = {
      depositDate: depositForm.depositDate,
      amount: parsedAmount,
      currencyId: Number(depositForm.currencyId),
      superAdminBankAccountId: Number(depositForm.superAdminBankAccountId),
      notes: depositForm.notes || null,
    };
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}/deposits`, { method: "POST", body });
    setDepositSubmitting(false);
    if (r.success) { setShowDeposit(false); openLedger(selected); } else { setDepositError(r.error || "Failed"); }
  };

  const openEditDeposit = async (entry: any) => {
    await loadRefData();
    setEditDepositId(entry.id);
    setEditDepositForm({
      depositDate: entry.date?.split("T")[0] || "",
      amount: String(entry.debit),
      currencyId: String(entry.currencyId || ""),
      superAdminBankAccountId: String(entry.superAdminBankAccountId || ""),
      notes: String(entry.notes || ""),
    });
    setEditDepositError("");
    setShowEditDeposit(true);
  };

  const handleEditDeposit = async () => {
    if (!editDepositId) return;
    const parsedAmount = parseAmountInput(editDepositForm.amount);
    if (!parsedAmount) { setEditDepositError("Enter a valid amount greater than 0"); return; }
    if (!editDepositForm.superAdminBankAccountId) { setEditDepositError("Super admin bank account is required"); return; }
    setEditDepositSubmitting(true);
    const body: any = {
      depositDate: editDepositForm.depositDate,
      amount: parsedAmount,
      notes: editDepositForm.notes || null,
    };
    if (editDepositForm.currencyId) body.currencyId = Number(editDepositForm.currencyId);
    if (editDepositForm.superAdminBankAccountId) body.superAdminBankAccountId = Number(editDepositForm.superAdminBankAccountId);
    const r = await apiCall(`/api/v1/intermediary-deposits/${editDepositId}`, { method: "PUT", body });
    setEditDepositSubmitting(false);
    if (r.success) { setShowEditDeposit(false); openLedger(selected); } else { setEditDepositError(r.error || "Failed"); }
  };

  const handleDeleteDeposit = async (id: number) => {
    if (!confirm("Delete this deposit? The journal entry will be reversed.")) return;
    await apiCall(`/api/v1/intermediary-deposits/${id}`, { method: "DELETE" });
    openLedger(selected);
  };

  const handleExchange = async () => {
    if (!selected?.id) return;
    const fromAmount = parseAmountInput(exchangeForm.fromAmount);
    const exchangeRate = parseAmountInput(exchangeForm.exchangeRate);
    if (!exchangeForm.baseCurrencyId || !exchangeForm.quoteCurrencyId) { setExchangeError("Select base and quote currencies for the rate"); return; }
    if (exchangeForm.baseCurrencyId === exchangeForm.quoteCurrencyId) { setExchangeError("Base and quote currencies must be different"); return; }
    if (!exchangeForm.fromCurrencyId || !exchangeForm.toCurrencyId) { setExchangeError("Select both currencies"); return; }
    if (exchangeForm.fromCurrencyId === exchangeForm.toCurrencyId) { setExchangeError("From and To currencies must be different"); return; }
    if (!fromAmount) { setExchangeError("Enter a valid from amount"); return; }
    if (!exchangeRate) { setExchangeError("Enter a valid exchange rate"); return; }
    const exchangeCalc = calculateToAmount(exchangeForm.fromAmount, exchangeForm.exchangeRate, exchangeForm.baseCurrencyId, exchangeForm.quoteCurrencyId, exchangeForm.fromCurrencyId, exchangeForm.toCurrencyId);
    if (!exchangeCalc.isPairValid) { setExchangeError("From/To must match selected base/quote pair"); return; }
    setExchangeSubmitting(true);
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}/exchanges`, {
      method: "POST",
      body: {
        exchangeDate: exchangeForm.exchangeDate,
        baseCurrencyId: Number(exchangeForm.baseCurrencyId),
        quoteCurrencyId: Number(exchangeForm.quoteCurrencyId),
        fromCurrencyId: Number(exchangeForm.fromCurrencyId),
        fromAmount,
        toCurrencyId: Number(exchangeForm.toCurrencyId),
        exchangeRate,
        notes: exchangeForm.notes || null,
      },
    });
    setExchangeSubmitting(false);
    if (r.success) { setExchangeForm({ ...EMPTY_EXCHANGE }); setExchangeError(""); openLedger(selected); } else { setExchangeError(r.error || "Failed to execute exchange"); }
  };

  const openEditExchange = async (exchange: any) => {
    await loadRefData();
    setEditExchangeId(exchange.id);
    setEditExchangeForm({
      exchangeDate: String(exchange.exchangeDate || "").split("T")[0] || new Date().toISOString().split("T")[0],
      baseCurrencyId: String(exchange.baseCurrencyId || exchange.fromCurrencyId || ""),
      quoteCurrencyId: String(exchange.quoteCurrencyId || exchange.toCurrencyId || ""),
      fromCurrencyId: String(exchange.fromCurrencyId || ""),
      fromAmount: String(exchange.fromAmount || ""),
      toCurrencyId: String(exchange.toCurrencyId || ""),
      exchangeRate: String(exchange.exchangeRate || ""),
      notes: exchange.notes || "",
    });
    setEditExchangeError("");
    setShowEditExchange(true);
  };

  const handleEditExchange = async () => {
    if (!editExchangeId) return;
    const fromAmount = parseAmountInput(editExchangeForm.fromAmount);
    const exchangeRate = parseAmountInput(editExchangeForm.exchangeRate);
    if (!editExchangeForm.baseCurrencyId || !editExchangeForm.quoteCurrencyId) { setEditExchangeError("Select base and quote currencies for the rate"); return; }
    if (editExchangeForm.baseCurrencyId === editExchangeForm.quoteCurrencyId) { setEditExchangeError("Base and quote currencies must be different"); return; }
    if (!editExchangeForm.fromCurrencyId || !editExchangeForm.toCurrencyId) { setEditExchangeError("Select both currencies"); return; }
    if (editExchangeForm.fromCurrencyId === editExchangeForm.toCurrencyId) { setEditExchangeError("From and To currencies must be different"); return; }
    if (!fromAmount) { setEditExchangeError("Enter a valid from amount"); return; }
    if (!exchangeRate) { setEditExchangeError("Enter a valid exchange rate"); return; }
    const exchangeCalc = calculateToAmount(editExchangeForm.fromAmount, editExchangeForm.exchangeRate, editExchangeForm.baseCurrencyId, editExchangeForm.quoteCurrencyId, editExchangeForm.fromCurrencyId, editExchangeForm.toCurrencyId);
    if (!exchangeCalc.isPairValid) { setEditExchangeError("From/To must match selected base/quote pair"); return; }
    setEditExchangeSubmitting(true);
    const r = await apiCall(`/api/v1/intermediary-exchanges/${editExchangeId}`, {
      method: "PUT",
      body: {
        exchangeDate: editExchangeForm.exchangeDate,
        baseCurrencyId: Number(editExchangeForm.baseCurrencyId),
        quoteCurrencyId: Number(editExchangeForm.quoteCurrencyId),
        fromCurrencyId: Number(editExchangeForm.fromCurrencyId),
        fromAmount,
        toCurrencyId: Number(editExchangeForm.toCurrencyId),
        exchangeRate,
        notes: editExchangeForm.notes || null,
      },
    });
    setEditExchangeSubmitting(false);
    if (r.success) { setShowEditExchange(false); setEditExchangeId(null); openLedger(selected); } else { setEditExchangeError(r.error || "Failed to update exchange"); }
  };

  const handleDeleteExchange = async (exchangeId: number) => {
    if (!confirm("Delete this exchange? The journal entries will be reversed.")) return;
    const r = await apiCall(`/api/v1/intermediary-exchanges/${exchangeId}`, { method: "DELETE" });
    if (!r.success) { setExchangeError(r.error || "Failed to delete exchange"); return; }
    openLedger(selected);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError("Name required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/intermediaries", { method: "POST", body: form });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setFormError(r.error || "Failed"); }
  };

  const openEdit = (item: any) => {
    setSelected(item);
    setForm({ name: item.name, notes: item.notes || "" });
    setFormError("");
    setShowEdit(true);
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}`, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setFormError(r.error || "Failed"); }
  };

  const handleToggleActive = async (item: any) => {
    const action = item.isActive ? "deactivate" : "reactivate";
    if (!confirm(`Do you want to ${action} intermediary "${item.name}"?`)) return;
    const r = await apiCall(`/api/v1/intermediaries/${item.id}`, { method: "PUT", body: { isActive: !item.isActive } });
    if (!r.success) { setFormError(r.error || "Failed"); return; }
    if (selected?.id === item.id) { setSelected((prev: any) => prev ? { ...prev, isActive: !item.isActive } : prev); }
    load();
  };

  const escHtml = (value: any) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const exportIntermediaryLedgerXlsx = () => {
    if (!selected || !ledger?.ledger) return;
    const rows: any[][] = [];
    rows.push(["Intermediary Ledger", selected.name || ""]);
    rows.push(["Generated", new Date().toISOString().split("T")[0]]);
    rows.push([]);
    rows.push(["Date", "Particulars", "Debit", "Credit", "Running Balance"]);
    for (const entry of ledger.ledger || []) {
      rows.push([
        formatDate(entry.date),
        entry.description || "",
        entry.debit > 0 ? entry.debit : "",
        entry.credit > 0 ? entry.credit : "",
        entry.balance ?? "",
      ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Intermediary Ledger");
    const wbout = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intermediary_ledger_${String(selected.name || "ledger").replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportIntermediaryLedgerPdf = () => {
    if (!selected || !ledger?.ledger) return;
    const balanceSummary = Object.entries(ledger?.balances || {})
      .map(([code, value]) => `${code} ${formatNumber(Number(value || 0))}`)
      .join(" · ");
    const rowsHtml = (ledger.ledger || []).map((entry: any) => `
      <tr>
        <td>${escHtml(formatDate(entry.date))}</td>
        <td>${escHtml(entry.description || "")}</td>
        <td style="text-align:right;">${entry.debit > 0 ? escHtml(formatNumber(entry.debit)) : "—"}</td>
        <td style="text-align:right;">${entry.credit > 0 ? escHtml(formatNumber(entry.credit)) : "—"}</td>
        <td style="text-align:right;">${escHtml(formatNumber(entry.balance || 0))}</td>
      </tr>
    `).join("");
    const html = `
      <html><head><title>Intermediary Ledger</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
        h1 { margin: 0 0 8px 0; font-size: 20px; }
        .meta { margin: 0 0 14px 0; color: #555; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #e2e2e2; padding: 7px; font-size: 12px; text-align: left; }
        th { background: #f6f6f6; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; color: #666; }
      </style></head><body>
        <h1>Intermediary Ledger - ${escHtml(selected.name || "")}</h1>
        <p class="meta">Generated: ${escHtml(new Date().toISOString().split("T")[0])}<br/>Balance: ${escHtml(balanceSummary || "0")}</p>
        <table>
          <thead><tr><th>Date</th><th>Particulars</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Running</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="5">No ledger entries</td></tr>`}</tbody>
        </table>
      </body></html>
    `;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 2000);
    }, 200);
  };

  const currencyCodeById = useCallback((id: string) => {
    if (!id) return "";
    return currencies.find((c: any) => String(c.id) === String(id))?.code || "";
  }, [currencies]);

  const isSA = user?.role === "super_admin";
  if (!isSA) return <div className="p-8 text-center text-gray-400">Access restricted to Super Admin.</div>;

  const columns = [
    {
      key: "name", label: "Name",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {!row.isActive && <span className="badge-cancelled text-xs">Inactive</span>}
        </div>
      ),
    },
    { key: "notes", label: "Notes", render: (row: any) => <span className="text-gray-500 text-sm">{row.notes || "—"}</span> },
    {
      key: "actions", label: "",
      render: (row: any) => (
        <div className="flex items-center gap-3">
          <button onClick={() => openLedger(row)} className="text-primary-600 hover:underline text-sm font-medium">Ledger</button>
          <button onClick={() => openEdit(row)} className="text-amber-600 hover:underline text-sm">Edit</button>
          <button onClick={() => handleToggleActive(row)} className={`hover:underline text-sm ${row.isActive ? "text-red-600" : "text-green-600"}`}>
            {row.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];

  const exchangePreview = calculateToAmount(exchangeForm.fromAmount, exchangeForm.exchangeRate, exchangeForm.baseCurrencyId, exchangeForm.quoteCurrencyId, exchangeForm.fromCurrencyId, exchangeForm.toCurrencyId);
  const editExchangePreview = calculateToAmount(editExchangeForm.fromAmount, editExchangeForm.exchangeRate, editExchangeForm.baseCurrencyId, editExchangeForm.quoteCurrencyId, editExchangeForm.fromCurrencyId, editExchangeForm.toCurrencyId);

  return (
    <div>
      <PageHeader
        title="Intermediaries"
        subtitle={`${intermediaries.length} intermediary accounts`}
        action={isSA && (
          <button onClick={() => { setForm({ name: "", notes: "" }); setFormError(""); setShowCreate(true); }} className="btn-primary text-sm">
            + Add Intermediary
          </button>
        )}
      />

      <DataTable columns={columns} data={intermediaries} loading={loading} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Intermediary" size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="Enter intermediary name" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field" rows={3} placeholder="Optional remarks" />
          </div>
          {formError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Intermediary" size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field" rows={3} />
          </div>
          {formError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Ledger — ${selected?.name}`} size="xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-[#e8dccd] bg-[#fbf6ef]/80 px-3 py-2.5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8d755f]">Intermediary Ledger</p>
              <p className="text-sm font-medium text-[#3a2b1e]">{selected?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportIntermediaryLedgerXlsx} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100">Export XLSX</button>
              <button onClick={exportIntermediaryLedgerPdf} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Export PDF</button>
              <button onClick={openDeposit} className="btn-primary text-sm">
                + Record Deposit
              </button>
            </div>
          </div>

          {ledgerLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : ledger ? (
            <>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(ledger.balances || {}).map(([code, amount]) => {
                  const bal = Number(amount || 0);
                  return (
                    <div key={code} className={`rounded-lg border px-3 py-2.5 ${bal >= 0 ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}>
                      <div className="flex items-center justify-between">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${bal >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{code}</span>
                      </div>
                      <p className={`mt-1.5 text-base font-bold tabular-nums ${bal >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {formatNumber(bal)}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/35 p-3.5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-900">Currency Exchange</h3>
                <div className="mb-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">Base Currency</label>
                    <select value={exchangeForm.baseCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, baseCurrencyId: e.target.value }))} className="select-field text-sm">
                      <option value="">Select</option>
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">Quote Currency</label>
                    <select value={exchangeForm.quoteCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, quoteCurrencyId: e.target.value }))} className="select-field text-sm">
                      <option value="">Select</option>
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">Exchange Rate</label>
                    <input type="text" inputMode="decimal" value={exchangeForm.exchangeRate} onChange={e => setExchangeForm(prev => ({ ...prev, exchangeRate: e.target.value }))} className="input-field text-sm" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">Date</label>
                    <input type="date" value={exchangeForm.exchangeDate} onChange={e => setExchangeForm(prev => ({ ...prev, exchangeDate: e.target.value }))} className="input-field text-sm" />
                  </div>
                </div>
                <div className="mb-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">From Currency</label>
                    <select value={exchangeForm.fromCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, fromCurrencyId: e.target.value }))} className="select-field text-sm">
                      <option value="">Select</option>
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">Amount</label>
                    <input type="text" inputMode="decimal" value={exchangeForm.fromAmount} onChange={e => setExchangeForm(prev => ({ ...prev, fromAmount: e.target.value }))} className="input-field text-sm" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">To Currency</label>
                    <select value={exchangeForm.toCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, toCurrencyId: e.target.value }))} className="select-field text-sm">
                      <option value="">Select</option>
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mb-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">To Amount (Calculated)</label>
                    <input type="text" value={exchangePreview.toAmount.toLocaleString("en-US")} className="input-field text-sm bg-amber-50" readOnly />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-gray-600">Notes</label>
                    <input type="text" value={exchangeForm.notes} onChange={e => setExchangeForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field text-sm" placeholder="Optional note" />
                  </div>
                </div>
                {exchangeError && <div className="mb-2.5 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{exchangeError}</div>}
                <button onClick={handleExchange} disabled={exchangeSubmitting} className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  {exchangeSubmitting ? "Executing..." : "Execute Exchange"}
                </button>
              </div>

              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f8f1e7]">
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Particulars</th>
                        <th className="w-16 px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ccy</th>
                        <th className="w-28 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Debit</th>
                        <th className="w-28 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Credit</th>
                        <th className="w-32 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Balance</th>
                        <th className="w-20 px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!ledger.ledger || ledger.ledger.length === 0) && (
                        <tr><td colSpan={7} className="py-8 text-center text-sm text-gray-400">No ledger entries</td></tr>
                      )}
                      {ledger.ledger?.map((entry: any, i: number) => (
                        <tr key={i} className="border-t border-[#f3e8db] hover:bg-[#fff8ef]">
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-600">{formatDate(entry.date)}</td>
                          <td className="max-w-xs px-3 py-2.5 text-sm text-gray-800">
                            <span className="line-clamp-1">{entry.description}</span>
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{entry.currencyCode}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right text-sm font-medium tabular-nums text-green-700">{entry.debit > 0 ? formatNumber(entry.debit) : "—"}</td>
                          <td className="px-3 py-2.5 text-right text-sm font-medium tabular-nums text-red-700">{entry.credit > 0 ? formatNumber(entry.credit) : "—"}</td>
                          <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-gray-800">{formatNumber(entry.balance)}</td>
                          <td className="px-2 py-2.5 text-center">
                            {entry.type === "deposit" && (
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={() => openEditDeposit(entry)} className="rounded px-1.5 py-0.5 text-xs text-amber-700 hover:bg-amber-100">Edit</button>
                                <button onClick={() => handleDeleteDeposit(entry.id)} className="rounded px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-100">Del</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-400">No data available</div>
          )}
        </div>
      </Modal>

      <Modal open={showDeposit} onClose={() => setShowDeposit(false)} title={`Record Deposit — ${selected?.name || "Intermediary"}`} size="md">
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Transfer Route</p>
            <p className="text-sm text-gray-700">
              <span className="font-medium">🏦 {superAdminBankAccounts.find((b: any) => String(b.id) === depositForm.superAdminBankAccountId)?.bankName || "Select Bank"}</span>
              <span className="text-gray-400 mx-2">→</span>
              <span className="font-medium">👤 {selected?.name}</span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={depositForm.depositDate} onChange={e => setDepositForm(prev => ({ ...prev, depositDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={depositForm.amount} onChange={e => setDepositForm(prev => ({ ...prev, amount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Currency</label>
            <select value={depositForm.currencyId} onChange={e => setDepositForm(prev => ({ ...prev, currencyId: e.target.value, superAdminBankAccountId: "" }))} className="select-field">
              <option value="">Select currency</option>
              {currencies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account</label>
            <select value={depositForm.superAdminBankAccountId} onChange={e => setDepositForm(prev => ({ ...prev, superAdminBankAccountId: e.target.value }))} className="select-field">
              <option value="">Select bank account</option>
              {superAdminBankAccounts.filter((b: any) => b.isActive && (!depositForm.currencyId || String(b.currencyId) === String(depositForm.currencyId))).map((b: any) => (
                <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` - ${b.accountNumber}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={depositForm.notes} onChange={e => setDepositForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" placeholder="Optional note" />
          </div>
          {depositError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{depositError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowDeposit(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleDeposit} disabled={depositSubmitting} className="btn-primary text-sm">{depositSubmitting ? "Saving..." : "Record Deposit"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showEditDeposit} onClose={() => setShowEditDeposit(false)} title="Edit Deposit" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={editDepositForm.depositDate} onChange={e => setEditDepositForm(prev => ({ ...prev, depositDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={editDepositForm.amount} onChange={e => setEditDepositForm(prev => ({ ...prev, amount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Currency</label>
            <select value={editDepositForm.currencyId} onChange={e => setEditDepositForm(prev => ({ ...prev, currencyId: e.target.value, superAdminBankAccountId: "" }))} className="select-field">
              <option value="">Select currency</option>
              {currencies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account</label>
            <select value={editDepositForm.superAdminBankAccountId} onChange={e => setEditDepositForm(prev => ({ ...prev, superAdminBankAccountId: e.target.value }))} className="select-field">
              <option value="">Select bank account</option>
              {superAdminBankAccounts.filter((b: any) => b.isActive && (!editDepositForm.currencyId || String(b.currencyId) === String(editDepositForm.currencyId))).map((b: any) => (
                <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` - ${b.accountNumber}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={editDepositForm.notes} onChange={e => setEditDepositForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" placeholder="Optional note" />
          </div>
          {editDepositError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editDepositError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowEditDeposit(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEditDeposit} disabled={editDepositSubmitting} className="btn-primary text-sm">{editDepositSubmitting ? "Saving..." : "Save Changes"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showEditExchange} onClose={() => setShowEditExchange(false)} title="Edit Exchange" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={editExchangeForm.exchangeDate} onChange={e => setEditExchangeForm(prev => ({ ...prev, exchangeDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Exchange Rate</label>
              <input type="text" inputMode="decimal" value={editExchangeForm.exchangeRate} onChange={e => setEditExchangeForm(prev => ({ ...prev, exchangeRate: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Base Currency</label>
              <select value={editExchangeForm.baseCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, baseCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Quote Currency</label>
              <select value={editExchangeForm.quoteCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, quoteCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">From Currency</label>
              <select value={editExchangeForm.fromCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, fromCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To Currency</label>
              <select value={editExchangeForm.toCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, toCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={editExchangeForm.fromAmount} onChange={e => setEditExchangeForm(prev => ({ ...prev, fromAmount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To Amount</label>
              <input type="text" value={editExchangePreview.toAmount.toLocaleString("en-US")} className="input-field bg-gray-50" readOnly />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={editExchangeForm.notes} onChange={e => setEditExchangeForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" />
          </div>
          {editExchangeError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editExchangeError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowEditExchange(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEditExchange} disabled={editExchangeSubmitting} className="btn-primary text-sm">{editExchangeSubmitting ? "Saving..." : "Save Exchange"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
