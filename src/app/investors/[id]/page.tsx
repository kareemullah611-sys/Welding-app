"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter, useParams } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { Modal, formatNumber } from "@/components/ui";
import { ArrowLeft, Plus, TrendingUp, ArrowDownCircle, ArrowUpCircle, Trash2, PiggyBank, Wallet } from "lucide-react";

type EntryType = "deposit" | "withdrawal" | "profit";

const TYPE_META: Record<EntryType, { label: string; color: string; bg: string; icon: React.ReactNode; sign: string }> = {
  deposit:    { label: "Deposit",          color: "text-blue-700",   bg: "bg-blue-50",   icon: <ArrowDownCircle size={15} />,  sign: "+" },
  withdrawal: { label: "Withdrawal",       color: "text-red-600",    bg: "bg-red-50",    icon: <ArrowUpCircle size={15} />,   sign: "−" },
  profit:     { label: "Profit Allocated", color: "text-emerald-700",bg: "bg-emerald-50",icon: <TrendingUp size={15} />,      sign: "+" },
};

function fmt(n: number) { return formatNumber(n); }

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`flex-1 rounded-2xl px-4 py-3 ${color}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-0.5">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

export default function InvestorLedgerPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [investor, setInvestor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeAccIdx, setActiveAccIdx] = useState(0);

  // Transaction modal
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<EntryType>("deposit");
  const [txForm, setTxForm] = useState({ amount: "", date: new Date().toISOString().split("T")[0], notes: "", periodStart: "", periodEnd: "" });
  const [txError, setTxError] = useState("");
  const [txSubmitting, setTxSubmitting] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ type: EntryType; id: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const acc = investor?.accounts?.[activeAccIdx];
  const sym = acc?.currency?.symbol ?? "";

  const openTx = (type: EntryType) => {
    setTxType(type);
    setTxForm({ amount: "", date: new Date().toISOString().split("T")[0], notes: "", periodStart: "", periodEnd: "" });
    setTxError("");
    setShowTx(true);
  };

  const handleTx = async () => {
    setTxError("");
    if (!txForm.amount || parseFloat(txForm.amount) <= 0) { setTxError("Enter a valid amount"); return; }
    if (txType === "profit" && (!txForm.periodStart || !txForm.periodEnd)) { setTxError("Enter period start and end dates"); return; }

    setTxSubmitting(true);
    const res = await apiCall(`/api/v1/investors/${id}/transactions`, {
      method: "POST",
      body: { type: txType, accountId: acc.id, amount: parseFloat(txForm.amount), date: txForm.date, notes: txForm.notes, periodStart: txForm.periodStart, periodEnd: txForm.periodEnd },
    });
    setTxSubmitting(false);
    if (res.success) { setShowTx(false); load(); }
    else setTxError(res.error || "Failed to record transaction");
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
  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;
  if (!investor) return null;

  const projectedLabel = acc?.projectedProfit != null
    ? `Projected profit this year: ${sym} ${fmt(acc.projectedProfit)}`
    : null;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Back + header */}
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
            {investor.relationship && <p className="text-sm text-gray-400">{investor.relationship}{investor.phone ? ` · ${investor.phone}` : ""}</p>}
          </div>
        </div>
      </div>

      {/* Account tabs (if multiple currencies) */}
      {investor.accounts.length > 1 && (
        <div className="flex gap-2">
          {investor.accounts.map((a: any, i: number) => (
            <button key={a.id} onClick={() => setActiveAccIdx(i)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeAccIdx === i ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {a.currency.code}
            </button>
          ))}
        </div>
      )}

      {acc && (
        <>
          {/* Balance summary */}
          <div className="flex gap-3">
            <StatPill label="Capital" value={`${sym} ${fmt(acc.capital)}`} color="bg-blue-50 text-blue-800" />
            <StatPill label="Profits" value={`${sym} ${fmt(acc.totalProfits)}`} color="bg-emerald-50 text-emerald-800" />
            <StatPill label="Balance" value={`${sym} ${fmt(acc.balance)}`} color="bg-violet-50 text-violet-800" />
          </div>

          {/* Rate info + projected profit */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <PiggyBank size={16} className="text-violet-400" />
              <span>
                {acc.profitType === "fixed_rate"
                  ? <><strong>{acc.fixedRatePercent}%</strong> fixed annual rate</>
                  : <><strong>{acc.profitSharePercent}%</strong> of business profit</>}
              </span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400 text-xs">Since {acc.startDate}</span>
            </div>
            {projectedLabel && (
              <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">{projectedLabel}</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {(["deposit", "withdrawal", "profit"] as EntryType[]).map(t => {
              const m = TYPE_META[t];
              return (
                <button key={t} onClick={() => openTx(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium border transition-all ${m.bg} ${m.color} border-transparent hover:shadow-sm`}>
                  <Plus size={14} />
                  {t === "profit" ? "Add Profit" : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              );
            })}
          </div>

          {/* Ledger entries */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">Transaction Ledger</h2>
              <span className="text-xs text-gray-400">{acc.entries.length} entries</span>
            </div>

            {acc.entries.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Wallet size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No transactions yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {[...acc.entries].reverse().map((e: any, i: number) => {
                  const m = TYPE_META[e.type as EntryType];
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 group transition-colors">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.bg} ${m.color}`}>
                        {m.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${m.bg} ${m.color}`}>{m.label}</span>
                          <span className="text-xs text-gray-400">{e.date}</span>
                        </div>
                        {e.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{e.notes}</p>}
                        <p className="text-[10px] text-gray-300 mt-0.5">
                          Capital: {sym} {fmt(e.runningCapital)} · Balance: {sym} {fmt(e.runningBalance)}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`font-bold text-sm ${e.type === "withdrawal" ? "text-red-600" : "text-emerald-600"}`}>
                          {m.sign} {sym} {fmt(e.amount)}
                        </p>
                      </div>
                      <button
                        onClick={() => setDeleteTarget({ type: e.type as EntryType, id: e.id })}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-50 rounded-lg ml-1">
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

      {/* ── Transaction Modal ── */}
      <Modal open={showTx} onClose={() => setShowTx(false)} title={`Record ${txType.charAt(0).toUpperCase() + txType.slice(1)}`} size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount ({sym}) *</label>
            <input type="number" min="0" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={txForm.amount} onChange={e => setTxForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
            <input type="date"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={txForm.date} onChange={e => setTxForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          {txType === "profit" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Period Start *</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  value={txForm.periodStart} onChange={e => setTxForm(p => ({ ...p, periodStart: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Period End *</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                  value={txForm.periodEnd} onChange={e => setTxForm(p => ({ ...p, periodEnd: e.target.value }))} />
              </div>
            </div>
          )}
          {txType === "withdrawal" && acc && (
            <div className="bg-amber-50 rounded-xl px-3 py-2">
              <p className="text-xs text-amber-700">
                Current capital: <strong>{sym} {fmt(acc.capital)}</strong>. Withdrawal reduces invested capital.
              </p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
              value={txForm.notes} onChange={e => setTxForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional note…" />
          </div>
          {txError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{txError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowTx(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={handleTx} disabled={txSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
              {txSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm ── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Transaction" size="sm">
        <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this transaction? This cannot be undone.</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
