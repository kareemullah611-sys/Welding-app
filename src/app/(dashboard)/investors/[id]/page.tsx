"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOffline } from "@/hooks/useOffline";
import { useRouter, useParams } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { formatNumber } from "@/components/ui";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import {
  ArrowLeft, ArrowDownCircle, ArrowUpCircle, Trash2, CheckCircle2, Pencil,
} from "lucide-react";

type TxType = "deposit" | "withdrawal";

function fmt(n: number) { return formatNumber(n); }
function txLabel(type: TxType) { return type === "deposit" ? "Credit" : "Debit"; }

const INVESTOR_LEDGER_READ_CACHE_KEY_PREFIX = "mrf-investor-ledger-read-cache-v1";

export default function InvestorLedgerPage() {
  const { user } = useAuth();
  const { isOnline, enqueue } = useOffline();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [investor, setInvestor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [amountError, setAmountError] = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ type: TxType; id: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit transaction
  const [editTarget, setEditTarget] = useState<{ type: TxType; id: number; amount: string; date: string; notes: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  // Single entry form
  const emptyForm = () => ({
    type: "deposit" as TxType,
    amount: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [form, setForm] = useState(emptyForm());

  const snapshotKey = `${INVESTOR_LEDGER_READ_CACHE_KEY_PREFIX}:${id}`;

  const persistSnapshot = useCallback((nextInvestor: any) => {
    if (!nextInvestor) return;
    writeOfflineReadSnapshot(snapshotKey, nextInvestor);
  }, [snapshotKey]);

  const patchInvestorAccount = useCallback((updater: (acc: any) => any) => {
    setInvestor((prev: any) => {
      if (!prev?.accounts?.[0]) return prev;
      const nextAcc = updater(prev.accounts[0]);
      const next = { ...prev, accounts: [nextAcc] };
      persistSnapshot(next);
      return next;
    });
  }, [persistSnapshot]);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiCall(`/api/v1/investors/${id}`);
    if (res.success) {
      setInvestor(res.data);
      persistSnapshot(res.data);
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<any>(snapshotKey)?.data;
      if (snapshot) {
        setInvestor(snapshot);
        setShowOfflineSnapshot(true);
      } else {
        router.push("/investors");
      }
    } else router.push("/investors");
    setLoading(false);
  }, [id, isOnline, persistSnapshot, router, snapshotKey]);

  useEffect(() => { load(); }, [load]);

  const acc = investor?.accounts?.[0];
  const sym = acc?.currency?.symbol ?? "";

  const handleSave = async () => {
    setSaveError("");
    setSaveSuccess(false);
    setAmountError("");
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setAmountError("Enter a valid amount");
      return;
    }
    if (!acc) return;
    const parsedAmount = parseFloat(form.amount);
    const payload = {
      type: form.type,
      accountId: acc.id,
      amount: parsedAmount,
      date: form.date,
      notes: form.notes,
    };
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/investors/${id}/transactions`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        pathname: `/investors/${id}`,
        auditMeta: {
          action: "create",
          entityType: "investor_transaction",
          entityLabel: "Investor Transaction (Pending)",
          entityDetail: `${txLabel(form.type)} ${parsedAmount}`,
        },
      });
      patchInvestorAccount((prevAcc: any) => {
        const delta = form.type === "deposit" ? parsedAmount : -parsedAmount;
        const nextCapital = Number(prevAcc.capital || 0) + delta;
        const nextEntries = [...(prevAcc.entries || []), {
          id: `pending-${Date.now()}`,
          type: form.type,
          amount: parsedAmount,
          date: form.date,
          notes: form.notes,
          runningBalance: nextCapital,
          _pending: true,
        }];
        return {
          ...prevAcc,
          entries: nextEntries,
          capital: nextCapital,
          totalDeposits: Number(prevAcc.totalDeposits || 0) + (form.type === "deposit" ? parsedAmount : 0),
          totalWithdrawals: Number(prevAcc.totalWithdrawals || 0) + (form.type === "withdrawal" ? parsedAmount : 0),
        };
      });
      setSaveSuccess(true);
      setForm(emptyForm());
      setTimeout(() => setSaveSuccess(false), 3000);
      return;
    }
    setSaving(true);
    const res = await apiCall(`/api/v1/investors/${id}/transactions`, {
      method: "POST",
      body: payload,
    });
    setSaving(false);
    if ((res as any).success === false) {
      setSaveError((res as any).error || "Failed to save");
      return;
    }
    setSaveSuccess(true);
    setForm(emptyForm());
    load();
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editTarget.amount || parseFloat(editTarget.amount) <= 0) { setEditError("Enter a valid amount"); return; }
    const parsedAmount = parseFloat(editTarget.amount);
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/investors/${id}/transactions`,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: editTarget.type, transactionId: editTarget.id, amount: parsedAmount, date: editTarget.date, notes: editTarget.notes }),
        pathname: `/investors/${id}`,
        auditMeta: {
          action: "update",
          entityType: "investor_transaction",
          entityLabel: "Investor Transaction Update (Pending)",
          entityDetail: `${txLabel(editTarget.type)} ${parsedAmount}`,
        },
      });
      patchInvestorAccount((prevAcc: any) => {
        const entries = [...(prevAcc.entries || [])];
        const idx = entries.findIndex((entry: any) => String(entry.id) === String(editTarget.id));
        if (idx >= 0) {
          entries[idx] = { ...entries[idx], amount: parsedAmount, date: editTarget.date, notes: editTarget.notes, _pending: true };
        }
        return { ...prevAcc, entries };
      });
      setEditTarget(null);
      return;
    }
    setEditSaving(true);
    setEditError("");
    const res = await apiCall(`/api/v1/investors/${id}/transactions`, {
      method: "PATCH",
      body: { type: editTarget.type, transactionId: editTarget.id, amount: parseFloat(editTarget.amount), date: editTarget.date, notes: editTarget.notes },
    });
    setEditSaving(false);
    if ((res as any).success === false) { setEditError((res as any).error || "Failed to update"); return; }
    setEditTarget(null);
    load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/investors/${id}/transactions`,
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: deleteTarget.type, transactionId: deleteTarget.id }),
        pathname: `/investors/${id}`,
        auditMeta: {
          action: "delete",
          entityType: "investor_transaction",
          entityLabel: "Investor Transaction Delete (Pending)",
          entityDetail: String(deleteTarget.id),
        },
      });
      patchInvestorAccount((prevAcc: any) => {
        const nextEntries = (prevAcc.entries || []).filter((entry: any) => String(entry.id) !== String(deleteTarget.id));
        return { ...prevAcc, entries: nextEntries };
      });
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    await apiCall(`/api/v1/investors/${id}/transactions`, {
      method: "DELETE",
      body: { type: deleteTarget.type, transactionId: deleteTarget.id },
    });
    setDeleting(false);
    setDeleteTarget(null);
    load();
  };

  if (!user || user.role !== "super_admin") return null;
  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!investor) return null;

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      {showOfflineSnapshot && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/investors")}
          className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} className="text-gray-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl shadow">
            {investor.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{investor.name}</h1>
            <p className="text-sm text-gray-400">
              {["Investor Ledger", investor.relationship, investor.phone].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {acc && (
        <>
          {/* ── Balance summary ── */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide mb-0.5">Total Credits</p>
              <p className="text-base font-bold text-blue-800">{sym} {fmt(acc.totalDeposits)}</p>
            </div>
            <div className="bg-red-50 rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-0.5">Total Debits</p>
              <p className="text-base font-bold text-red-800">{sym} {fmt(acc.totalWithdrawals)}</p>
            </div>
            <div className="bg-emerald-50 rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-0.5">Closing Balance</p>
              <p className="text-base font-bold text-emerald-800">{sym} {fmt(acc.capital)}</p>
            </div>
          </div>

          {/* ── Entry form ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 text-sm">Record Ledger Entry</h2>

            {/* Type toggle */}
            <div className="flex bg-gray-100 rounded-xl p-1 w-fit">
              <button
                onClick={() => setForm(p => ({ ...p, type: "deposit" }))}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  form.type === "deposit"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <ArrowDownCircle size={15} /> Credit Entry
              </button>
              <button
                onClick={() => setForm(p => ({ ...p, type: "withdrawal" }))}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  form.type === "withdrawal"
                    ? "bg-red-500 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <ArrowUpCircle size={15} /> Debit Entry
              </button>
            </div>

            {/* Amount + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount ({sym}) *</label>
                <input
                  type="number" min="0" step="0.01"
                  className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none transition-colors ${
                    amountError
                      ? "border-red-300 bg-red-50 focus:border-red-400"
                      : "border-gray-200 focus:border-violet-400"
                  }`}
                  value={form.amount}
                  onChange={e => { setForm(p => ({ ...p, amount: e.target.value })); setAmountError(""); }}
                  placeholder="0.00"
                />
                {amountError && <p className="text-[10px] text-red-500 mt-0.5">{amountError}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date *</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  value={form.date}
                  onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Narration</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder={form.type === "deposit" ? "e.g. capital introduced by investor" : "e.g. capital withdrawn by investor"}
              />
            </div>

            {/* Save */}
            <div className="flex items-center gap-3 pt-1">
              {saveSuccess && (
                <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                  <CheckCircle2 size={14} /> Entry recorded
                </div>
              )}
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <button
                onClick={handleSave}
                disabled={saving}
                className="ml-auto flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-6 py-2.5 rounded-xl shadow-sm disabled:opacity-50 transition-colors"
              >
                {saving
                  ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Recording…</>
                  : "Record Entry"
                }
              </button>
            </div>
          </div>

          {/* ── Transaction History ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">Ledger History</h2>
              <span className="text-xs text-gray-400">{acc.entries.length} entries</span>
            </div>

            {acc.entries.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">No ledger entries available.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {[...acc.entries].reverse().map((e: any, i: number) => {
                  const isDeposit = e.type === "deposit";
                  const label = isDeposit ? "Credit Entry" : "Debit Entry";
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/60 group transition-colors">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isDeposit ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-500"
                      }`}>
                        {isDeposit ? <ArrowDownCircle size={16} /> : <ArrowUpCircle size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            isDeposit ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-600"
                          }`}>
                            {label}
                          </span>
                          <span className="text-xs text-gray-400">{e.date}</span>
                        </div>
                        {e.notes && <p className="text-xs text-gray-500 mt-0.5 truncate">{e.notes}</p>}
                        <p className="text-[10px] text-gray-300 mt-0.5">Running balance: {sym} {fmt(e.runningBalance)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold text-sm ${isDeposit ? "text-blue-700" : "text-red-600"}`}>
                          {isDeposit ? "+" : "−"} {sym} {fmt(e.amount)}
                        </p>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 ml-1">
                        <button
                          onClick={() => {
                            setEditTarget({ type: e.type as TxType, id: e.id, amount: String(e.amount), date: e.date, notes: e.notes ?? "" });
                            setEditError("");
                          }}
                          className="p-1.5 hover:bg-violet-50 rounded-lg"
                        >
                          <Pencil size={13} className="text-violet-400" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ type: e.type as TxType, id: e.id })}
                          className="p-1.5 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={13} className="text-red-400" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Edit transaction ── */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-gray-900">Edit {txLabel(editTarget.type)}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount ({sym}) *</label>
                <input
                  type="number" min="0" step="0.01"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  value={editTarget.amount}
                  onChange={e => setEditTarget(p => p ? { ...p, amount: e.target.value } : p)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date *</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  value={editTarget.date}
                  onChange={e => setEditTarget(p => p ? { ...p, date: e.target.value } : p)}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={editTarget.notes}
                onChange={e => setEditTarget(p => p ? { ...p, notes: e.target.value } : p)}
              />
            </div>
            {editError && <p className="text-xs text-red-500">{editError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleEditSave} disabled={editSaving} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Delete Transaction</h3>
            <p className="text-sm text-gray-500 mb-5">Are you sure? This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
