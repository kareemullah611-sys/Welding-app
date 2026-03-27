"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter, useParams } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { formatNumber } from "@/components/ui";
import {
  ArrowLeft, ArrowDownCircle, ArrowUpCircle, Trash2, CheckCircle2,
} from "lucide-react";

type TxType = "deposit" | "withdrawal";

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
  const [amountError, setAmountError] = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ type: TxType; id: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Single entry form
  const emptyForm = () => ({
    type: "deposit" as TxType,
    amount: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [form, setForm] = useState(emptyForm());

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

  const handleSave = async () => {
    setSaveError("");
    setSaveSuccess(false);
    setAmountError("");
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setAmountError("Enter a valid amount");
      return;
    }
    if (!acc) return;
    setSaving(true);
    const res = await apiCall(`/api/v1/investors/${id}/transactions`, {
      method: "POST",
      body: {
        type: form.type,
        accountId: acc.id,
        amount: parseFloat(form.amount),
        date: form.date,
        notes: form.notes,
      },
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

          {/* ── Entry form ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 text-sm">Record Transaction</h2>

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
                <ArrowDownCircle size={15} /> Deposit
              </button>
              <button
                onClick={() => setForm(p => ({ ...p, type: "withdrawal" }))}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  form.type === "withdrawal"
                    ? "bg-red-500 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <ArrowUpCircle size={15} /> Withdrawal
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
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                placeholder={form.type === "deposit" ? "e.g. Annual profit, new investment…" : "e.g. Personal use, medical…"}
              />
            </div>

            {/* Save */}
            <div className="flex items-center gap-3 pt-1">
              {saveSuccess && (
                <div className="flex items-center gap-1.5 text-emerald-600 text-xs font-medium">
                  <CheckCircle2 size={14} /> Saved!
                </div>
              )}
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
              <button
                onClick={handleSave}
                disabled={saving}
                className="ml-auto flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-6 py-2.5 rounded-xl shadow-sm disabled:opacity-50 transition-colors"
              >
                {saving
                  ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                  : "Save"
                }
              </button>
            </div>
          </div>

          {/* ── Transaction History ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">Transaction History</h2>
              <span className="text-xs text-gray-400">{acc.entries.length} records</span>
            </div>

            {acc.entries.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">No transactions yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {[...acc.entries].reverse().map((e: any, i: number) => {
                  const isDeposit = e.type === "deposit";
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
                            {isDeposit ? "Deposit" : "Withdrawal"}
                          </span>
                          <span className="text-xs text-gray-400">{e.date}</span>
                        </div>
                        {e.notes && <p className="text-xs text-gray-500 mt-0.5 truncate">{e.notes}</p>}
                        <p className="text-[10px] text-gray-300 mt-0.5">Balance after: {sym} {fmt(e.runningBalance)}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold text-sm ${isDeposit ? "text-blue-700" : "text-red-600"}`}>
                          {isDeposit ? "+" : "−"} {sym} {fmt(e.amount)}
                        </p>
                      </div>
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
