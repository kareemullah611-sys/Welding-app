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

  // Stock Ledger
  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerGodownId, setLedgerGodownId] = useState(0);
  const [ledgerProductId, setLedgerProductId] = useState(0);
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [godownList, setGodownList] = useState<any[]>([]);
  const [productList, setProductList] = useState<any[]>([]);

  // Inter-godown transfer
  const [showInterGodownTransfer, setShowInterGodownTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({
    fromGodownId: 0,
    toGodownId: 0,
    productId: 0,
    lotId: 0,
    qty: 0,
    transferDate: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [transferError, setTransferError] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [godownTransfers, setGodownTransfers] = useState<any[]>([]);
  const [transferHelpersLoading, setTransferHelpersLoading] = useState(false);

  // Godown allocation modal
  const [showGodownAlloc, setShowGodownAlloc] = useState(false);
  const [godownAllocs, setGodownAllocs] = useState<any[]>([]);
  const [selectedDist, setSelectedDist] = useState<any>(null);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [godownSubmitting, setGodownSubmitting] = useState(false);
  const [godownError, setGodownError] = useState("");

  const loadInventory = useCallback(async () => {
    setLoading(true);
    const [invRes, trRes, gdTrRes] = await Promise.all([
      apiCall("/api/v1/inventory"),
      apiCall("/api/v1/city-transfers", { params: { limit: 100 } }),
      apiCall("/api/v1/godowns/transfers", { params: { limit: 10 } }),
    ]);
    if (invRes.success) setData(invRes.data);
    if (trRes.success) {
      const pending = (trRes.data as any[]).filter(
        (tr: any) => tr.status === "pending" && tr.toCity?.id === user?.cityId
      );
      setPendingTransfers(pending);
    }
    if (gdTrRes.success) setGodownTransfers(gdTrRes.data as any[]);
    setLoading(false);
  }, [user?.cityId]);

  const loadLots = useCallback(async () => {
    if (user?.role !== "city_admin") return;
    setLotsLoading(true);
    const r = await apiCall("/api/v1/lots", { params: { limit: 200 } });
    if (r.success) setLots(r.data as any[]);
    setLotsLoading(false);
  }, [user?.role]);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    const params: any = { limit: 500 };
    if (ledgerGodownId) params.godown_id = ledgerGodownId;
    if (ledgerProductId) params.product_id = ledgerProductId;
    if (ledgerDateFrom) params.date_from = ledgerDateFrom;
    if (ledgerDateTo) params.date_to = ledgerDateTo;
    const r = await apiCall("/api/v1/inventory/stock-ledger", { params });
    if (r.success) setLedger(r.data as any[]);
    setLedgerLoading(false);
  }, [ledgerGodownId, ledgerProductId, ledgerDateFrom, ledgerDateTo]);

  const openLedger = async () => {
    setShowLedger(true);
    // Load godowns & products for filters
    const [gR, pR] = await Promise.all([
      apiCall("/api/v1/godowns", { params: { limit: 100 } }),
      apiCall("/api/v1/products", { params: { limit: 100 } }),
    ]);
    if (gR.success) setGodownList(gR.data as any[]);
    if (pR.success) setProductList(pR.data as any[]);
    await loadLedger();
  };

  const openInterGodownTransfer = async () => {
    setTransferHelpersLoading(true);
    setTransferError("");
    setTransferForm({
      fromGodownId: 0,
      toGodownId: 0,
      productId: 0,
      lotId: 0,
      qty: 0,
      transferDate: new Date().toISOString().split("T")[0],
      notes: "",
    });
    const [gR, pR, lR] = await Promise.all([
      apiCall("/api/v1/godowns", { params: { limit: 100 } }),
      apiCall("/api/v1/products", { params: { limit: 100 } }),
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
    ]);
    if (gR.success) setGodownList((gR.data as any[]).filter((g: any) => g.cityId === user?.cityId && g.isActive));
    if (pR.success) setProductList(pR.data as any[]);
    if (lR.success) setLots(lR.data as any[]);
    setTransferHelpersLoading(false);
    setShowInterGodownTransfer(true);
  };

  const handleInterGodownTransfer = async () => {
    setTransferError("");
    if (!transferForm.fromGodownId || !transferForm.toGodownId || !transferForm.productId || !(transferForm.qty > 0)) {
      setTransferError("Please select source godown, destination godown, product, and a positive quantity.");
      return;
    }
    if (transferForm.fromGodownId === transferForm.toGodownId) {
      setTransferError("Source and destination godown must be different.");
      return;
    }
    setTransferSubmitting(true);
    const body = {
      ...transferForm,
      lotId: transferForm.lotId || undefined,
    };
    const r = await apiCall("/api/v1/godowns/transfers", { method: "POST", body });
    setTransferSubmitting(false);
    if (r.success) {
      setShowInterGodownTransfer(false);
      await loadInventory();
    } else {
      setTransferError(r.error || "Failed to transfer stock");
    }
  };

  useEffect(() => { loadInventory(); }, [loadInventory]);
  useEffect(() => { loadLots(); }, [loadLots]);
  useEffect(() => { loadLedger(); }, [loadLedger]);

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
      <PageHeader
        title={t("inventory")}
        subtitle={t("complete_stock_overview")}
        action={
          <div className="flex items-center gap-2">
            {user?.role === "city_admin" && (
              <button onClick={openInterGodownTransfer} className="btn-primary text-sm flex items-center gap-2">
                ↔ Inter-Godown Transfer
              </button>
            )}
          </div>
        }
      />

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

      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Stock Position</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Godown</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Product</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Current Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.detailed?.flatMap((godown: any) => godown.products.map((p: any) => ({ godownName: godown.godownName, cityName: godown.cityName, productName: p.productName, qty: p.qty, productId: p.productId })))
                .sort((a: any, b: any) => b.qty - a.qty)
                .map((row: any, index: number) => (
                  <tr key={`${row.godownName}-${row.productId}-${index}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{row.godownName}</div>
                      <div className="text-xs text-gray-400">{row.cityName}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.productName}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatNumber(row.qty)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
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

      {user?.role === "city_admin" && (
        <div className="card mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Recent Inter-Godown Transfers</h2>
              <p className="text-xs text-gray-400">Move stock between godowns in your city from one clear place.</p>
            </div>
            <button onClick={openInterGodownTransfer} className="btn-secondary text-sm">
              + New Transfer
            </button>
          </div>
          {godownTransfers.length === 0 ? (
            <p className="text-sm text-gray-400">No inter-godown transfers recorded yet.</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
              {godownTransfers.map((tr: any) => (
                <div key={tr.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">{tr.product}</span>
                      <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">{tr.lotNumber}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {tr.fromGodown} → {tr.toGodown} · {tr.transferDate}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-900">{formatNumber(tr.qty)}</p>
                    <p className="text-xs text-gray-400">{t("cartons")}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card mt-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Stock Movement</h2>
          <button onClick={openLedger} className="btn-secondary text-sm">Filters</button>
        </div>
        {ledgerLoading ? (
          <div className="flex justify-center py-10"><div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
        ) : ledger.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No stock movements found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Product</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Godown</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-green-600">In</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-red-600">Out</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Running Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.slice(0, 150).map((row: any, index: number) => (
                  <tr key={`${row.reference}-${index}`}>
                    <td className="px-3 py-2">{row.date}</td>
                    <td className="px-3 py-2">{row.type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.reference}</td>
                    <td className="px-3 py-2">{row.productName}</td>
                    <td className="px-3 py-2">{row.godownName}</td>
                    <td className="px-3 py-2 text-right text-green-700">{row.qtyIn ? formatNumber(row.qtyIn) : "—"}</td>
                    <td className="px-3 py-2 text-right text-red-600">{row.qtyOut ? formatNumber(row.qtyOut) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatNumber(row.runningStock || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      <Modal open={showInterGodownTransfer} onClose={() => setShowInterGodownTransfer(false)} title="Inter-Godown Transfer" size="md">
        {transferError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{transferError}</div>
        )}
        {transferHelpersLoading ? (
          <div className="py-10 flex justify-center">
            <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="mb-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
              Move stock between your godowns without using the city transfer workflow.
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
                <input
                  type="date"
                  value={transferForm.transferDate}
                  onChange={e => setTransferForm((f) => ({ ...f, transferDate: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("from_godown")} *</label>
                  <select value={transferForm.fromGodownId} onChange={e => setTransferForm((f) => ({ ...f, fromGodownId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>{t("select_godown")}</option>
                    {godownList.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("store_in_godown")} *</label>
                  <select value={transferForm.toGodownId} onChange={e => setTransferForm((f) => ({ ...f, toGodownId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>{t("select_godown")}</option>
                    {godownList.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} *</label>
                  <select value={transferForm.productId} onChange={e => setTransferForm((f) => ({ ...f, productId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>{t("select")}</option>
                    {productList.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lot</label>
                  <select value={transferForm.lotId} onChange={e => setTransferForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>Auto-select FIFO lot</option>
                    {lots.filter((lot: any) => lot.status === "ongoing").map((lot: any) => <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("qty")} *</label>
                <input
                  type="number"
                  min="0.01"
                  value={transferForm.qty || ""}
                  onChange={e => setTransferForm((f) => ({ ...f, qty: parseFloat(e.target.value) || 0 }))}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
                <input
                  value={transferForm.notes}
                  onChange={e => setTransferForm((f) => ({ ...f, notes: e.target.value }))}
                  className="input-field"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
              <button onClick={() => setShowInterGodownTransfer(false)} className="btn-secondary text-sm">{t("cancel")}</button>
              <button onClick={handleInterGodownTransfer} disabled={transferSubmitting} className="btn-primary text-sm">
                {transferSubmitting ? "..." : "Transfer Stock"}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Stock Ledger Modal ── */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title="Stock Ledger" size="xl">
        {/* Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <select value={ledgerGodownId} onChange={e => setLedgerGodownId(parseInt(e.target.value))} className="select-field text-sm">
            <option value={0}>All Godowns</option>
            {godownList.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={ledgerProductId} onChange={e => setLedgerProductId(parseInt(e.target.value))} className="select-field text-sm">
            <option value={0}>All Products</option>
            {productList.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)} className="input-field text-sm" placeholder="From" />
          <input type="date" value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)} className="input-field text-sm" placeholder="To" />
        </div>
        <button onClick={loadLedger} className="btn-primary text-sm mb-4">Apply Filters</button>

        {ledgerLoading ? (
          <div className="flex justify-center py-10"><div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
        ) : ledger.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No stock movements found.</p>
        ) : (
          <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-24">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Ref</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Product</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Godown</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-green-600">IN</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-red-500">OUT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.map((row: any, i: number) => {
                  const typeLabel: Record<string, { label: string; color: string }> = {
                    allocation:    { label: "Allocation",      color: "bg-blue-50 text-blue-700"   },
                    sale:          { label: "Sale",            color: "bg-purple-50 text-purple-700" },
                    godown_in:     { label: "Godown In",       color: "bg-teal-50 text-teal-700"   },
                    godown_out:    { label: "Godown Out",      color: "bg-orange-50 text-orange-700" },
                    city_in:       { label: "City Transfer In",  color: "bg-green-50 text-green-700" },
                    city_out:      { label: "City Transfer Out", color: "bg-red-50 text-red-600"   },
                  };
                  const { label, color } = typeLabel[row.type] || { label: row.type, color: "bg-gray-50 text-gray-600" };
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs whitespace-nowrap">{row.date}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.reference}</td>
                      <td className="px-3 py-2 text-gray-800 font-medium">{row.productName}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{row.godownName}<span className="text-gray-400 ml-1">({row.cityName})</span></td>
                      <td className="px-3 py-2 text-right font-semibold text-green-600">{row.qtyIn > 0 ? `+${row.qtyIn.toLocaleString()}` : ""}</td>
                      <td className="px-3 py-2 text-right font-semibold text-red-500">{row.qtyOut > 0 ? `-${row.qtyOut.toLocaleString()}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
