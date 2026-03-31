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
    if (c.success) setCurrencies(c.data as any[]);
    if (ci.success) setCities((ci.data as any).items || ci.data as any[]);
    if (b.success) setBankAccounts((b.data as any).items || b.data as any[]);
  };

  const openLedger = async (item: any) => {
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
    if (!depositForm.amount || !depositForm.currencyId) {
      setDepositError("Amount and currency are required");
      return;
    }
    setDepositSubmitting(true);
    const body: any = {
      depositDate: depositForm.depositDate,
      amount: Number(depositForm.amount),
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
    setEditDepositSubmitting(true);
    const body: any = {
      depositDate: editDepositForm.depositDate,
      amount: Number(editDepositForm.amount),
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

  const isSA = user?.role === "super_admin";
  if (!isSA) return <div className="p-8 text-gray-400">Access restricted to Super Admin.</div>;

  const columns = [
    { key: "name", label: "Name" },
    { key: "notes", label: "Notes", render: (row: any) => row.notes || "-" },
    {
      key: "actions", label: "Actions",
      render: (row: any) => (
        <div className="flex gap-2">
          <button onClick={() => openLedger(row)} className="text-blue-600 hover:underline text-sm">Ledger</button>
          {isSA && <button onClick={() => openEdit(row)} className="text-yellow-600 hover:underline text-sm">Edit</button>}
        </div>
      ),
    },
  ];

  const inputCls = "w-full border rounded px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:border-gray-600";
  const labelCls = "block text-sm font-medium mb-1";

  const DepositFormFields = ({ f, setF }: { f: typeof EMPTY_DEPOSIT; setF: (v: any) => void }) => (
    <>
      {/* Direction banner */}
      <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800 font-medium">
        <span>{f.sourceType === "bank_account" ? `🏦 ${bankAccounts.find(b => String(b.id) === f.bankAccountId)?.bankName || "Bank Account"}` : `🏙️ ${cities.find(c => String(c.id) === f.cityId)?.name || "City Cash"}`}</span>
        <span className="text-blue-400 text-lg">→</span>
        <span>👤 {selected?.name || "Intermediary"}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" value={f.depositDate} onChange={e => setF({ ...f, depositDate: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <input type="number" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} className={inputCls} placeholder="0.00" />
        </div>
      </div>
      <div>
        <label className={labelCls}>Currency</label>
        <select value={f.currencyId} onChange={e => setF({ ...f, currencyId: e.target.value })} className={inputCls}>
          <option value="">Select currency</option>
          {currencies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Sending From</label>
        <select value={f.sourceType} onChange={e => setF({ ...f, sourceType: e.target.value, cityId: "", bankAccountId: "" })} className={inputCls}>
          <option value="bank_account">Bank Account</option>
          <option value="city_cash">City Cash</option>
        </select>
      </div>
      {f.sourceType === "bank_account" && (
        <div>
          <label className={labelCls}>Bank Account</label>
          <select value={f.bankAccountId} onChange={e => setF({ ...f, bankAccountId: e.target.value })} className={inputCls}>
            <option value="">Select bank</option>
            {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumber || ""}</option>)}
          </select>
        </div>
      )}
      {f.sourceType === "city_cash" && (
        <div>
          <label className={labelCls}>City</label>
          <select value={f.cityId} onChange={e => setF({ ...f, cityId: e.target.value })} className={inputCls}>
            <option value="">Select city</option>
            {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={labelCls}>Notes</label>
        <input type="text" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className={inputCls} />
      </div>
    </>
  );

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
              {ledger.balances && Object.keys(ledger.balances).length > 0 && (
                <div className="flex gap-4 flex-wrap">
                  {Object.entries(ledger.balances).map(([cur, bal]) => (
                    <div key={cur} className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded px-4 py-2">
                      <p className="text-xs text-gray-500">Closing Balance ({cur})</p>
                      <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{formatNumber(bal as number)} {cur}</p>
                    </div>
                  ))}
                </div>
              )}

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
                      <tr key={i} className={entry.type === "deposit" ? "bg-green-50 dark:bg-green-900/10" : "bg-red-50 dark:bg-red-900/10"}>
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
          <DepositFormFields f={depositForm} setF={setDepositForm} />
          {depositError && <p className="text-red-500 text-sm">{depositError}</p>}
          <button onClick={handleDeposit} disabled={depositSubmitting} className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50">
            {depositSubmitting ? "Saving..." : "Record Deposit Entry"}
          </button>
        </div>
      </Modal>

      {/* Edit Deposit */}
      <Modal open={showEditDeposit} onClose={() => setShowEditDeposit(false)} title="Edit Deposit">
        <div className="space-y-3">
          <DepositFormFields f={editDepositForm} setF={setEditDepositForm} />
          {editDepositError && <p className="text-red-500 text-sm">{editDepositError}</p>}
          <button onClick={handleEditDeposit} disabled={editDepositSubmitting} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
            {editDepositSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
