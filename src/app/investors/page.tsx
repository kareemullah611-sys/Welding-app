"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, Modal, formatNumber, StatsCard } from "@/components/ui";
import { Plus, Users, ChevronRight, PiggyBank, Edit2 } from "lucide-react";

function fmt(n: number, symbol = "") {
  return (symbol ? symbol + " " : "") + formatNumber(n);
}

function InvestorCard({ inv, currencies, onOpen, onEdit }: { inv: any; currencies: any[]; onOpen: () => void; onEdit: () => void }) {
  const mainAcc = inv.accounts[0];
  const sym = mainAcc?.currency?.symbol ?? "";

  const totalCapital = inv.accounts.reduce((s: number, a: any) => s + a.capital, 0);
  const totalBalance = inv.accounts.reduce((s: number, a: any) => s + a.balance, 0);
  const totalProfits = inv.accounts.reduce((s: number, a: any) => s + a.totalProfits, 0);

  const profitLabel = mainAcc?.profitType === "fixed_rate"
    ? `${mainAcc.fixedRatePercent}% fixed/yr`
    : `${mainAcc?.profitSharePercent}% profit share`;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={onOpen}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow">
              {inv.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-[15px]">{inv.name}</h3>
              {inv.relationship && <p className="text-xs text-gray-400">{inv.relationship}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <Edit2 size={14} className="text-gray-400" />
            </button>
            <ChevronRight size={16} className="text-gray-300" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-blue-400 font-medium uppercase tracking-wide mb-0.5">Capital</p>
            <p className="text-sm font-bold text-blue-700">{fmt(totalCapital, sym)}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wide mb-0.5">Profits</p>
            <p className="text-sm font-bold text-emerald-700">{fmt(totalProfits, sym)}</p>
          </div>
          <div className="bg-violet-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-violet-400 font-medium uppercase tracking-wide mb-0.5">Balance</p>
            <p className="text-sm font-bold text-violet-700">{fmt(totalBalance, sym)}</p>
          </div>
        </div>

        {mainAcc && (
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">Rate: <span className="text-gray-600 font-medium">{profitLabel}</span></span>
            <span className="text-[11px] text-gray-400">Since {mainAcc.startDate}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InvestorsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [investors, setInvestors] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const defaultForm = {
    name: "", relationship: "", phone: "", notes: "",
    currencyId: "", profitType: "fixed_rate",
    fixedRatePercent: "", profitSharePercent: "",
    startDate: new Date().toISOString().split("T")[0],
    initialDeposit: "",
  };
  const [form, setForm] = useState<any>(defaultForm);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const [invRes, curRes] = await Promise.all([
      apiCall("/api/v1/investors", { params: { limit: 100 } }),
      apiCall("/api/v1/currencies"),
    ]);
    if (invRes.success) setInvestors(invRes.data as any[]);
    if (curRes.success) setCurrencies(curRes.data as any[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalCapitalAll = investors.reduce((s, inv) => s + inv.accounts.reduce((a: number, acc: any) => a + acc.capital, 0), 0);
  const totalProfitsAll = investors.reduce((s, inv) => s + inv.accounts.reduce((a: number, acc: any) => a + acc.totalProfits, 0), 0);
  const totalBalanceAll = investors.reduce((s, inv) => s + inv.accounts.reduce((a: number, acc: any) => a + acc.balance, 0), 0);

  const f = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    setFormError("");
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    if (!form.currencyId) { setFormError("Select a currency"); return; }
    if (form.profitType === "fixed_rate" && !form.fixedRatePercent) { setFormError("Enter fixed rate %"); return; }
    if (form.profitType === "profit_share" && !form.profitSharePercent) { setFormError("Enter profit share %"); return; }

    setSubmitting(true);
    const res = await apiCall("/api/v1/investors", { method: "POST", body: form });
    setSubmitting(false);
    if (res.success) { setShowCreate(false); setForm(defaultForm); load(); }
    else setFormError(res.error || "Failed to create investor");
  };

  const handleEdit = async () => {
    setFormError("");
    setSubmitting(true);
    const res = await apiCall(`/api/v1/investors/${editTarget.id}`, {
      method: "PATCH",
      body: { name: form.name, relationship: form.relationship, phone: form.phone, notes: form.notes },
    });
    setSubmitting(false);
    if (res.success) { setShowEdit(false); setEditTarget(null); load(); }
    else setFormError(res.error || "Failed to update");
  };

  const openEdit = (inv: any) => {
    setEditTarget(inv);
    setForm({ ...defaultForm, name: inv.name, relationship: inv.relationship || "", phone: inv.phone || "", notes: inv.notes || "" });
    setFormError("");
    setShowEdit(true);
  };

  if (!user || user.role !== "super_admin") return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investors"
        subtitle="Track family investment accounts, capital, and profit allocations"
        action={
          <button onClick={() => { setForm(defaultForm); setFormError(""); setShowCreate(true); }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-sm transition-colors">
            <Plus size={16} /> Add Investor
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard title="Total Capital" value={formatNumber(totalCapitalAll)} icon="🏦" color="blue" />
        <StatsCard title="Total Profits Paid" value={formatNumber(totalProfitsAll)} icon="📈" color="green" />
        <StatsCard title="Total Balance Owed" value={formatNumber(totalBalanceAll)} icon="💰" color="purple" />
      </div>

      {/* Investor cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : investors.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No investors yet</p>
          <p className="text-sm mt-1">Add your first investor to start tracking</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {investors.map(inv => (
            <InvestorCard
              key={inv.id}
              inv={inv}
              currencies={currencies}
              onOpen={() => router.push(`/investors/${inv.id}`)}
              onEdit={() => openEdit(inv)}
            />
          ))}
        </div>
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Investor" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                value={form.name} onChange={e => f("name", e.target.value)} placeholder="e.g. Ahmed Khan" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                value={form.relationship} onChange={e => f("relationship", e.target.value)} placeholder="e.g. Uncle" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                value={form.phone} onChange={e => f("phone", e.target.value)} placeholder="+92..." />
            </div>
          </div>

          <hr className="border-gray-100" />
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Account Settings</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Currency *</label>
              <select className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                value={form.currencyId} onChange={e => f("currencyId", e.target.value)}>
                <option value="">Select currency</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date *</label>
              <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                value={form.startDate} onChange={e => f("startDate", e.target.value)} />
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Profit Type *</label>
              <div className="flex gap-2">
                {[{ v: "fixed_rate", label: "Fixed Rate %" }, { v: "profit_share", label: "% of Business Profit" }].map(opt => (
                  <button key={opt.v} onClick={() => f("profitType", opt.v)}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-medium border transition-all ${form.profitType === opt.v ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-600 border-gray-200 hover:border-violet-300"}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {form.profitType === "fixed_rate" ? (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Annual Rate (%) *</label>
                <input type="number" min="0" step="0.1" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                  value={form.fixedRatePercent} onChange={e => f("fixedRatePercent", e.target.value)} placeholder="e.g. 12" />
                <p className="text-[11px] text-gray-400 mt-1">Profit = capital × {form.fixedRatePercent || "X"}% at year end</p>
              </div>
            ) : (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Share of Business Profit (%) *</label>
                <input type="number" min="0" step="0.1" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                  value={form.profitSharePercent} onChange={e => f("profitSharePercent", e.target.value)} placeholder="e.g. 5" />
                <p className="text-[11px] text-gray-400 mt-1">Gets {form.profitSharePercent || "X"}% of total business profit</p>
              </div>
            )}

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Initial Deposit (optional)</label>
              <input type="number" min="0" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
                value={form.initialDeposit} onChange={e => f("initialDeposit", e.target.value)} placeholder="0" />
            </div>
          </div>

          {formError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={handleCreate} disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
              {submitting ? "Saving…" : "Add Investor"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Investor" size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              value={form.name} onChange={e => f("name", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              value={form.relationship} onChange={e => f("relationship", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
              value={form.phone} onChange={e => f("phone", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
              value={form.notes} onChange={e => f("notes", e.target.value)} />
          </div>
          {formError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setShowEdit(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={handleEdit} disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
              {submitting ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
