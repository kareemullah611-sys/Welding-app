"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { formatNumber } from "@/components/ui";
import { ChevronRight, Users, Search, Pencil, Trash2, Plus } from "lucide-react";

type Investor = { id: number; name: string; relationship?: string; phone?: string; accounts: any[] };

export default function InvestorsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create investor
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "", relationship: "", phone: "", notes: "",
    startDate: new Date().toISOString().split("T")[0],
    initialDeposit: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit investor
  const [editTarget, setEditTarget] = useState<Investor | null>(null);
  const [editForm, setEditForm] = useState({ name: "", relationship: "", phone: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete investor
  const [deleteTarget, setDeleteTarget] = useState<Investor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const invRes = await apiCall("/api/v1/investors", { params: { limit: 200 } });
    if (invRes.success) setInvestors(invRes.data as any[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setCreateForm({
      name: "", relationship: "", phone: "", notes: "",
      startDate: new Date().toISOString().split("T")[0],
      initialDeposit: "",
    });
    setCreateError("");
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) { setCreateError("Name is required"); return; }
    if (!createForm.startDate) { setCreateError("Start date is required"); return; }
    setCreating(true); setCreateError("");
    const r = await apiCall("/api/v1/investors", { method: "POST", body: createForm });
    setCreating(false);
    if ((r as any).success === false) { setCreateError((r as any).error || "Failed to create investor"); return; }
    setShowCreate(false);
    load();
  };

  const openEdit = (inv: Investor, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTarget(inv);
    setEditForm({ name: inv.name, relationship: inv.relationship ?? "", phone: inv.phone ?? "" });
    setEditError("");
  };

  const handleEditSave = async () => {
    if (!editTarget || !editForm.name.trim()) { setEditError("Name is required"); return; }
    setEditSaving(true); setEditError("");
    const res = await apiCall(`/api/v1/investors/${editTarget.id}`, {
      method: "PATCH",
      body: { name: editForm.name.trim(), relationship: editForm.relationship.trim() || null, phone: editForm.phone.trim() || null },
    });
    setEditSaving(false);
    if ((res as any).success === false) { setEditError((res as any).error || "Failed to save"); return; }
    setEditTarget(null);
    load();
  };

  const openDelete = (inv: Investor, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(inv);
    setDeleteError("");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError("");
    const res = await apiCall(`/api/v1/investors/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    if ((res as any).success === false) { setDeleteError((res as any).error || "Failed to delete"); return; }
    setDeleteTarget(null);
    load();
  };

  if (!user || user.role !== "super_admin") return null;

  const filtered = investors.filter(inv =>
    inv.name.toLowerCase().includes(search.toLowerCase()) ||
    (inv.relationship ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (inv.phone ?? "").includes(search)
  );

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Investors</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={15} />
          New Investor
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name, relationship or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-white"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : investors.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No investors yet</p>
          <button onClick={openCreate} className="mt-3 text-sm text-violet-600 hover:underline">Add your first investor →</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Search size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No investors match &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
          {filtered.map(inv => {
            const capital = inv.accounts.reduce((s: number, a: any) => s + a.capital, 0);
            const sym = inv.accounts[0]?.currency?.symbol ?? "";
            return (
              <div
                key={inv.id}
                onClick={() => router.push(`/investors/${inv.id}`)}
                className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/70 transition-colors cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                  {inv.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{inv.name}</p>
                  {inv.relationship && <p className="text-xs text-gray-400">{inv.relationship}</p>}
                </div>
                <div className="text-right flex-shrink-0 mr-1">
                  <p className="text-sm font-bold text-emerald-700">{sym} {formatNumber(capital)}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Capital</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <button onClick={e => openEdit(inv, e)} className="p-1.5 rounded-lg hover:bg-violet-50 transition-colors">
                    <Pencil size={13} className="text-violet-400" />
                  </button>
                  <button onClick={e => openDelete(inv, e)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={13} className="text-red-400" />
                  </button>
                </div>
                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Investor Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full space-y-4 my-auto">
            <h3 className="font-semibold text-gray-900 text-lg">New Investor</h3>

            {/* Basic info */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Relationship</label>
                  <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.relationship} onChange={e => setCreateForm(p => ({ ...p, relationship: e.target.value }))} placeholder="Partner, Family…" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                  <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.phone} onChange={e => setCreateForm(p => ({ ...p, phone: e.target.value }))} placeholder="+92 300…" />
                </div>
              </div>
            </div>

            {/* Account setup */}
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Investment Account</p>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date *</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.startDate} onChange={e => setCreateForm(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Initial Deposit <span className="text-gray-300 font-normal">(optional)</span></label>
                <input type="number" step="0.01" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.initialDeposit} onChange={e => setCreateForm(p => ({ ...p, initialDeposit: e.target.value }))} placeholder="0" onWheel={e => e.currentTarget.blur()} />
              </div>
            </div>

            {createError && <p className="text-xs text-red-500">{createError}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
                {creating ? "Creating…" : "Create Investor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Investor Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-gray-900">Edit Investor</h3>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
              <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Relationship</label>
              <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={editForm.relationship} onChange={e => setEditForm(p => ({ ...p, relationship: e.target.value }))} placeholder="e.g. Partner, Family…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
              <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} placeholder="+92 300 0000000" />
            </div>
            {editError && <p className="text-xs text-red-500">{editError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleEditSave} disabled={editSaving} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Investor Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Delete Investor</h3>
            <p className="text-sm text-gray-500 mb-1">Delete <span className="font-medium text-gray-800">{deleteTarget.name}</span>?</p>
            <p className="text-xs text-gray-400 mb-4">Investors with existing transactions cannot be deleted.</p>
            {deleteError && <p className="text-xs text-red-500 mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setDeleteTarget(null); setDeleteError(""); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
