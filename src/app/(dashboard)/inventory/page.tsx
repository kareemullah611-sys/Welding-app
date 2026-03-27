"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, Modal, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { Warehouse } from "lucide-react";

export default function InventoryPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);
  const [showApprove, setShowApprove] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [myGodowns, setMyGodowns] = useState<any[]>([]);
  const [approveForm, setApproveForm] = useState({ toGodownId: 0, approvalNotes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [approveError, setApproveError] = useState("");

  // Lot distributions for godown assignment
  const [lots, setLots] = useState<any[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  // Godown allocation modal
  const [showGodownAlloc, setShowGodownAlloc] = useState(false);
  const [godownAllocs, setGodownAllocs] = useState<any[]>([]);
  const [selectedDist, setSelectedDist] = useState<any>(null);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [godownSubmitting, setGodownSubmitting] = useState(false);
  const [godownError, setGodownError] = useState("");

  const loadInventory = useCallback(async () => {
    setLoading(true);
    const [invRes, trRes] = await Promise.all([
      apiCall("/api/v1/inventory"),
      apiCall("/api/v1/city-transfers", { params: { limit: 100 } }),
    ]);
    if (invRes.success) setData(invRes.data);
    if (trRes.success) {
      const pending = (trRes.data as any[]).filter(
        (tr: any) => tr.status === "pending" && tr.toCity?.id === user?.cityId
      );
      setPendingTransfers(pending);
    }
    setLoading(false);
  }, [user?.cityId]);

  const loadLots = useCallback(async () => {
    if (user?.role !== "city_admin") return;
    setLotsLoading(true);
    const r = await apiCall("/api/v1/lots", { params: { limit: 200 } });
    if (r.success) setLots(r.data as any[]);
    setLotsLoading(false);
  }, [user?.role]);

  useEffect(() => { loadInventory(); }, [loadInventory]);
  useEffect(() => { loadLots(); }, [loadLots]);

  const openApprove = async (tr: any) => {
    setSelected(tr);
    const gR = await apiCall("/api/v1/godowns", { params: { limit: 100 } });
    if (gR.success) setMyGodowns((gR.data as any[]).filter((g: any) => g.cityId === user?.cityId));
    setApproveForm({ toGodownId: 0, approvalNotes: "" });
    setShowApprove(true);
    setApproveError("");
  };

  const handleApprove = async () => {
    if (!approveForm.toGodownId) { setApproveError(t("select_godown")); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/city-transfers/${selected.id}`, {
      method: "PUT",
      body: { action: "approve", ...approveForm },
    });
    setSubmitting(false);
    if (r.success) { setShowApprove(false); loadInventory(); }
    else { setApproveError(r.error || "Failed"); }
  };

  const handleReject = async (tr: any) => {
    const reason = prompt(t("reason_for_rejection"));
    if (!reason) return;
    await apiCall(`/api/v1/city-transfers/${tr.id}`, {
      method: "PUT",
      body: { action: "reject", approvalNotes: reason },
    });
    loadInventory();
  };

  // ── Godown allocation ──────────────────────────────────────────────────────
  const openGodownAlloc = async (lot: any, dist: any) => {
    setSelectedDist(dist); setSelectedLot(lot); setGodownError("");
    const gRes = await apiCall("/api/v1/godowns", { params: { city_id: dist.cityId, limit: 50 } });
    const godowns = ((gRes.data || []) as any[]).filter((g: any) => g.isActive);
    const allocs: any[] = godowns.map((gd: any) => {
      const ex = dist.godownAllocations?.find((ga: any) => ga.godownId === gd.id);
      return { productId: dist.productId, productName: dist.productName, godownId: gd.id, godownName: gd.name, qty: ex?.qty || 0, maxQty: Number(dist.allocatedQty) };
    });
    setGodownAllocs(allocs); setShowGodownAlloc(true);
  };

  const godownEvenSplit = () => {
    if (!godownAllocs.length) return;
    const max = godownAllocs[0]?.maxQty || 0;
    const perGodown = Math.floor(max / godownAllocs.length);
    const remainder = max - perGodown * godownAllocs.length;
    setGodownAllocs(prev => prev.map((a, i) => ({ ...a, qty: perGodown + (i === 0 ? remainder : 0) })));
  };

  const godownAllToOne = (godownId: number) => {
    const max = godownAllocs[0]?.maxQty || 0;
    setGodownAllocs(prev => prev.map(a => ({ ...a, qty: a.godownId === godownId ? max : 0 })));
  };

  const handleGodownAlloc = async () => {
    setGodownSubmitting(true); setGodownError("");
    const totalAlloc = godownAllocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
    const maxQty = godownAllocs[0]?.maxQty || 0;
    if (totalAlloc > maxQty) { setGodownError(`Total ${totalAlloc} exceeds allocated qty ${maxQty}`); setGodownSubmitting(false); return; }
    const validAllocs = godownAllocs.filter(a => a.qty > 0).map(({ godownId, qty }: any) => ({ godownId, qty }));
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/godown-allocation`, {
      method: "POST",
      body: { cityId: selectedDist.cityId, productId: selectedDist.productId, allocations: validAllocs },
    });
    setGodownSubmitting(false);
    if (r.success) { setShowGodownAlloc(false); loadInventory(); loadLots(); }
    else { setGodownError(r.error || "Failed"); }
  };

  if (loading || !data) {
    return (
      <div>
        <PageHeader title={t("inventory")} subtitle={t("complete_stock_overview")} />
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("inventory")} subtitle={t("complete_stock_overview")} />

      {/* Pending Incoming City Transfers — notification banner */}
      {pendingTransfers.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl shadow-sm">
          <p className="text-sm font-semibold text-amber-800 mb-3">
            📦 {pendingTransfers.length} {t("incoming_transfers")} — {t("action_required") || "Action Required"}
          </p>
          <div className="space-y-2">
            {pendingTransfers.map((tr: any) => (
              <div key={tr.id} className="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-4 py-2.5 text-sm shadow-sm">
                <div>
                  <span className="font-medium text-gray-800">{tr.product?.name}</span>
                  <span className="text-gray-500 mx-1">×</span>
                  <span className="font-bold text-gray-900">{tr.qty}</span>
                  <span className="text-gray-400 ml-1">{t("cartons")}</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="text-gray-500">{t("from")} <strong className="text-gray-700">{tr.fromCity?.name}</strong></span>
                  {tr.fromGodown && (
                    <span className="text-xs text-gray-400 ml-1">({tr.fromGodown.name})</span>
                  )}
                  {tr.lot && (
                    <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">
                      {tr.lot.lotNumber}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 ml-4 shrink-0">
                  <button
                    onClick={() => openApprove(tr)}
                    className="text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    ✓ {t("approve")}
                  </button>
                  <button
                    onClick={() => handleReject(tr)}
                    className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-3 py-1.5 rounded-lg transition-colors border border-red-200"
                  >
                    ✗ {t("reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grand Total */}
      <div className="card mb-6 text-center">
        <p className="text-sm text-gray-500">{t("grand_total")}</p>
        <p className="text-4xl font-bold text-primary-600 mt-1">{formatNumber(data.grandTotalQty)}</p>
        <p className="text-xs text-gray-400 mt-1">{t("cartons_across_godowns")}</p>
      </div>

      {/* Product-wise Summary */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("stock_by_product")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.productsSummary?.map((p: any) => (
            <div key={p.productId} className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm font-medium text-gray-700 truncate">{p.productName}</p>
              <p className="text-xl font-bold text-gray-900">{formatNumber(p.totalQty)}</p>
            </div>
          ))}
          {(!data.productsSummary || data.productsSummary.length === 0) && (
            <p className="text-sm text-gray-400 col-span-full">{t("no_stock_data")}</p>
          )}
        </div>
      </div>

      {/* Godown-wise Summary */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("stock_by_godown")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data.godownsSummary?.map((g: any) => (
            <div key={g.godownId} className="bg-blue-50 rounded-lg p-3">
              <p className="text-sm font-medium text-blue-700 truncate">{g.godownName}</p>
              <p className="text-xs text-blue-500">{g.cityName}</p>
              <p className="text-xl font-bold text-blue-900 mt-1">{formatNumber(g.totalQty)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t("detailed_product_godown")}</h2>
        {data.detailed?.map((godown: any) => (
          <div key={godown.godownId} className="border border-gray-200 rounded-lg overflow-hidden mb-3">
            <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-900">{godown.godownName}</span>
                <span className="text-xs text-gray-500 ml-2">({godown.cityName})</span>
              </div>
              <span className="text-sm font-bold text-gray-700">{formatNumber(godown.totalQty)} {t("total")}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {godown.products.map((p: any) => (
                <div key={p.productId} className="px-4 py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{p.productName}</span>
                  <span className={`font-medium ${p.qty <= 0 ? "text-red-600" : "text-gray-900"}`}>
                    {formatNumber(p.qty)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Lot Distributions → Assign to Godowns (city_admin only) ── */}
      {user?.role === "city_admin" && (
        <div className="card mt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{t("assign_to_godowns") || "Assign to Godowns"}</h2>
          <p className="text-xs text-gray-400 mb-4">Lots distributed to your city — assign stock to your godowns.</p>
          {lotsLoading ? (
            <div className="py-6 flex justify-center"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
          ) : (() => {
            // Flatten all distributions for this city from all lots
            const rows: { lot: any; dist: any }[] = [];
            for (const lot of lots) {
              for (const dist of (lot.distributions || [])) {
                if (dist.cityId === user.cityId) rows.push({ lot, dist });
              }
            }
            if (!rows.length) return <p className="text-sm text-gray-400 py-4">{t("no_data")}</p>;
            return (
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
                {rows.map(({ lot, dist }, i) => {
                  const assigned = (dist.godownAllocations || []).reduce((s: number, ga: any) => s + Number(ga.qty), 0);
                  const remaining = Number(dist.allocatedQty) - assigned;
                  const isDone = remaining <= 0;
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">{dist.productName}</span>
                          <span className="text-xs font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">{lot.lotNumber}</span>
                          {isDone
                            ? <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100 font-medium">✓ Fully assigned</span>
                            : <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100 font-medium">{formatNumber(remaining)} unassigned</span>
                          }
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Allocated: <strong className="text-gray-600">{formatNumber(Number(dist.allocatedQty))}</strong>
                          {" · "}Assigned to godowns: <strong className="text-gray-600">{formatNumber(assigned)}</strong>
                        </p>
                      </div>
                      <button
                        onClick={() => openGodownAlloc(lot, dist)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-lg transition-colors flex-shrink-0"
                      >
                        <Warehouse size={13} /> {isDone ? "Re-assign" : "Assign"}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Approve Transfer Modal */}
      <Modal open={showApprove} onClose={() => setShowApprove(false)} title={t("approve_transfer")} size="md">
        {approveError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{approveError}</div>
        )}
        {selected && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
            {t("received")} <strong>{selected.qty} {t("cartons")}</strong> {t("of")}{" "}
            <strong>{selected.product?.name}</strong> {t("from")}{" "}
            <strong>{selected.fromCity?.name}</strong>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("store_in_godown")} *</label>
            <select
              value={approveForm.toGodownId}
              onChange={e => setApproveForm(f => ({ ...f, toGodownId: parseInt(e.target.value) }))}
              className="select-field"
            >
              <option value={0}>{t("select_godown")}</option>
              {myGodowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input
              value={approveForm.approvalNotes}
              onChange={e => setApproveForm(f => ({ ...f, approvalNotes: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowApprove(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleApprove} disabled={submitting} className="btn-primary text-sm">
            {submitting ? "..." : t("approve_receive")}
          </button>
        </div>
      </Modal>

      {/* ── Godown Allocation Modal ── */}
      <Modal open={showGodownAlloc} onClose={() => setShowGodownAlloc(false)} title={`${t("assign_to_godowns") || "Assign to Godowns"} — ${selectedLot?.lotNumber || ""}`} size="lg">
        {godownError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{godownError}</div>}
        {selectedDist && (
          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
            <strong>{selectedDist.productName}</strong> — Allocated: <strong>{formatNumber(Number(selectedDist.allocatedQty))}</strong> cartons
          </div>
        )}
        {godownAllocs.length > 0 ? (() => {
          const totalAlloc = godownAllocs.reduce((s, a) => s + (Number(a.qty) || 0), 0);
          const maxQty = godownAllocs[0]?.maxQty || 0;
          const remaining = maxQty - totalAlloc;
          const isOver = remaining < 0;
          const isDone = remaining === 0;
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-1">
                    <div className={`h-full rounded-full transition-all ${isOver ? "bg-red-500" : isDone ? "bg-green-500" : "bg-primary-500"}`}
                      style={{ width: `${Math.min(100, maxQty > 0 ? (totalAlloc / maxQty) * 100 : 0)}%` }} />
                  </div>
                  <span className={`text-xs font-semibold ${isOver ? "text-red-600" : isDone ? "text-green-600" : "text-gray-500"}`}>
                    {formatNumber(totalAlloc)} / {formatNumber(maxQty)} assigned
                    {isOver ? ` · ⚠ ${formatNumber(Math.abs(remaining))} over` : isDone ? " · ✓ Complete" : ` · ${formatNumber(remaining)} left`}
                  </span>
                </div>
                <button type="button" onClick={godownEvenSplit} className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 hover:border-primary-400 hover:text-primary-600 transition-colors">
                  ÷ Even Split
                </button>
                <button type="button" onClick={() => setGodownAllocs(prev => prev.map(a => ({ ...a, qty: 0 })))} className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 hover:border-red-300 hover:text-red-500 transition-colors">
                  ✕ Clear
                </button>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                <div className="flex items-center gap-3 text-xs font-semibold text-gray-400 pb-1.5 border-b px-1">
                  <span className="w-40">{t("godown")}</span><span className="w-28">{t("qty")}</span><span className="text-gray-300">Max</span>
                </div>
                {godownAllocs.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm px-1">
                    <span className="w-40 font-medium truncate text-gray-700">{a.godownName}</span>
                    <input type="number" value={a.qty || ""} min={0}
                      onChange={e => { const u = [...godownAllocs]; u[i] = { ...u[i], qty: parseFloat(e.target.value) || 0 }; setGodownAllocs(u); }}
                      className="input-field w-28" />
                    <span className="text-xs text-gray-400">/ {a.maxQty}</span>
                    <button type="button" onClick={() => godownAllToOne(a.godownId)} className="text-xs text-primary-500 hover:underline ml-auto">
                      All here
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })() : <p className="text-sm text-gray-400">{t("no_godowns")}</p>}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowGodownAlloc(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleGodownAlloc} disabled={godownSubmitting} className="btn-primary text-sm">{godownSubmitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
