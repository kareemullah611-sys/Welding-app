"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber, formatDate } from "@/components/ui";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

const SHIPPING_LINES_READ_CACHE_KEY = "mrf-shipping-lines-read-cache-v1";

type ShippingLinesReadSnapshot = {
  lines: any[];
  ledgerByLine: Record<string, any>;
  bankAccounts: any[];
  intermediaries: any[];
};

export default function ShippingLinesPage() {
  const { user } = useAuth();
  const { isOnline } = useOffline();
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", contact: "", notes: "" });

  // Edit
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", contact: "", notes: "" });
  const [selected, setSelected] = useState<any>(null);

  // Ledger
  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Add payment
  const [showPayment, setShowPayment] = useState(false);
  const [payForm, setPayForm] = useState({ paymentDate: new Date().toISOString().split("T")[0], amountUsd: "", exchangeRate: "", reference: "", notes: "", paidFrom: "bank", bankAccountId: "", intermediaryId: "" });
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<ShippingLinesReadSnapshot>(SHIPPING_LINES_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<ShippingLinesReadSnapshot>) => {
    const existing = readSnapshot()?.data || { lines: [], ledgerByLine: {}, bankAccounts: [], intermediaries: [] };
    writeOfflineReadSnapshot<ShippingLinesReadSnapshot>(SHIPPING_LINES_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      ledgerByLine: { ...(existing.ledgerByLine || {}), ...(partial.ledgerByLine || {}) },
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/shipping-lines", { params: { limit: 100 } });
    if (r.success) {
      setLines(r.data as any[]);
      mergeSnapshot({ lines: r.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.lines?.length) {
        setLines(snapshot.lines);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, readSnapshot]);
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

  const openCreate = () => { setCreateForm({ name: "", contact: "", notes: "" }); setError(""); setShowCreate(true); };

  const handleCreate = async () => {
    if (!createForm.name.trim()) { setError("Name required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/shipping-lines", { method: "POST", body: createForm });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (sl: any) => {
    setSelected(sl);
    setEditForm({ name: sl.name, contact: sl.contact || "", notes: sl.notes || "" });
    setError(""); setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!editForm.name.trim()) { setError("Name required"); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/shipping-lines/${selected.id}`, { method: "PUT", body: editForm });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openLedger = async (sl: any) => {
    setSelected(sl); setShowLedger(true); setLedger(null); setLedgerLoading(true);
    const r = await apiCall(`/api/v1/shipping-lines/${sl.id}`);
    if (r.success) {
      setLedger(r.data);
      mergeSnapshot({ ledgerByLine: { [String(sl.id)]: r.data } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cached = snapshot?.ledgerByLine?.[String(sl.id)];
      if (cached) {
        setLedger(cached);
        setShowOfflineSnapshot(true);
      }
    }
    setLedgerLoading(false);
  };

  const openAddPayment = async (sl: any) => {
    setSelected(sl);
    setPayForm({ paymentDate: new Date().toISOString().split("T")[0], amountUsd: "", exchangeRate: "", reference: "", notes: "", paidFrom: "bank", bankAccountId: "", intermediaryId: "" });
    setError(""); setShowPayment(true);
    // Load bank accounts and intermediaries
    const [baRes, intRes] = await Promise.all([
      bankAccounts.length ? Promise.resolve({ success: true, data: bankAccounts }) : apiCall("/api/v1/bank-accounts", { params: { limit: 100 } }),
      intermediaries.length ? Promise.resolve({ success: true, data: intermediaries }) : apiCall("/api/v1/intermediaries"),
    ]);
    if (baRes.success) {
      const loadedBanks = (baRes.data as any).items || baRes.data as any[];
      setBankAccounts(loadedBanks);
      mergeSnapshot({ bankAccounts: loadedBanks });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.bankAccounts?.length) {
        setBankAccounts(snapshot.bankAccounts);
        setShowOfflineSnapshot(true);
      }
    }
    if (intRes.success) {
      setIntermediaries(intRes.data as any[]);
      mergeSnapshot({ intermediaries: intRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.intermediaries?.length) {
        setIntermediaries(snapshot.intermediaries);
        setShowOfflineSnapshot(true);
      }
    }
  };

  const handleAddPayment = async () => {
    if (!payForm.amountUsd || Number(payForm.amountUsd) <= 0) { setError("Amount required"); return; }
    if (payForm.paidFrom === "bank" && !payForm.bankAccountId) { setError("Select a bank account"); return; }
    if (payForm.paidFrom === "intermediary" && !payForm.intermediaryId) { setError("Select an intermediary"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/shipping-line-payments", {
      method: "POST",
      body: {
        shippingLineId: selected.id,
        paymentDate:    payForm.paymentDate,
        amountUsd:      Number(payForm.amountUsd),
        exchangeRate:   payForm.exchangeRate ? Number(payForm.exchangeRate) : null,
        bankAccountId:  payForm.paidFrom === "bank" && payForm.bankAccountId ? Number(payForm.bankAccountId) : null,
        intermediaryId: payForm.paidFrom === "intermediary" && payForm.intermediaryId ? Number(payForm.intermediaryId) : null,
        reference:      payForm.reference || null,
        notes:          payForm.notes || null,
      },
    });
    setSubmitting(false);
    if (r.success) { setShowPayment(false); load(); if (showLedger) openLedger(selected); }
    else { setError(r.error || "Failed"); }
  };

  if (user?.role !== "super_admin") return <div className="p-8 text-gray-400">Access restricted to Super Admin.</div>;

  const columns = [
    { key: "name",    label: "Name",    render: (sl: any) => <span className="font-semibold text-gray-800">{sl.name}</span> },
    { key: "contact", label: "Contact", render: (sl: any) => <span className="text-sm text-gray-500">{sl.contact || "—"}</span> },
    { key: "billed",  label: "Total Billed (USD)", render: (sl: any) => <span className="font-mono text-sm">${formatNumber(sl.billedUsd || 0)}</span> },
    { key: "paid",    label: "Total Paid (USD)",   render: (sl: any) => <span className="font-mono text-sm text-green-700">${formatNumber(sl.paidUsd || 0)}</span> },
    { key: "balance", label: "Balance Owed (USD)", render: (sl: any) => {
      const bal = sl.balanceOwedUsd || 0;
      return (
        <div className="space-y-1">
          <span className={`block font-mono text-sm font-semibold ${bal > 0 ? "text-red-600" : "text-green-600"}`}>${formatNumber(Math.abs(bal))}{bal > 0 ? " owed" : bal < 0 ? " overpaid" : " clear"}</span>
          {sl.hasNonUsdCharges && <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Additional non-USD charges on ledger</span>}
        </div>
      );
    }},
    {
      key: "actions", label: "",
      render: (sl: any) => (
        <div className="relative" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} data-action-menu-root="true">
          <button
            type="button"
            onPointerDown={(event) => { event.stopPropagation(); }}
            onClick={(event) => {
              event.stopPropagation();
              setActionMenuDirection("down");
              setOpenActionId((current) => current === sl.id ? null : sl.id);
            }}
            className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
            aria-label="Open actions"
          >
            ⋯
          </button>
          {openActionId === sl.id && (
            <div className={`absolute right-0 z-50 w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`}>
              <button onClick={() => { setOpenActionId(null); openLedger(sl); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">Open Ledger</button>
              <button onClick={() => { setOpenActionId(null); openAddPayment(sl); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-green-700 hover:bg-green-50">Record Settlement</button>
              <button onClick={() => { setOpenActionId(null); openEdit(sl); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">Edit</button>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Shipping Lines" subtitle="Professional freight ledger and settlement records (USD)"
        action={<button onClick={openCreate} className="btn-primary text-sm">+ Add Shipping Line</button>} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      {/* Summary cards */}
      {lines.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatsCard title="Total Billed (USD)" icon="🚢"
            value={`$${formatNumber(lines.reduce((s, l) => s + (l.billedUsd || 0), 0))}`} color="blue" />
          <StatsCard title="Total Paid (USD)" icon="💰"
            value={`$${formatNumber(lines.reduce((s, l) => s + (l.paidUsd || 0), 0))}`} color="green" />
          <StatsCard title="Balance Owed (USD)" icon="📋"
            value={`$${formatNumber(lines.reduce((s, l) => s + (l.balanceOwedUsd || 0), 0))}`} color="red" />
        </div>
      )}

      <DataTable columns={columns} data={lines} loading={loading} />

      {/* ── Create ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Shipping Line" size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} className="input-field" placeholder="e.g. COSCO, MSC, Evergreen" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
            <input value={createForm.contact} onChange={e => setCreateForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Create"}</button>
        </div>
      </Modal>

      {/* ── Edit ── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Shipping Line" size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact</label>
            <input value={editForm.contact} onChange={e => setEditForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Save"}</button>
        </div>
      </Modal>

      {/* ── Add Payment ── */}
      <Modal open={showPayment} onClose={() => setShowPayment(false)} title={`Record Settlement — ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Amount USD *</label>
              <input type="number" value={payForm.amountUsd} onChange={e => setPayForm(f => ({ ...f, amountUsd: e.target.value }))} className="input-field" placeholder="0.00" min="0.01" step="0.01" onWheel={e => e.currentTarget.blur()} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Settlement Exchange Rate</label>
              <input type="number" value={payForm.exchangeRate} onChange={e => setPayForm(f => ({ ...f, exchangeRate: e.target.value }))} className="input-field" placeholder="e.g. 278.50" min="0.01" step="0.01" onWheel={e => e.currentTarget.blur()} />
            </div>
            <div className="flex flex-col justify-end">
              {payForm.amountUsd && payForm.exchangeRate && (
                <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                  PKR equiv: <strong>Rs. {(Number(payForm.amountUsd) * Number(payForm.exchangeRate)).toLocaleString("en-US", { maximumFractionDigits: 0 })}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Paid From */}
          <div className="border rounded-lg p-3 bg-blue-50 border-blue-200 space-y-2">
            <label className="block text-sm font-semibold text-blue-800 mb-1">Settlement Source *</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="slPaidFrom" value="bank" checked={payForm.paidFrom === "bank"} onChange={() => setPayForm(f => ({ ...f, paidFrom: "bank", intermediaryId: "" }))} />
                Bank Ledger
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="slPaidFrom" value="intermediary" checked={payForm.paidFrom === "intermediary"} onChange={() => setPayForm(f => ({ ...f, paidFrom: "intermediary", bankAccountId: "" }))} />
                Intermediary Ledger
              </label>
            </div>
            {payForm.paidFrom === "bank" && (
              <select value={payForm.bankAccountId} onChange={e => setPayForm(f => ({ ...f, bankAccountId: e.target.value }))} className="select-field text-sm">
                <option value="">Select bank account</option>
                {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumber || ""}</option>)}
              </select>
            )}
            {payForm.paidFrom === "intermediary" && (
              <select value={payForm.intermediaryId} onChange={e => setPayForm(f => ({ ...f, intermediaryId: e.target.value }))} className="select-field text-sm">
                <option value="">Select intermediary</option>
                {intermediaries.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>

          <div><label className="block text-sm font-medium text-gray-700 mb-1">Reference / TT Number</label>
            <input value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Narration</label>
            <textarea value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleAddPayment} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Record Settlement"}</button>
        </div>
      </Modal>

      {/* ── Ledger ── */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Shipping Line Ledger — ${selected?.name || ""}`} size="xl">
        {ledgerLoading
          ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" /></div>
          : ledger ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatsCard title="Total Billed (USD)" value={`$${formatNumber(ledger.summary.totalBilledUsd)}`} icon="🚢" color="blue" />
              <StatsCard title="Total Paid (USD)"   value={`$${formatNumber(ledger.summary.totalPaidUsd)}`}   icon="💰" color="green" />
              <StatsCard title="Balance Owed (USD)" value={`$${formatNumber(ledger.summary.balanceOwedUsd)}`} icon="📋" color="red" />
            </div>
            {ledger.summary.hasNonUsdCharges && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Additional charge currencies recorded:
                {" "}
                {Object.entries(ledger.summary.billedByCurrency || {})
                  .filter(([currencyCode]) => currencyCode !== "USD")
                  .map(([currencyCode, amount]) => `${currencyCode} ${formatNumber(amount as number)}`)
                  .join(", ")}
              </div>
            )}

            {/* Charges */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-600">Freight Charge Entries</h4>
              </div>
              {ledger.charges.length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 border-b">
                    <th className="pb-1">Lot</th><th className="pb-1">Description</th><th className="pb-1">Date</th><th className="pb-1 text-right">Amount</th>
                  </tr></thead>
                  <tbody>{ledger.charges.map((c: any) => (
                    <tr key={c.id} className="border-b border-gray-50">
                      <td className="py-1 font-mono text-xs text-gray-500">{c.lotNumber}</td>
                      <td className="py-1">{c.description}</td>
                      <td className="py-1 text-gray-400 text-xs">{formatDate(c.costDate)}</td>
                      <td className="py-1 text-right font-medium text-red-700">${formatNumber(c.amount)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-sm text-gray-400">No charge entries recorded</p>}
            </div>

            {/* Payments */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-600">Settlement Entries</h4>
                <button onClick={() => { setShowLedger(false); openAddPayment(selected); }} className="text-xs text-primary-600 hover:underline">+ Record Settlement</button>
              </div>
              {ledger.payments.length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 border-b">
                    <th className="pb-1">Date</th><th className="pb-1">Lot</th><th className="pb-1">Reference</th>
                    <th className="pb-1 text-right">USD</th><th className="pb-1 text-right">Rate</th><th className="pb-1 text-right">PKR</th>
                  </tr></thead>
                  <tbody>{ledger.payments.map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-1">{formatDate(p.paymentDate)}</td>
                      <td className="py-1 font-mono text-xs text-gray-500">{p.lotNumber || "—"}</td>
                      <td className="py-1 text-gray-500 text-xs">{p.reference || "—"}</td>
                      <td className="py-1 text-right font-medium text-green-700">${formatNumber(p.amountUsd)}</td>
                      <td className="py-1 text-right text-gray-400 text-xs">{p.exchangeRate ? p.exchangeRate.toLocaleString() : "—"}</td>
                      <td className="py-1 text-right text-gray-600">{p.amountPkr ? `Rs. ${formatNumber(p.amountPkr)}` : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-sm text-gray-400">No settlement entries recorded</p>}
            </div>
          </div>
        ) : <p className="text-gray-400">Failed to load</p>}
      </Modal>
    </div>
  );
}
