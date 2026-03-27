"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, Modal, formatNumber, StatsCard } from "@/components/ui";
import { Plus, Users, ChevronRight, Edit2, Search } from "lucide-react";

function fmt(n: number, symbol = "") {
  return (symbol ? symbol + " " : "") + formatNumber(n);
}

function InvestorCard({ inv, onOpen, onEdit }: { inv: any; onOpen: () => void; onEdit: () => void }) {
  const mainAcc = inv.accounts[0];
  const sym = mainAcc?.currency?.symbol ?? "";
  const totalCapital = inv.accounts.reduce((s: number, a: any) => s + a.capital, 0);

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98]"
      onClick={onOpen}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow">
              {inv.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-[15px] leading-tight">{inv.name}</h3>
              {inv.relationship && <p className="text-xs text-gray-400">{inv.relationship}</p>}
              {inv.phone && <p className="text-xs text-gray-400">{inv.phone}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Edit2 size={14} className="text-gray-400" />
            </button>
            <ChevronRight size={16} className="text-gray-300" />
          </div>
        </div>

        {/* Balance */}
        <div className="bg-emerald-50 rounded-xl p-3 text-center">
          <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide mb-0.5">Balance</p>
          <p className="text-base font-bold text-emerald-700">{fmt(totalCapital, sym)}</p>
        </div>
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
  const [search, setSearch] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const defaultForm = {
    name: "", relationship: "", phone: "", notes: "",
    currencyId: "",
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
      apiCall("/api/v1/investors", { params: { limit: 200 } }),
      apiCall("/api/v1/currencies"),
    ]);
    if (invRes.success) setInvestors(invRes.data as any[]);
    if (curRes.success) setCurrencies(curRes.data as any[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filtered list
  const filtered = investors.filter(inv =>
    inv.name.toLowerCase().includes(search.toLowerCase()) ||
    (inv.relationship || "").toLowerCase().includes(search.toLowerCase()) ||
    (inv.phone || "").includes(search)
  );

  const totalCapitalAll = investors.reduce((s, inv) => s + inv.accounts.reduce((a: number, acc: any) => a + acc.capital, 0), 0);

  const f = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    setFormError("");
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    if (!form.currencyId) { setFormError("Select a currency"); return; }
    setSubmitting(true);
    const res = await apiCall("/api/v1/investors", {
      method: "POST",
      body: { ...form, profitType: "fixed_rate" }, // default, not used in UI
    });
    setSubmitting(false);
    if (res.success) { setShowCreate(false); setForm(defaultForm); load(); }
    else setFormError((res as any).error || "Failed to create investor");
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
    else setFormError((res as any).error || "Failed to update");
  };

  const openEdit = (inv: any) => {
    setEditTarget(inv);
    setForm({ ...defaultForm, name: inv.name, relationship: inv.relationship || "", phone: inv.phone || "", notes: inv.notes || "" });
    setFormError("");
    setShowEdit(true);
  };

  if (!user || user.role !== "super_admin") return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investors"
        subtitle="Track family investment accounts and balances"
        action={
          <button
            onClick={() => { setForm(defaultForm); setFormError(""); setShowCreate(true); }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-sm transition-colors"
          >
            <Plus size={15} /> Add Investor
          </button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard title="Net Balance" value={formatNumber(totalCapitalAll)} icon="💰" color="green" />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name, relationship or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-violet-400 shadow-sm"
        />
      </div>

      {/* Cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-44 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">{search ? "No results found" : "No investors yet"}</p>
          {!search && <p className="text-sm mt-1">Add your first investor to start tracking</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(inv => (
            <InvestorCard
              key={inv.id}
              inv={inv}
              onOpen={() => router.push(`/investors/${inv.id}`)}
              onEdit={() => openEdit(inv)}
            />
          ))}
        </div>
      )}

      {/* ── Create Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Investor" size="md">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={form.name} onChange={e => f("name", e.target.value)} placeholder="e.g. Ahmed Khan"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={form.relationship} onChange={e => f("relationship", e.target.value)} placeholder="e.g. Uncle"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={form.phone} onChange={e => f("phone", e.target.value)} placeholder="+92…"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Currency *</label>
              <select
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={form.currencyId} onChange={e => f("currencyId", e.target.value)}
              >
                <option value="">Select…</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
                value={form.startDate} onChange={e => f("startDate", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Initial Deposit (optional)</label>
            <input
              type="number" min="0"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={form.initialDeposit} onChange={e => f("initialDeposit", e.target.value)} placeholder="0"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 resize-none"
              value={form.notes} onChange={e => f("notes", e.target.value)}
            />
          </div>
          {formError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
          <div className="flex gap-2 pt-1">
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
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={form.name} onChange={e => f("name", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Relationship</label>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
              value={form.relationship} onChange={e => f("relationship", e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
            <input className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400"
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
