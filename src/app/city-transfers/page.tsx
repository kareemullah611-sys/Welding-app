"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function CityTransfersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showSend, setShowSend] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [godowns, setGodowns] = useState<any[]>([]);
  const [myGodowns, setMyGodowns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [form, setForm] = useState({ toCityId: 0, fromGodownId: 0, productId: 0, lotId: 0, qty: 0, notes: "", transferDate: new Date().toISOString().split("T")[0] });
  const [approveForm, setApproveForm] = useState({ toGodownId: 0, approvalNotes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/city-transfers", { params: { page, limit: 20 } });
    if (r.success) { setTransfers(r.data as any[]); setTotalPages((r.pagination as any)?.totalPages || 1); setTotal((r.pagination as any)?.total || 0); }
    setLoading(false);
  }, [page]);
  useEffect(() => { load(); }, [load]);

  const openSend = async () => {
    const [cR, gR, pR, lR] = await Promise.all([apiCall("/api/v1/cities", { params: { all: "true" } }), apiCall("/api/v1/godowns", { params: { limit: 100 } }), apiCall("/api/v1/products", { params: { limit: 100 } }), apiCall("/api/v1/lots", { params: { limit: 100 } })]);
    if (cR.success) setCities((cR.data as any[]).filter((c: any) => c.id !== user?.cityId));
    if (gR.success) setGodowns((gR.data as any[]).filter((g: any) => g.cityId === user?.cityId));
    if (pR.success) setProducts(pR.data as any[]);
    if (lR.success) setLots(lR.data as any[]);
    setForm({ toCityId: 0, fromGodownId: 0, productId: 0, lotId: 0, qty: 0, notes: "", transferDate: new Date().toISOString().split("T")[0] });
    setShowSend(true); setError("");
  };

  const handleSend = async () => {
    if (!form.toCityId || !form.fromGodownId || !form.productId || !form.qty) { setError(t("fill_required_fields")); return; }
    setSubmitting(true);
    const body: any = { ...form };
    if (!body.lotId) delete body.lotId;
    const r = await apiCall("/api/v1/city-transfers", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowSend(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openApprove = async (tr: any) => {
    setSelected(tr);
    const gR = await apiCall("/api/v1/godowns", { params: { limit: 100 } });
    if (gR.success) setMyGodowns((gR.data as any[]).filter((g: any) => g.cityId === user?.cityId));
    setApproveForm({ toGodownId: 0, approvalNotes: "" });
    setShowApprove(true); setError("");
  };

  const handleApprove = async () => {
    if (!approveForm.toGodownId) { setError(t("select_godown")); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/city-transfers/${selected.id}`, { method: "PUT", body: { action: "approve", ...approveForm } });
    setSubmitting(false);
    if (r.success) { setShowApprove(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleReject = async (tr: any) => {
    const reason = prompt(t("reason_for_rejection"));
    if (!reason) return;
    await apiCall(`/api/v1/city-transfers/${tr.id}`, { method: "PUT", body: { action: "reject", approvalNotes: reason } });
    load();
  };

  const pendingIncoming = transfers.filter(tr => tr.status === "pending" && tr.toCity?.id === user?.cityId);

  return (
    <div>
      <PageHeader title={t("city_transfers")} subtitle={`${total} ${t("transfers").toLowerCase()}`} action={user?.role === "city_admin" ? <button onClick={openSend} className="btn-primary text-sm">📦 {t("send_goods")}</button> : undefined} />

      {pendingIncoming.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm font-semibold text-yellow-800 mb-2">⏳ {pendingIncoming.length} {t("incoming_transfers")}</p>
          {pendingIncoming.map(tr => (
            <div key={tr.id} className="flex items-center justify-between bg-white p-2 rounded border mb-1 text-sm">
              <span>{tr.product?.name} × {tr.qty} {t("from")} <strong>{tr.fromCity?.name}</strong> ({tr.fromGodown?.name})</span>
              <div className="flex gap-2">
                <button onClick={() => openApprove(tr)} className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">✓ {t("approve")}</button>
                <button onClick={() => handleReject(tr)} className="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700">✗ {t("reject")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DataTable columns={[
        { key: "transferDate", label: t("date") },
        { key: "fromCity", label: t("from"), render: (tr: any) => <span>{tr.fromCity?.name} <span className="text-xs text-gray-400">({tr.fromGodown?.name})</span></span> },
        { key: "toCity", label: t("to"), render: (tr: any) => <span>{tr.toCity?.name} {tr.toGodown ? <span className="text-xs text-gray-400">({tr.toGodown.name})</span> : ""}</span> },
        { key: "product", label: t("product"), render: (tr: any) => tr.product?.name },
        { key: "qty", label: t("cartons"), render: (tr: any) => <span className="font-medium">{tr.qty}</span> },
        { key: "lot", label: t("lot"), render: (tr: any) => tr.lot?.lotNumber || "-" },
        { key: "status", label: t("status"), render: (tr: any) => <span className={`text-xs px-2 py-0.5 rounded font-medium ${tr.status === "approved" ? "bg-green-50 text-green-700" : tr.status === "rejected" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"}`}>{tr.status}</span> },
        { key: "sentBy", label: t("sent_by"), render: (tr: any) => tr.sentBy?.fullName },
        { key: "actions", label: "", render: (tr: any) => (
          tr.status === "pending" && tr.toCity?.id === user?.cityId ? (
            <div className="flex gap-1"><button onClick={() => openApprove(tr)} className="text-xs text-green-600 hover:underline">{t("approve")}</button><button onClick={() => handleReject(tr)} className="text-xs text-red-600 hover:underline">{t("reject")}</button></div>
          ) : null
        )},
      ]} data={transfers} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      {/* Send Modal */}
      <Modal open={showSend} onClose={() => setShowSend(false)} title={t("send_goods_to_city")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("to_city_label")} *</label><select value={form.toCityId} onChange={e => setForm(f => ({ ...f, toCityId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select_city")}</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("from_godown")} *</label><select value={form.fromGodownId} onChange={e => setForm(f => ({ ...f, fromGodownId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select")}</option>{godowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} *</label><select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select")}</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("cartons")} *</label><input type="number" value={form.qty || ""} onChange={e => setForm(f => ({ ...f, qty: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label><input type="date" value={form.transferDate} onChange={e => setForm(f => ({ ...f, transferDate: e.target.value }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">📦 {t("send_goods_note")}</div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowSend(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleSend} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("send")}</button></div>
      </Modal>

      {/* Approve Modal */}
      <Modal open={showApprove} onClose={() => setShowApprove(false)} title={t("approve_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        {selected && <div className="mb-3 p-2 bg-gray-50 rounded text-sm">{t("received")} <strong>{selected.qty} {t("cartons")}</strong> {t("of")} <strong>{selected.product?.name}</strong> {t("from")} <strong>{selected.fromCity?.name}</strong></div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("store_in_godown")} *</label><select value={approveForm.toGodownId} onChange={e => setApproveForm(f => ({ ...f, toGodownId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select_godown")}</option>{myGodowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={approveForm.approvalNotes} onChange={e => setApproveForm(f => ({ ...f, approvalNotes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowApprove(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleApprove} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("approve_receive")}</button></div>
      </Modal>
    </div>
  );
}
