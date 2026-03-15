"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, Modal, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

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

  useEffect(() => { loadInventory(); }, [loadInventory]);

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
    </div>
  );
}
