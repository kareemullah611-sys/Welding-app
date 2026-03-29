"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber, formatDate } from "@/components/ui";

export default function ShippingLinesPage() {
  const { user } = useAuth();
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [payForm, setPayForm] = useState({ paymentDate: new Date().toISOString().split("T")[0], amountUsd: "", exchangeRate: "", reference: "", notes: "" });

  // Add charge (lot cost)
  const [showCharge, setShowCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({ lotId: "", description: "Freight", amount: "", costDate: new Date().toISOString().split("T")[0], notes: "" });
  const [lots, setLots] = useState<any[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/shipping-lines", { params: { limit: 100 } });
    if (r.success) setLines(r.data as any[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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
    if (r.success) setLedger(r.data);
    setLedgerLoading(false);
  };

  const openAddPayment = async (sl: any) => {
    setSelected(sl);
    setPayForm({ paymentDate: new Date().toISOString().split("T")[0], amountUsd: "", exchangeRate: "", reference: "", notes: "" });
    setError(""); setShowPayment(true);
  };

  const handleAddPayment = async () => {
    if (!payForm.amountUsd || Number(payForm.amountUsd) <= 0) { setError("Amount required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/shipping-line-payments", {
      method: "POST",
      body: {
        shippingLineId: selected.id,
        paymentDate:    payForm.paymentDate,
        amountUsd:      Number(payForm.amountUsd),
        exchangeRate:   payForm.exchangeRate ? Number(payForm.exchangeRate) : null,
        reference:      payForm.reference || null,
        notes:          payForm.notes || null,
      },
    });
    setSubmitting(false);
    if (r.success) { setShowPayment(false); load(); if (showLedger) openLedger(selected); }
    else { setError(r.error || "Failed"); }
  };

  const openAddCharge = async (sl: any) => {
    setSelected(sl);
    if (!lots.length) {
      const lr = await apiCall("/api/v1/lots", { params: { limit: 100 } });
      if (lr.success) setLots(lr.data as any[]);
    }
    setChargeForm({ lotId: "", description: "Freight", amount: "", costDate: new Date().toISOString().split("T")[0], notes: "" });
    setError(""); setShowCharge(true);
  };

  const handleAddCharge = async () => {
    if (!chargeForm.lotId || !chargeForm.amount || Number(chargeForm.amount) <= 0) { setError("Lot and amount required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/lot-costs", {
      method: "POST",
      body: {
        lotId:         Number(chargeForm.lotId),
        costType:      "freight",
        description:   chargeForm.description,
        amount:        Number(chargeForm.amount),
        currencyCode:  "USD",
        costDate:      chargeForm.costDate,
        shippingLineId: selected.id,
        notes:         chargeForm.notes || null,
      },
    });
    setSubmitting(false);
    if (r.success) { setShowCharge(false); load(); } else { setError(r.error || "Failed"); }
  };

  if (user?.role !== "super_admin") return <div className="p-8 text-gray-400">Access restricted to Super Admin.</div>;

  const columns = [
    { key: "name",    label: "Name",    render: (sl: any) => <span className="font-semibold text-gray-800">{sl.name}</span> },
    { key: "contact", label: "Contact", render: (sl: any) => <span className="text-sm text-gray-500">{sl.contact || "—"}</span> },
    { key: "billed",  label: "Total Billed (USD)", render: (sl: any) => <span className="font-mono text-sm">${formatNumber(sl.billedUsd || 0)}</span> },
    { key: "paid",    label: "Total Paid (USD)",   render: (sl: any) => <span className="font-mono text-sm text-green-700">${formatNumber(sl.paidUsd || 0)}</span> },
    { key: "balance", label: "Balance Owed (USD)", render: (sl: any) => {
      const bal = sl.balanceOwedUsd || 0;
      return <span className={`font-mono text-sm font-semibold ${bal > 0 ? "text-red-600" : "text-green-600"}`}>${formatNumber(Math.abs(bal))}{bal > 0 ? " owed" : bal < 0 ? " overpaid" : " clear"}</span>;
    }},
    { key: "actions", label: "Actions", render: (sl: any) => (
      <div className="flex items-center gap-1 flex-wrap">
        <button onClick={() => openLedger(sl)} className="px-2 py-1 text-xs rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200">Ledger</button>
        <button onClick={() => openAddPayment(sl)} className="px-2 py-1 text-xs rounded bg-green-50 text-green-700 hover:bg-green-100 border border-green-200">+ Payment</button>
        <button onClick={() => openAddCharge(sl)} className="px-2 py-1 text-xs rounded bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200">+ Charge</button>
        <button onClick={() => openEdit(sl)} className="px-2 py-1 text-xs rounded bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200">Edit</button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title="Shipping Lines" subtitle="Freight carrier running balances (USD)"
        action={<button onClick={openCreate} className="btn-primary text-sm">+ Add Shipping Line</button>} />

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
          <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
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
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Save"}</button>
        </div>
      </Modal>

      {/* ── Add Payment ── */}
      <Modal open={showPayment} onClose={() => setShowPayment(false)} title={`Record Payment — ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Amount USD *</label>
              <input type="number" value={payForm.amountUsd} onChange={e => setPayForm(f => ({ ...f, amountUsd: e.target.value }))} className="input-field" placeholder="0.00" min="0.01" step="0.01" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">USD/PKR Rate</label>
              <input type="number" value={payForm.exchangeRate} onChange={e => setPayForm(f => ({ ...f, exchangeRate: e.target.value }))} className="input-field" placeholder="e.g. 278.50" min="0.01" step="0.01" />
            </div>
            <div className="flex flex-col justify-end">
              {payForm.amountUsd && payForm.exchangeRate && (
                <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                  PKR equiv: <strong>Rs. {(Number(payForm.amountUsd) * Number(payForm.exchangeRate)).toLocaleString("en-US", { maximumFractionDigits: 0 })}</strong>
                </div>
              )}
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Reference / TT No.</label>
            <input value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowPayment(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleAddPayment} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Record Payment"}</button>
        </div>
      </Modal>

      {/* ── Add Freight Charge ── */}
      <Modal open={showCharge} onClose={() => setShowCharge(false)} title={`Add Freight Charge — ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Lot *</label>
            <select value={chargeForm.lotId} onChange={e => setChargeForm(f => ({ ...f, lotId: e.target.value }))} className="select-field">
              <option value="">Select lot</option>
              {lots.map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber} ({l.countryName})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input value={chargeForm.description} onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={chargeForm.costDate} onChange={e => setChargeForm(f => ({ ...f, costDate: e.target.value }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Amount USD *</label>
            <input type="number" value={chargeForm.amount} onChange={e => setChargeForm(f => ({ ...f, amount: e.target.value }))} className="input-field" placeholder="0.00" min="0.01" step="0.01" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={chargeForm.notes} onChange={e => setChargeForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCharge(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleAddCharge} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Add Charge"}</button>
        </div>
      </Modal>

      {/* ── Ledger ── */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Ledger — ${selected?.name || ""}`} size="xl">
        {ledgerLoading
          ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" /></div>
          : ledger ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatsCard title="Total Billed (USD)" value={`$${formatNumber(ledger.summary.totalBilledUsd)}`} icon="🚢" color="blue" />
              <StatsCard title="Total Paid (USD)"   value={`$${formatNumber(ledger.summary.totalPaidUsd)}`}   icon="💰" color="green" />
              <StatsCard title="Balance Owed (USD)" value={`$${formatNumber(ledger.summary.balanceOwedUsd)}`} icon="📋" color="red" />
            </div>

            {/* Charges */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-600">Freight Charges</h4>
                <button onClick={() => { setShowLedger(false); openAddCharge(selected); }} className="text-xs text-primary-600 hover:underline">+ Add Charge</button>
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
              ) : <p className="text-sm text-gray-400">No charges recorded</p>}
            </div>

            {/* Payments */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-600">Payments Made</h4>
                <button onClick={() => { setShowLedger(false); openAddPayment(selected); }} className="text-xs text-primary-600 hover:underline">+ Record Payment</button>
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
              ) : <p className="text-sm text-gray-400">No payments recorded</p>}
            </div>
          </div>
        ) : <p className="text-gray-400">Failed to load</p>}
      </Modal>
    </div>
  );
}
