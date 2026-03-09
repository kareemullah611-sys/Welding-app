"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, StatusBadge, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { Pencil, Package, CheckCircle, RotateCcw, Trash2, Warehouse } from "lucide-react";

export default function LotsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [lots, setLots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [countries, setCountries] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [createForm, setCreateForm] = useState({ countryId: 0, lotNumber: "", lotDate: new Date().toISOString().split("T")[0], notes: "", products: [{ productId: 0, totalQty: 0 }] as any[] });
  // Detail
  const [showDetail, setShowDetail] = useState(false);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Distribute
  const [showDistribute, setShowDistribute] = useState(false);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  // Godown alloc
  const [showGodownAlloc, setShowGodownAlloc] = useState(false);
  const [godownAllocs, setGodownAllocs] = useState<any[]>([]);
  const [selectedDist, setSelectedDist] = useState<any>(null);
  // Edit lot
  const [showEditLot, setShowEditLot] = useState(false);
  const [editLotData, setEditLotData] = useState<any>(null);
  const [editProducts, setEditProducts] = useState<any[]>([]);
  // Common
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const loadLots = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/lots", { params: { page, limit: 20 } });
    if (r.success) { setLots(r.data as any[]); setTotalPages((r.pagination as any)?.totalPages || 1); setTotal((r.pagination as any)?.total || 0); }
    setLoading(false);
  }, [page]);
  useEffect(() => { loadLots(); }, [loadLots]);

  // ========== CREATE ==========
  const openCreate = async () => {
    const [cRes, pRes] = await Promise.all([apiCall("/api/v1/countries"), apiCall("/api/v1/products", { params: { limit: 100 } })]);
    if (cRes.success) setCountries(cRes.data as any[]);
    if (pRes.success) setProducts(pRes.data as any[]);
    setCreateForm({ countryId: 0, lotNumber: "", lotDate: new Date().toISOString().split("T")[0], notes: "", products: [{ productId: 0, totalQty: 0 }] });
    setShowCreate(true); setFormError("");
  };
  const handleCreate = async () => {
    const validP = createForm.products.filter(p => p.productId > 0 && p.totalQty > 0);
    if (!createForm.countryId || !createForm.lotNumber || !validP.length) { setFormError("Fill country, lot number, and at least one product"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/lots", { method: "POST", body: { ...createForm, products: validP, distributions: [] } });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ========== DETAIL (with sales view) ==========
  const openDetail = async (lot: any) => {
    setSelectedLot(lot); setShowDetail(true); setDetailLoading(true); setFormError("");
    const r = await apiCall(`/api/v1/lots/${lot.id}`);
    if (r.success) { setSelectedLot(r.data); } else { setFormError(r.error || "Failed to load"); }
    setDetailLoading(false);
  };

  // ========== DISTRIBUTE ==========
  const openDistribute = async (lot: any) => {
    setSelectedLot(lot); setDistributions([]); setShowDistribute(true); setFormError(""); setDetailLoading(true);
    try {
      const [detailRes, cityRes] = await Promise.all([apiCall(`/api/v1/lots/${lot.id}`), apiCall("/api/v1/cities", { params: { all: "true" } })]);
      if (!detailRes.success) { setFormError("Failed to load: " + (detailRes.error || "")); setDetailLoading(false); return; }
      const ld = detailRes.data as any;
      setSelectedLot(ld);
      const allCities = (cityRes.data || []) as any[];
      const cc = allCities.filter((c: any) => c.countryId === ld.country?.id);
      if (!cc.length) { setFormError(`No cities for country ${ld.country?.name}`); setDetailLoading(false); return; }
      setCities(cc);
      const prods = ld.products || [];
      if (!prods.length) { setFormError("No products in this lot. Edit lot first to add products."); setDetailLoading(false); return; }
      const dists: any[] = [];
      for (const city of cc) { for (const prod of prods) {
        const ex = ld.distributions?.find((d: any) => d.cityId === city.id && d.productId === prod.productId);
        dists.push({ cityId: city.id, cityName: city.name, productId: prod.productId, productName: prod.productName, allocatedQty: ex?.allocatedQty || 0, maxQty: prod.totalQty });
      }}
      setDistributions(dists);
      // Auto-expand first product
      if (prods.length > 0) setExpandedProductId(prods[0].productId);
    } catch (e) { setFormError("Error loading"); }
    setDetailLoading(false);
  };
  const handleDistribute = async () => {
    setSubmitting(true); setFormError("");
    const validDists = distributions.filter(d => d.allocatedQty > 0).map(({ cityId, productId, allocatedQty }: any) => ({ cityId, productId, allocatedQty }));
    if (!validDists.length) { setFormError("Enter at least one allocation"); setSubmitting(false); return; }
    for (const prod of (selectedLot.products || [])) {
      const totalDist = distributions.filter((d: any) => d.productId === prod.productId).reduce((s: number, d: any) => s + (d.allocatedQty || 0), 0);
      if (totalDist > prod.totalQty) { setFormError(`${prod.productName}: distributed ${totalDist} > total ${prod.totalQty}`); setSubmitting(false); return; }
    }
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/distribute`, { method: "PUT", body: { distributions: validDists } });
    setSubmitting(false);
    if (r.success) { setShowDistribute(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ========== GODOWN ALLOCATION ==========
  const openGodownAlloc = async (lot: any, dist: any) => {
    setSelectedDist(dist); setSelectedLot(lot); setFormError("");
    const gRes = await apiCall("/api/v1/godowns", { params: { city_id: dist.cityId, limit: 50 } });
    const godowns = ((gRes.data || []) as any[]).filter((g: any) => g.isActive);
    const allocs: any[] = [];
    for (const prod of [dist]) {
      for (const gd of godowns) {
        const ex = prod.godownAllocations?.find((ga: any) => ga.godownId === gd.id);
        allocs.push({ productId: prod.productId, productName: prod.productName, godownId: gd.id, godownName: gd.name, qty: ex?.qty || 0, maxQty: Number(prod.allocatedQty) });
      }
    }
    setGodownAllocs(allocs); setShowGodownAlloc(true);
  };
  const handleGodownAlloc = async () => {
    setSubmitting(true); setFormError("");
    const validAllocs = godownAllocs.filter(a => a.qty > 0).map(({ godownId, qty }: any) => ({ godownId, qty }));
    const r = await apiCall(`/api/v1/lots/${selectedLot.id}/godown-allocation`, { method: "POST", body: { cityId: selectedDist.cityId, productId: selectedDist.productId, allocations: validAllocs } });
    setSubmitting(false);
    if (r.success) { setShowGodownAlloc(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ========== EDIT LOT ==========
  const openEditLot = async (lot: any) => {
    if (!products.length) { const pRes = await apiCall("/api/v1/products", { params: { limit: 100 } }); if (pRes.success) setProducts(pRes.data as any[]); }
    const r = await apiCall(`/api/v1/lots/${lot.id}`);
    if (!r.success) { alert("Failed to load lot"); return; }
    const d = r.data as any;
    setEditLotData(d);
    setEditProducts(d.products?.length ? d.products.map((p: any) => ({ productId: p.productId, totalQty: p.totalQty })) : [{ productId: 0, totalQty: 0 }]);
    setShowEditLot(true); setFormError("");
  };
  const handleEditLot = async () => {
    const validP = editProducts.filter(p => p.productId > 0 && p.totalQty > 0);
    if (!validP.length) { setFormError("Add at least one product"); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/lots/${editLotData.id}`, { method: "PUT", body: { lotNumber: editLotData.lotNumber, notes: editLotData.notes, products: validP } });
    setSubmitting(false);
    if (r.success) { setShowEditLot(false); loadLots(); } else { setFormError(r.error || "Failed"); }
  };

  // ========== DELETE / COMPLETE / REOPEN ==========
  const handleDeleteLot = async (lot: any) => {
    if (!confirm(`${lot.lotNumber}: ${t("confirm_delete")} ${t("cannot_undo")}`)) return;
    const r = await apiCall(`/api/v1/lots/${lot.id}`, { method: "DELETE" });
    if (r.success) loadLots(); else alert(r.error || "Failed - lot may have active sales");
  };
  const handleComplete = async (lot: any) => {
    if (!confirm(`${lot.lotNumber}: ${t("confirm_complete")}`)) return;
    const r = await apiCall(`/api/v1/lots/${lot.id}/complete`, { method: "PUT" });
    if (r.success) loadLots(); else alert(r.error || "Failed");
  };
  const handleReopen = async (lot: any) => {
    if (!confirm(`${lot.lotNumber}: ${t("confirm_reopen")}`)) return;
    const r = await apiCall(`/api/v1/lots/${lot.id}/reopen`, { method: "PUT" });
    if (r.success) loadLots(); else alert(r.error || "Failed");
  };

  const columns = [
    { key: "lotNumber", label: t("lot_num"), render: (l: any) => (
      <button onClick={() => openDetail(l)} className="font-mono font-semibold text-primary-600 hover:underline text-sm">{l.lotNumber}</button>
    )},
    { key: "country", label: t("country"), render: (l: any) => (
      <span className="text-sm text-gray-700">{l.countryName || l.country?.name}</span>
    )},
    { key: "lotDate", label: t("date"), render: (l: any) => (
      <span className="text-sm text-gray-500">{formatDate(l.lotDate)}</span>
    )},
    { key: "products", label: t("product"), render: (l: any) => (
      <div className="flex flex-wrap gap-1">
        {l.products?.map((p: any) => (
          <span key={p.productId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100 whitespace-nowrap">
            {p.productName} <span className="font-bold text-blue-900">{formatNumber(p.totalQty)}</span>
          </span>
        ))}
      </div>
    )},
    { key: "distribution", label: t("distribute"), render: (l: any) => {
      const count = l.distributions?.length || 0;
      if (!count) return <span className="inline-flex items-center px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded-full text-xs font-medium border border-yellow-100">{t("no_data")}</span>;
      const cities = Array.from(new Set(l.distributions.map((d: any) => d.cityName))).length;
      return <span className="inline-flex items-center px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100">{cities} {t("cities") || "cities"}</span>;
    }},
    { key: "status", label: t("status"), render: (l: any) => <StatusBadge status={l.status} /> },
    { key: "actions", label: t("actions"), render: (l: any) => (
      <div className="flex items-center gap-1 flex-wrap">
        {user?.role === "super_admin" && <>
          <button onClick={() => openEditLot(l)} title={t("edit")} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"><Pencil size={13} /></button>
          <button onClick={() => openDistribute(l)} title={t("distribute")} className="p-1.5 rounded-md hover:bg-blue-50 text-blue-500 hover:text-blue-700 transition-colors"><Package size={13} /></button>
          {l.status === "ongoing" && <button onClick={() => handleComplete(l)} title={t("confirm")} className="p-1.5 rounded-md hover:bg-green-50 text-green-500 hover:text-green-700 transition-colors"><CheckCircle size={13} /></button>}
          {l.status === "completed" && <button onClick={() => handleReopen(l)} title={t("reactivate")} className="p-1.5 rounded-md hover:bg-orange-50 text-orange-400 hover:text-orange-600 transition-colors"><RotateCcw size={13} /></button>}
          <button onClick={() => handleDeleteLot(l)} title={t("delete")} className="p-1.5 rounded-md hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
        </>}
        {user?.role === "city_admin" && l.distributions?.filter((d: any) => d.cityId === user.cityId).map((d: any, i: number) => (
          <button key={i} onClick={() => openGodownAlloc(l, d)} title={`${d.productName} → ${t("godown")}`} className="p-1.5 rounded-md hover:bg-teal-50 text-teal-500 hover:text-teal-700 transition-colors"><Warehouse size={13} /></button>
        ))}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title={t("lots")} subtitle={`${total} ${t("lots").toLowerCase()}`} action={user?.role === "super_admin" ? <button onClick={openCreate} className="btn-primary text-sm"> {"+ " + t("new_lot")}</button> : undefined} />
      <DataTable columns={columns} data={lots} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      {/* ========== CREATE LOT ========== */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_lot")} size="lg">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("country")} *</label><select value={createForm.countryId} onChange={e => setCreateForm(f => ({ ...f, countryId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select")}</option>{countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("lot_num")} *</label><input value={createForm.lotNumber} onChange={e => setCreateForm(f => ({ ...f, lotNumber: e.target.value }))} className="input-field" placeholder="e.g. LOT-2026-001" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><input type="date" value={createForm.lotDate} onChange={e => setCreateForm(f => ({ ...f, lotDate: e.target.value }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} & {t("cartons")}</label>
            {createForm.products.map((p, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <select value={p.productId} onChange={e => { const u = [...createForm.products]; u[i].productId = parseInt(e.target.value); setCreateForm(f => ({ ...f, products: u })); }} className="select-field flex-1"><option value={0}>{t("select_product")}</option>{products.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select>
                <input type="number" value={p.totalQty || ""} onChange={e => { const u = [...createForm.products]; u[i].totalQty = parseFloat(e.target.value) || 0; setCreateForm(f => ({ ...f, products: u })); }} className="input-field w-32" placeholder={t("cartons")} />
                {createForm.products.length > 1 && <button onClick={() => setCreateForm(f => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }))} className="text-red-500 text-lg">×</button>}
              </div>
            ))}
            <button onClick={() => setCreateForm(f => ({ ...f, products: [...f.products, { productId: 0, totalQty: 0 }] }))} className="text-primary-600 text-sm hover:underline">+ {t("add_item")}</button>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><textarea value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm"> {t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      {/* ========== LOT DETAIL (sales/costs view) ========== */}
      <Modal open={showDetail} onClose={() => setShowDetail(false)} title={`${t("lot")}: ${selectedLot?.lotNumber || ""}`} size="xl">
        {detailLoading ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-2" /><p className="text-sm text-gray-400">{t("loading")}</p></div> : selectedLot?.id ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatsCard title={t("total_sales")} value={formatNumber(selectedLot.summary?.totalSales || 0)} icon="🧾" color="green" />
              <StatsCard title={t("payments_received")} value={formatNumber(selectedLot.summary?.totalPayments || 0)} icon="💰" color="blue" />
              <StatsCard title={t("outstanding")} value={formatNumber(selectedLot.summary?.outstanding || 0)} icon="📋" color="red" />
              <StatsCard title={t("expenses")} value={formatNumber(selectedLot.summary?.totalExpenses || 0)} icon="💸" color="yellow" />
            </div>
            {selectedLot.costSummary && (
              <div className="card"><h4 className="text-sm font-semibold mb-2 text-gray-600">{t("cost_breakdown")}</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><span className="text-gray-500">{t("purchase_cost")} (USD):</span> <strong>${formatNumber(selectedLot.costSummary.totalPurchaseUsd || 0)}</strong></div>
                  <div><span className="text-gray-500">{t("additional_costs")}:</span> <strong>{formatNumber(selectedLot.costSummary.totalAdditionalCosts || 0)}</strong></div>
                  <div><span className="text-gray-500">{t("total_landed")}:</span> <strong>{formatNumber(selectedLot.costSummary.totalLanded || 0)}</strong></div>
                </div>
                {(selectedLot.costSummary.costBreakdown || []).length > 0 && (
                  <div className="mt-2 pt-2 border-t">{selectedLot.costSummary.costBreakdown.map((c: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs py-0.5"><span className="text-gray-500">{c.description} ({c.costType})</span><span>{c.currencyCode} {Number(c.amount).toLocaleString("en-US")}</span></div>
                  ))}</div>
                )}
              </div>
            )}
            {/* SALES TABLE */}
            <div className="card"><h4 className="text-sm font-semibold mb-2 text-gray-600">{t("sales")} ({(selectedLot.recentSales || []).length})</h4>
              {(selectedLot.recentSales || []).length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 border-b"><th className="pb-1">{t("date")}</th><th className="pb-1">{t("voucher")}</th><th className="pb-1">{t("customer")}</th><th className="pb-1">{t("items")}</th><th className="pb-1 text-right">{t("amount")}</th></tr></thead>
                  <tbody>{(selectedLot.recentSales || []).map((s: any) => (
                    <tr key={s.id} className="border-b border-gray-50">
                      <td className="py-1">{formatDate(s.saleDate)}</td>
                      <td className="py-1 font-mono text-xs">{s.voucherNo}</td>
                      <td className="py-1">{s.customer?.name}</td>
                      <td className="py-1 text-xs">{s.items?.map((it: any, j: number) => <div key={j}>{it.product?.name}: {Number(it.qty)} × {Number(it.amount)}</div>) || "-"}</td>
                      <td className="py-1 text-right font-medium text-green-700">{Number(s.totalAmount).toLocaleString("en-US")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-gray-400 text-sm">{t("no_data")}</p>}
            </div>
            {/* PAYMENTS TABLE */}
            <div className="card"><h4 className="text-sm font-semibold mb-2 text-gray-600">{t("payments")} ({(selectedLot.recentPayments || []).length})</h4>
              {(selectedLot.recentPayments || []).length > 0 ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 border-b"><th className="pb-1">{t("date")}</th><th className="pb-1">{t("customer")}</th><th className="pb-1">{t("detail")}</th><th className="pb-1 text-right">{t("amount")}</th></tr></thead>
                  <tbody>{(selectedLot.recentPayments || []).map((p: any) => (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-1">{formatDate(p.paymentDate)}</td><td className="py-1">{p.customer?.name}</td><td className="py-1 text-xs">{p.detail || "-"}</td>
                      <td className="py-1 text-right font-medium text-blue-700">{Number(p.amount).toLocaleString("en-US")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p className="text-gray-400 text-sm">{t("no_data")}</p>}
            </div>
          </div>
        ) : <p className="text-gray-400 py-4">{formError || t("no_data")}</p>}
      </Modal>

      {/* ========== DISTRIBUTE ========== */}
      <Modal open={showDistribute} onClose={() => setShowDistribute(false)} title={`${t("distribute")}: ${selectedLot?.lotNumber || ""}`} size="xl">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        {detailLoading ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-2" /><p className="text-sm text-gray-400">{t("loading")}</p></div> : <>
        <p className="text-sm text-gray-500 mb-4">Click on a product to expand and enter city quantities.</p>
        <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
          {(() => {
            const groups: Record<number, { productId: number; productName: string; maxQty: number; items: any[] }> = {};
            distributions.forEach((d: any, i: number) => {
              if (!groups[d.productId]) groups[d.productId] = { productId: d.productId, productName: d.productName, maxQty: d.maxQty, items: [] };
              groups[d.productId].items.push({ ...d, index: i });
            });
            return Object.values(groups).map((group) => {
              const totalAllocated = group.items.reduce((s: number, d: any) => s + (Number(d.allocatedQty) || 0), 0);
              const remaining = group.maxQty - totalAllocated;
              const pct = Math.min(100, group.maxQty > 0 ? (totalAllocated / group.maxQty) * 100 : 0);
              const isOver = remaining < 0;
              const isFullyDone = remaining === 0;
              const isExpanded = expandedProductId === group.productId;
              const badgeCls = isOver ? "bg-red-100 text-red-700 border-red-200" : isFullyDone ? "bg-green-100 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200";
              const barCls = isOver ? "bg-red-500" : isFullyDone ? "bg-green-500" : "bg-primary-500";
              return (
                <div key={group.productId} className={`border rounded-xl overflow-hidden transition-all ${isExpanded ? "border-primary-300 shadow-sm" : "border-gray-200"}`}>
                  {/* Clickable header */}
                  <button
                    type="button"
                    onClick={() => setExpandedProductId(isExpanded ? null : group.productId)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${isExpanded ? "bg-primary-50" : "bg-gray-50 hover:bg-gray-100"}`}
                  >
                    {/* Chevron */}
                    <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                    {/* Product name */}
                    <span className="font-semibold text-sm text-gray-800 w-24 shrink-0">{group.productName}</span>
                    {/* Progress bar */}
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-300 ${barCls}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-400">{formatNumber(totalAllocated)} / {formatNumber(group.maxQty)} cartons</span>
                    </div>
                    {/* Remaining badge */}
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${badgeCls}`}>
                      {isOver ? `⚠ ${formatNumber(Math.abs(remaining))} over` : isFullyDone ? "✓ Complete" : `${formatNumber(remaining)} left`}
                    </span>
                  </button>
                  {/* Expanded city rows */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100 bg-white">
                      {group.items.map((d: any) => (
                        <div key={d.index} className="flex items-center gap-4 px-5 py-3">
                          <span className="w-36 text-sm font-medium text-gray-700 shrink-0">{d.cityName}</span>
                          <input
                            type="number"
                            value={d.allocatedQty || ""}
                            onChange={e => { const u = [...distributions]; u[d.index] = { ...u[d.index], allocatedQty: parseFloat(e.target.value) || 0 }; setDistributions(u); }}
                            className="input-field w-32"
                            min={0}
                            placeholder="0"
                            autoFocus={d.index === group.items[0].index}
                          />
                          <span className="text-xs text-gray-400">cartons</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowDistribute(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleDistribute} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save_distribution")}</button>
        </div>
        </>}
      </Modal>

      {/* ========== GODOWN ALLOCATION ========== */}
      <Modal open={showGodownAlloc} onClose={() => setShowGodownAlloc(false)} title={`${t("assign_to_godowns")} — ${selectedLot?.lotNumber || ""}`} size="xl">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        {godownAllocs.length > 0 ? (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            <div className="flex items-center gap-3 text-xs font-semibold text-gray-400 pb-2 border-b"><span className="w-40">{t("product")}</span><span className="w-36">{t("godown")}</span><span className="w-24">{t("qty")}</span><span>Max</span></div>
            {godownAllocs.map((a, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-40 font-medium truncate">{a.productName}</span>
                <span className="w-36 text-gray-500 truncate">{a.godownName}</span>
                <input type="number" value={a.qty || ""} onChange={e => { const u = [...godownAllocs]; u[i] = { ...u[i], qty: parseFloat(e.target.value) || 0 }; setGodownAllocs(u); }} className="input-field w-24" min={0} />
                <span className="text-xs text-gray-400">/ {a.maxQty}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400">{t("no_godowns")}</p>}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowGodownAlloc(false)} className="btn-secondary text-sm"> {t("cancel")}</button><button onClick={handleGodownAlloc} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      {/* ========== EDIT LOT ========== */}
      <Modal open={showEditLot} onClose={() => setShowEditLot(false)} title={`${t("edit")}: ${editLotData?.lotNumber || ""}`} size="lg">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("lot_num")}</label><input value={editLotData?.lotNumber || ""} onChange={e => setEditLotData((d: any) => ({ ...d, lotNumber: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={editLotData?.notes || ""} onChange={e => setEditLotData((d: any) => ({ ...d, notes: e.target.value }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("product")} & {t("cartons")}</label>
            {editProducts.map((p, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <select value={p.productId} onChange={e => { const u = [...editProducts]; u[i] = { ...u[i], productId: parseInt(e.target.value) }; setEditProducts(u); }} className="select-field flex-1"><option value={0}>{t("select")}</option>{products.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select>
                <input type="number" value={p.totalQty || ""} onChange={e => { const u = [...editProducts]; u[i] = { ...u[i], totalQty: parseFloat(e.target.value) || 0 }; setEditProducts(u); }} className="input-field w-32" placeholder={t("cartons")} />
                {editProducts.length > 1 && <button onClick={() => setEditProducts(ep => ep.filter((_, idx) => idx !== i))} className="text-red-500 text-lg">×</button>}
              </div>
            ))}
            <button onClick={() => setEditProducts(ep => [...ep, { productId: 0, totalQty: 0 }])} className="text-primary-600 text-sm hover:underline">+ {t("add_item")}</button>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowEditLot(false)} className="btn-secondary text-sm"> {t("cancel")}</button><button onClick={handleEditLot} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </div>
  );
}
