"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber } from "@/components/ui";

const EMPTY_DEPOSIT = {
  depositDate: new Date().toISOString().split("T")[0],
  amount: "",
  currencyId: "",
  sourceType: "bank_account",
  cityId: "",
  bankAccountId: "",
  notes: "",
};

const EMPTY_EXCHANGE = {
  exchangeDate: new Date().toISOString().split("T")[0],
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

function calculateToAmount(fromAmount: string, exchangeRate: string): number {
  const from = parseAmountInput(fromAmount);
  const rate = parseAmountInput(exchangeRate);
  if (!from || !rate) return 0;
  return Math.round((from / rate) * 100) / 100;
}

function DepositFormFields({
  f,
  setF,
  selectedName,
  bankAccounts,
  cities,
  currencies,
  inputCls,
  labelCls,
}: {
  f: typeof EMPTY_DEPOSIT;
  setF: React.Dispatch<React.SetStateAction<typeof EMPTY_DEPOSIT>>;
  selectedName?: string;
  bankAccounts: any[];
  cities: any[];
  currencies: any[];
  inputCls: string;
  labelCls: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800 font-medium">
        <span>{f.sourceType === "bank_account" ? `🏦 ${bankAccounts.find((b) => String(b.id) === f.bankAccountId)?.bankName || "Bank Account"}` : `🏙️ ${cities.find((c) => String(c.id) === f.cityId)?.name || "City Cash"}`}</span>
        <span className="text-blue-400 text-lg">→</span>
        <span>👤 {selectedName || "Intermediary"}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" value={f.depositDate} onChange={e => setF(prev => ({ ...prev, depositDate: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <input
            type="text"
            inputMode="decimal"
            value={f.amount}
            onChange={e => setF(prev => ({ ...prev, amount: e.target.value }))}
            className={inputCls}
            placeholder="0.00"
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>Currency</label>
        <select value={f.currencyId} onChange={e => setF(prev => ({ ...prev, currencyId: e.target.value }))} className={inputCls}>
          <option value="">Select currency</option>
          {currencies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Sending From</label>
        <select value={f.sourceType} onChange={e => setF(prev => ({ ...prev, sourceType: e.target.value, cityId: "", bankAccountId: "" }))} className={inputCls}>
          <option value="bank_account">Bank Account</option>
          <option value="city_cash">City Cash</option>
        </select>
      </div>
      {f.sourceType === "bank_account" && (
        <div>
          <label className={labelCls}>Bank Account</label>
          <select value={f.bankAccountId} onChange={e => setF(prev => ({ ...prev, bankAccountId: e.target.value }))} className={inputCls}>
            <option value="">Select bank</option>
            {bankAccounts.filter((b: any) => b.isActive).map((b: any) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumber || ""}</option>)}
          </select>
        </div>
      )}
      {f.sourceType === "city_cash" && (
        <div>
          <label className={labelCls}>City</label>
          <select value={f.cityId} onChange={e => setF(prev => ({ ...prev, cityId: e.target.value }))} className={inputCls}>
            <option value="">Select city</option>
            {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={labelCls}>Notes</label>
        <input type="text" value={f.notes} onChange={e => setF(prev => ({ ...prev, notes: e.target.value }))} className={inputCls} />
      </div>
    </>
  );
}

export default function IntermediariesPage() {
  const { user } = useAuth();
  const [intermediaries, setIntermediary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // create / edit intermediary
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // ledger
  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // deposit
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ ...EMPTY_DEPOSIT });
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositError, setDepositError] = useState("");

  // edit deposit
  const [showEditDeposit, setShowEditDeposit] = useState(false);
  const [editDepositId, setEditDepositId] = useState<number | null>(null);
  const [editDepositForm, setEditDepositForm] = useState({ ...EMPTY_DEPOSIT });
  const [editDepositSubmitting, setEditDepositSubmitting] = useState(false);
  const [editDepositError, setEditDepositError] = useState("");

  // exchange
  const [exchangeForm, setExchangeForm] = useState({ ...EMPTY_EXCHANGE });
  const [exchangeSubmitting, setExchangeSubmitting] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [showEditExchange, setShowEditExchange] = useState(false);
  const [editExchangeId, setEditExchangeId] = useState<number | null>(null);
  const [editExchangeForm, setEditExchangeForm] = useState({ ...EMPTY_EXCHANGE });
  const [editExchangeSubmitting, setEditExchangeSubmitting] = useState(false);
  const [editExchangeError, setEditExchangeError] = useState("");

  // ref data
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/intermediaries");
    if (r.success) setIntermediary(r.data as any[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadRefData = async () => {
    const [c, ci, b] = await Promise.all([
      apiCall("/api/v1/currencies"),
      apiCall("/api/v1/cities", { params: { limit: 100 } }),
      apiCall("/api/v1/bank-accounts", { params: { limit: 100 } }),
    ]);
    if (c.success) {
      const loadedCurrencies = c.data as any[];
      setCurrencies(loadedCurrencies);
      if (loadedCurrencies.length >= 2) {
        setExchangeForm((prev) => ({
          ...prev,
          fromCurrencyId: prev.fromCurrencyId || String(loadedCurrencies[0].id),
          toCurrencyId: prev.toCurrencyId || String(loadedCurrencies[1].id),
        }));
      }
    }
    if (ci.success) setCities((ci.data as any).items || ci.data as any[]);
    if (b.success) setBankAccounts((b.data as any).items || b.data as any[]);
  };

  const openLedger = async (item: any) => {
    await loadRefData();
    setSelected(item);
    setShowLedger(true);
    setLedgerLoading(true);
    setExchangeForm({ ...EMPTY_EXCHANGE });
    setExchangeError("");
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
    if (!parsedAmount) {
      setDepositError("Enter a valid amount greater than 0");
      return;
    }
    if (!depositForm.currencyId) {
      setDepositError("Currency is required");
      return;
    }
    setDepositSubmitting(true);
    const body: any = {
      depositDate: depositForm.depositDate,
      amount: parsedAmount,
      currencyId: Number(depositForm.currencyId),
      sourceType: depositForm.sourceType,
      notes: depositForm.notes || null,
    };
    if (depositForm.sourceType === "city_cash" && depositForm.cityId) body.cityId = Number(depositForm.cityId);
    if (depositForm.sourceType === "bank_account" && depositForm.bankAccountId) body.bankAccountId = Number(depositForm.bankAccountId);

    const r = await apiCall(`/api/v1/intermediaries/${selected.id}/deposits`, { method: "POST", body });
    setDepositSubmitting(false);
    if (r.success) {
      setShowDeposit(false);
      openLedger(selected);
    } else {
      setDepositError(r.error || "Failed");
    }
  };

  const openEditDeposit = async (entry: any) => {
    await loadRefData();
    setEditDepositId(entry.id);
    setEditDepositForm({
      depositDate: entry.date?.split("T")[0] || "",
      amount: String(entry.debit),
      currencyId: "",
      sourceType: entry.description?.includes("via") ? "bank_account" : "city_cash",
      cityId: "",
      bankAccountId: "",
      notes: "",
    });
    setEditDepositError("");
    setShowEditDeposit(true);
  };

  const handleEditDeposit = async () => {
    if (!editDepositId) return;
    const parsedAmount = parseAmountInput(editDepositForm.amount);
    if (!parsedAmount) {
      setEditDepositError("Enter a valid amount greater than 0");
      return;
    }
    setEditDepositSubmitting(true);
    const body: any = {
      depositDate: editDepositForm.depositDate,
      amount: parsedAmount,
      sourceType: editDepositForm.sourceType,
      notes: editDepositForm.notes || null,
    };
    if (editDepositForm.currencyId) body.currencyId = Number(editDepositForm.currencyId);
    if (editDepositForm.sourceType === "city_cash" && editDepositForm.cityId) body.cityId = Number(editDepositForm.cityId);
    if (editDepositForm.sourceType === "bank_account" && editDepositForm.bankAccountId) body.bankAccountId = Number(editDepositForm.bankAccountId);

    const r = await apiCall(`/api/v1/intermediary-deposits/${editDepositId}`, { method: "PUT", body });
    setEditDepositSubmitting(false);
    if (r.success) {
      setShowEditDeposit(false);
      openLedger(selected);
    } else {
      setEditDepositError(r.error || "Failed");
    }
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
    if (!exchangeForm.fromCurrencyId || !exchangeForm.toCurrencyId) {
      setExchangeError("Select both currencies");
      return;
    }
    if (exchangeForm.fromCurrencyId === exchangeForm.toCurrencyId) {
      setExchangeError("From and To currencies must be different");
      return;
    }
    if (!fromAmount) {
      setExchangeError("Enter a valid from amount");
      return;
    }
    if (!exchangeRate) {
      setExchangeError("Enter a valid exchange rate");
      return;
    }
    setExchangeSubmitting(true);
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}/exchanges`, {
      method: "POST",
      body: {
        exchangeDate: exchangeForm.exchangeDate,
        fromCurrencyId: Number(exchangeForm.fromCurrencyId),
        fromAmount,
        toCurrencyId: Number(exchangeForm.toCurrencyId),
        exchangeRate,
        notes: exchangeForm.notes || null,
      },
    });
    setExchangeSubmitting(false);
    if (r.success) {
      setExchangeForm({ ...EMPTY_EXCHANGE });
      setExchangeError("");
      openLedger(selected);
    } else {
      setExchangeError(r.error || "Failed to execute exchange");
    }
  };

  const openEditExchange = async (exchange: any) => {
    await loadRefData();
    setEditExchangeId(exchange.id);
    setEditExchangeForm({
      exchangeDate: String(exchange.exchangeDate || "").split("T")[0] || new Date().toISOString().split("T")[0],
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
    if (!editExchangeForm.fromCurrencyId || !editExchangeForm.toCurrencyId) {
      setEditExchangeError("Select both currencies");
      return;
    }
    if (editExchangeForm.fromCurrencyId === editExchangeForm.toCurrencyId) {
      setEditExchangeError("From and To currencies must be different");
      return;
    }
    if (!fromAmount) {
      setEditExchangeError("Enter a valid from amount");
      return;
    }
    if (!exchangeRate) {
      setEditExchangeError("Enter a valid exchange rate");
      return;
    }
    setEditExchangeSubmitting(true);
    const r = await apiCall(`/api/v1/intermediary-exchanges/${editExchangeId}`, {
      method: "PUT",
      body: {
        exchangeDate: editExchangeForm.exchangeDate,
        fromCurrencyId: Number(editExchangeForm.fromCurrencyId),
        fromAmount,
        toCurrencyId: Number(editExchangeForm.toCurrencyId),
        exchangeRate,
        notes: editExchangeForm.notes || null,
      },
    });
    setEditExchangeSubmitting(false);
    if (r.success) {
      setShowEditExchange(false);
      setEditExchangeId(null);
      openLedger(selected);
    } else {
      setEditExchangeError(r.error || "Failed to update exchange");
    }
  };

  const handleDeleteExchange = async (exchangeId: number) => {
    if (!confirm("Delete this exchange? The journal entries will be reversed.")) return;
    const r = await apiCall(`/api/v1/intermediary-exchanges/${exchangeId}`, { method: "DELETE" });
    if (!r.success) {
      setExchangeError(r.error || "Failed to delete exchange");
      return;
    }
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
    const r = await apiCall(`/api/v1/intermediaries/${item.id}`, {
      method: "PUT",
      body: { isActive: !item.isActive },
    });
    if (!r.success) {
      setFormError(r.error || "Failed");
      return;
    }
    if (selected?.id === item.id) {
      setSelected((prev: any) => prev ? { ...prev, isActive: !item.isActive } : prev);
    }
    load();
  };

  const isSA = user?.role === "super_admin";
  if (!isSA) return <div className="p-8 text-gray-400">Access restricted to Super Admin.</div>;

  const columns = [
    {
      key: "name", label: "Name",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <span>{row.name}</span>
          {!row.isActive && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">Inactive</span>}
        </div>
      ),
    },
    { key: "notes", label: "Notes", render: (row: any) => row.notes || "-" },
    {
      key: "actions", label: "Actions",
      render: (row: any) => (
        <div className="flex gap-2">
          <button onClick={() => openLedger(row)} className="text-blue-600 hover:underline text-sm">Ledger</button>
          {isSA && <button onClick={() => openEdit(row)} className="text-yellow-600 hover:underline text-sm">Edit</button>}
          {isSA && (
            <button onClick={() => handleToggleActive(row)} className={`hover:underline text-sm ${row.isActive ? "text-red-600" : "text-green-600"}`}>
              {row.isActive ? "Deactivate" : "Reactivate"}
            </button>
          )}
        </div>
      ),
    },
  ];

  const inputCls = "w-full border rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:border-gray-600";
  const labelCls = "block text-sm font-medium mb-1";

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title="Intermediaries"
        subtitle="Professional intermediary ledger and settlement records"
        action={isSA ? (
          <button onClick={() => { setForm({ name: "", notes: "" }); setFormError(""); setShowCreate(true); }} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">
            + Add Intermediary
          </button>
        ) : undefined}
      />

      <DataTable columns={columns} data={intermediaries} loading={loading} />

      {/* Create */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Intermediary">
        <div className="space-y-3">
          <div><label className={labelCls}>Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} rows={2} /></div>
          {formError && <p className="text-red-500 text-sm">{formError}</p>}
          <button onClick={handleCreate} disabled={submitting} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </Modal>

      {/* Edit */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Intermediary">
        <div className="space-y-3">
          <div><label className={labelCls}>Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} rows={2} /></div>
          {formError && <p className="text-red-500 text-sm">{formError}</p>}
          <button onClick={handleEdit} disabled={submitting} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </Modal>

      {/* Ledger */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Intermediary Ledger — ${selected?.name}`} size="xl">
        <div className="space-y-4">
          {isSA && (
              <button onClick={openDeposit} className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700">
                + Record Deposit Entry
              </button>
          )}

          {ledgerLoading ? (
            <p className="text-center text-gray-500 py-8">Loading...</p>
          ) : ledger ? (
            <>
              {/* Balances */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <h4 className="mb-3 text-sm font-semibold text-blue-900">Currency Balances (Active Only)</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from(
                    new Set([
                      "AED",
                      "PKR",
                      "USD",
                      ...Object.keys(ledger.balances || {}),
                    ])
                  ).map((cur) => {
                    const balance = Number(ledger.balances?.[cur] || 0);
                    return (
                      <div key={cur} className="rounded-lg border border-blue-100 bg-white p-3">
                        <p className="text-xs font-medium text-gray-500">{cur} Balance</p>
                        <p className={`mt-1 text-lg font-bold ${balance < 0 ? "text-red-600" : "text-blue-700"}`}>
                          {formatNumber(balance)} {cur}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Exchange Form */}
              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                <h4 className="mb-3 text-sm font-semibold text-amber-900">Currency Exchange</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                  <div>
                    <label className={labelCls}>Date</label>
                    <input
                      type="date"
                      value={exchangeForm.exchangeDate}
                      onChange={e => setExchangeForm(prev => ({ ...prev, exchangeDate: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>From Currency</label>
                    <select
                      value={exchangeForm.fromCurrencyId}
                      onChange={e => setExchangeForm(prev => ({ ...prev, fromCurrencyId: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">Select</option>
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Amount</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={exchangeForm.fromAmount}
                      onChange={e => setExchangeForm(prev => ({ ...prev, fromAmount: e.target.value }))}
                      className={inputCls}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>To Currency</label>
                    <select
                      value={exchangeForm.toCurrencyId}
                      onChange={e => setExchangeForm(prev => ({ ...prev, toCurrencyId: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">Select</option>
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Exchange Rate</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={exchangeForm.exchangeRate}
                      onChange={e => setExchangeForm(prev => ({ ...prev, exchangeRate: e.target.value }))}
                      className={inputCls}
                      placeholder="e.g. 278.5"
                    />
                    <p className="mt-1 text-xs text-gray-500">To Amount = Amount ÷ Exchange Rate</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className={labelCls}>To Amount (Calculated)</label>
                    <input
                      type="text"
                      value={calculateToAmount(exchangeForm.fromAmount, exchangeForm.exchangeRate).toLocaleString("en-US")}
                      className={inputCls}
                      readOnly
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Notes</label>
                    <input
                      type="text"
                      value={exchangeForm.notes}
                      onChange={e => setExchangeForm(prev => ({ ...prev, notes: e.target.value }))}
                      className={inputCls}
                      placeholder="Optional note"
                    />
                  </div>
                </div>
                {exchangeError && <p className="mt-2 text-sm text-red-600">{exchangeError}</p>}
                <div className="mt-3">
                  <button
                    onClick={handleExchange}
                    disabled={exchangeSubmitting}
                    className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {exchangeSubmitting ? "Executing..." : "Execute Exchange"}
                  </button>
                </div>
              </div>

              {/* Ledger Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800">
                      <th className="border px-3 py-2 text-left">Date</th>
                      <th className="border px-3 py-2 text-left">Particulars</th>
                      <th className="border px-3 py-2 text-left">Ccy</th>
                      <th className="border px-3 py-2 text-right">Debit</th>
                      <th className="border px-3 py-2 text-right">Credit</th>
                      <th className="border px-3 py-2 text-right">Closing Balance</th>
                      {isSA && <th className="border px-3 py-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.ledger?.length === 0 && (
                      <tr><td colSpan={isSA ? 7 : 6} className="text-center py-4 text-gray-400">No ledger entries</td></tr>
                    )}
                    {ledger.ledger?.map((entry: any, i: number) => (
                      <tr key={i} className={
                        entry.type === "deposit"
                          ? "bg-green-50 dark:bg-green-900/10"
                          : entry.type === "payment" || entry.type === "exchange_out"
                          ? "bg-red-50 dark:bg-red-900/10"
                          : "bg-blue-50 dark:bg-blue-900/10"
                      }>
                        <td className="border px-3 py-2">{entry.date?.split("T")[0]}</td>
                        <td className="border px-3 py-2">{entry.description}</td>
                        <td className="border px-3 py-2">{entry.currencyCode}</td>
                        <td className="border px-3 py-2 text-right text-green-700">{entry.debit > 0 ? formatNumber(entry.debit) : ""}</td>
                        <td className="border px-3 py-2 text-right text-red-700">{entry.credit > 0 ? formatNumber(entry.credit) : ""}</td>
                        <td className="border px-3 py-2 text-right font-medium">{formatNumber(entry.balance)}</td>
                        {isSA && (
                          <td className="border px-3 py-2 text-center">
                            {entry.type === "deposit" && (
                              <div className="flex gap-2 justify-center">
                                <button onClick={() => openEditDeposit(entry)} className="text-yellow-600 hover:underline text-xs">Edit</button>
                                <button onClick={() => handleDeleteDeposit(entry.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-center text-gray-400 py-4">No data</p>
          )}
        </div>
      </Modal>

      {/* Record Deposit */}
      <Modal open={showDeposit} onClose={() => setShowDeposit(false)} title={`Record Deposit Entry — ${selected?.name || "Intermediary"}`}>
        <div className="space-y-3">
          <DepositFormFields
            f={depositForm}
            setF={setDepositForm}
            selectedName={selected?.name}
            bankAccounts={bankAccounts}
            cities={cities}
            currencies={currencies}
            inputCls={inputCls}
            labelCls={labelCls}
          />
          {depositError && <p className="text-red-500 text-sm">{depositError}</p>}
          <button onClick={handleDeposit} disabled={depositSubmitting} className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50">
            {depositSubmitting ? "Saving..." : "Record Deposit Entry"}
          </button>
        </div>
      </Modal>

      {/* Edit Deposit */}
      <Modal open={showEditDeposit} onClose={() => setShowEditDeposit(false)} title="Edit Deposit">
        <div className="space-y-3">
          <DepositFormFields
            f={editDepositForm}
            setF={setEditDepositForm}
            selectedName={selected?.name}
            bankAccounts={bankAccounts}
            cities={cities}
            currencies={currencies}
            inputCls={inputCls}
            labelCls={labelCls}
          />
          {editDepositError && <p className="text-red-500 text-sm">{editDepositError}</p>}
          <button onClick={handleEditDeposit} disabled={editDepositSubmitting} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {editDepositSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </Modal>

      {/* Edit Exchange */}
      <Modal open={showEditExchange} onClose={() => setShowEditExchange(false)} title="Edit Currency Exchange">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={editExchangeForm.exchangeDate} onChange={e => setEditExchangeForm(prev => ({ ...prev, exchangeDate: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Exchange Rate</label>
              <input type="text" inputMode="decimal" value={editExchangeForm.exchangeRate} onChange={e => setEditExchangeForm(prev => ({ ...prev, exchangeRate: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>From Currency</label>
              <select value={editExchangeForm.fromCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, fromCurrencyId: e.target.value }))} className={inputCls}>
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>To Currency</label>
              <select value={editExchangeForm.toCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, toCurrencyId: e.target.value }))} className={inputCls}>
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>From Amount</label>
              <input type="text" inputMode="decimal" value={editExchangeForm.fromAmount} onChange={e => setEditExchangeForm(prev => ({ ...prev, fromAmount: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>To Amount (Calculated)</label>
              <input type="text" value={calculateToAmount(editExchangeForm.fromAmount, editExchangeForm.exchangeRate).toLocaleString("en-US")} className={inputCls} readOnly />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input type="text" value={editExchangeForm.notes} onChange={e => setEditExchangeForm(prev => ({ ...prev, notes: e.target.value }))} className={inputCls} />
          </div>
          {editExchangeError && <p className="text-sm text-red-600">{editExchangeError}</p>}
          <button onClick={handleEditExchange} disabled={editExchangeSubmitting} className="w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
            {editExchangeSubmitting ? "Saving..." : "Save Exchange"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
