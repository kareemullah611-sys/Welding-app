"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter, useParams } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { formatNumber } from "@/components/ui";
import {
  ArrowLeft, Plus, ArrowDownCircle, ArrowUpCircle,
  Trash2, CheckCircle2, X, Edit2,
} from "lucide-react";

type TxType = "deposit" | "withdrawal";

interface PendingEntry {
  type: TxType;
  amount: string;
  date: string;
  notes: string;
}

function fmt(n: number) { return formatNumber(n); }

export default function InvestorLedgerPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [investor, setInvestor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ type: TxType; id: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Batch entry state
  const emptyEntry = (): PendingEntry => ({
    type: "deposit",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [pending, setPending] = useState<PendingEntry[]>([emptyEntry()]);
  const [entryErrors, setEntryErrors] = useState<string[]>([""]);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiCall(`/api/v1/investors/${id}`);
    if (res.success) setInvestor(res.data);
    else router.push("/investors");
    setLoading(false);
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const acc = investor?.accounts?.[0];
  const sym = acc?.currency?.symbol ?? "";

  // ── Pending entries helpers ─────────────────────────────────────────────
  const updateEntry = (i: number, key: keyof PendingEntry, val: string) => {
    setPending(prev => prev.map((e, idx) => idx === i ? { ...e, [key]: val } : e));
    setEntryErrors(prev => prev.map((e, idx) => idx === i ? "" : e));
  };

  const addRow = () => {
    setPending(prev => [...prev, emptyEntry()]);
    setEntryErrors(prev => [...prev, ""]);
  };

  const removeRow = (i: number) => {
    if (pending.length === 1) return; // keep at least one row
    setPending(prev => prev.filter((_, idx) => idx !== i));
    setEntryErrors(prev => prev.filter((_, idx) => idx !== i));
  };

  // ── Save all pending ────────────────────────────────────────────────────
  const handleConfirm = async () => {
    setSaveError("");
    setSaveSuccess(false);

    // Validate
    let hasError = false;
    const errors = pending.map(e => {
      if (!e.amount || parseFloat(e.amount) <= 0) { hasError = true; return "Enter a valid amount"; }
      return "";
    });
    setEntryErrors(errors);
    if (hasError) return;

    if (!acc) return;

    setSaving(true);
    for (const entry of pending) {
      await apiCall(`/api/v1/investors/${id}/transactions`, {
        method: "POST",
        body: {
          type: entry.type,
          accountId: acc.id,
          amount: parseFloat(entry.amount),
          date: entry.date,
          notes: entry.notes,
        },
      });
    }
    setSaving(false);
    setSaveSuccess(true);
    setPending([emptyEntry()]);
    setEntryErrors([""]);
    load();
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // ── Delete a ledger entry ───────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
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
              {[investor.relationship, investor.phone].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {acc && (
        <>
          {/* ── Balance summary ── */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide mb-0.5">Deposited</p>
              <p className="text-base font-bold text-blue-800">{sym} {fmt(acc.totalDeposits)}</p>
            </div>
            <div className="bg-red-50 rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-0.5">Withdrawn</p>
              <p className="text-base font-bold text-red-800">{sym} {fmt(acc.totalWithdrawals)}</p>
            </div>
            <div className="bg-emerald-50 rounded-2xl px-4 py-3 text-center">
              <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide mb-0.5">Balance</p>
              <p className="text-base font-bold text-emerald-800">{sym} {fmt(acc.capital)}</p>
            </div>
          </div>

          {/* ══════════════════════════════════════════════
              BATCH ENTRY PANEL
          ══════════════════════════════════════════════ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
              <h2 className="font-semibold text-gray-800 text-sm">Record Transactions</h2>
              <button onClick={addRow}
                className="flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors">
                <Plus size={13} /> Add Row
              </button>
            </div>

            <div className="divide-y divide-gray-50">
              {pending.map((entry, i) => (
                <div key={i} className="px-4 py-3">
                  {/* Type toggle + delete row */}
                  <div className="flex items-center gap-2 mb-2">
                    {/* Type selector */}
                    <div className="flex bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
                      <button
                        onClick={() => updateEntry(i, "type", "deposit")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          entry.type === "deposit"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        }`}>
                        <ArrowDownCircle size={13} /> Deposit
                      </button>
                      <button
                        onClick={() => updateEntry(i, "type", "withdrawal")}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          entry.type === "withdrawal"
                            ? "bg-red-500 text-white shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        }`}>
                        <ArrowUpCircle size={13} /> Withdrawal
                      </button>
                    </div>

                    {/* Row number badge */}
                    <span className="ml-auto text-[10px] text-gray-300 font-medium">#{i + 1}</span>

                    {/* Remove row button */}
                    {pending.length > 1 && (
                      <button onClick={() => removeRow(i)}
                        className="p-1 hover:bg-red-50 rounded-md transition-colors">
                        <X size={14} className="text-red-400" />
                      </button>
                    )}
                  </div>

                  {/* Amount + Date row */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-1">
                        Amount ({sym}) *
                      </label>
                      <input
                        type="number" min="0" step="0.01"
                        className={`w-full border rounded-lg px-3 py-2 text-sm outline-none transition-colors ${
                          entryErrors[i]
                            ? "border-red-300 bg-red-50 focus:border-red-400"
                            : "border-gray-200 focus:border-violet-400"
                        }`}
                        value={entry.amount}
                        onChange={e => updateEntry(i, "amount", e.target.value)}
                        placeholder="0.00"
                      />
                      {entryErrors[i] && (
                        <p className="text-[10px] text-red-500 mt-0.5">{entryErrors[i]}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-gray-500 mb-1">Date *</label>
                      <input
                        type="date"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
                        value={entry.date}
                        onChange={e => updateEntry(i, "date", e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 mb-1">
                      {entry.type === "deposit" ? "Details (investment / profit note)" : "Details (reason for withdrawal)"}
                    </label>
                    <input
                      type="text"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-violet-400"
                      value={entry.notes}
                      onChange={e => updateEntry(i, "notes", e.target.value)}
                      placeholder={entry.type === "deposit" ? "e.g. Annual profit 2025, or new investment…" : "e.g. Personal use, medical…"}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Confirm bar */}
            <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100 flex items-center gap-3">
              {saveSuccess && (
                <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                  <CheckCircle2 size={14} />
                  {pending.length > 1 ? "All entries saved!" : "Saved!"}
                </div>
              )}
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-gray-400">{pending.length} entr{pending.length === 1 ? "y" : "ies"} queued</span>
                <button
                  onClick={handleConfirm}
                  disabled={saving}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2 rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                  ) : (
                    <><CheckCircle2 size={15} /> Confirm &amp; Save</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════
              LEDGER
          ══════════════════════════════════════════════ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">Transaction History</h2>
              <span className="text-xs text-gray-400">{acc.entries.length} records</span>
            </div>

            {acc.entries.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">No transactions yet. Add one above.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {[...acc.entries].reverse().map((e: any, i: number) => {
                  const isDeposit = e.type === "deposit";
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/60 group transition-colors">
                      {/* Icon */}
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isDeposit ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-500"
                      }`}>
                        {isDeposit
                          ? <ArrowDownCircle size={16} />
                          : <ArrowUpCircle size={16} />}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            isDeposit ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-600"
                          }`}>
                            {isDeposit ? "Deposit" : "Withdrawal"}
                          </span>
                          <span className="text-xs text-gray-400">{e.date}</span>
                        </div>
                        {e.notes && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{e.notes}</p>
                        )}
                        <p className="text-[10px] text-gray-300 mt-0.5">
                          Balance after: {sym} {fmt(e.runningBalance)}
                        </p>
                      </div>

                      {/* Amount */}
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold text-sm ${isDeposit ? "text-blue-700" : "text-red-600"}`}>
                          {isDeposit ? "+" : "−"} {sym} {fmt(e.amount)}
                        </p>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => setDeleteTarget({ type: e.type as TxType, id: e.id })}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-50 rounded-lg ml-1"
                      >
                        <Trash2 size={13} className="text-red-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Delete confirm overlay ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Delete Transaction</h3>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
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
