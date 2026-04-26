"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useOffline } from "@/hooks/useOffline";
import { useSearchParams } from "next/navigation";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { safeParseQueuedBody } from "@/lib/queue-resolve";

const CITY_TRANSFERS_FORM_CACHE_KEY = "mrf-city-transfers-form-cache-v1";
const CITY_TRANSFERS_READ_CACHE_KEY = "mrf-city-transfers-read-cache-v1";

type CityTransfersFormCache = {
  cities: any[];
  godowns: any[];
  products: any[];
  lots: any[];
};

type CityTransfersReadSnapshot = {
  transfers: any[];
  totalPages: number;
  total: number;
};

export default function CityTransfersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, enqueue, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, syncQueue } = useOffline();
  const searchParams = useSearchParams();
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
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
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/city-transfers", { params });
    if (r.success) {
      setTransfers(r.data as any[]);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
      writeOfflineReadSnapshot<CityTransfersReadSnapshot>(CITY_TRANSFERS_READ_CACHE_KEY, {
        transfers: r.data as any[],
        totalPages: (r.pagination as any)?.totalPages || 1,
        total: (r.pagination as any)?.total || 0,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<CityTransfersReadSnapshot>(CITY_TRANSFERS_READ_CACHE_KEY)?.data;
      if (snapshot?.transfers?.length) {
        setTransfers(snapshot.transfers);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || 0);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, page, searchQuery]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.synced > 0) load();
  }, [lastSyncResult, load]);
  useEffect(() => { setPage(1); }, [searchQuery]);

  const openSend = async (preset?: Partial<typeof form>) => {
    if (!isOnline) {
      const cached = readOfflineFormCache<CityTransfersFormCache>(CITY_TRANSFERS_FORM_CACHE_KEY, [
        "cities",
        "godowns",
        "products",
        "lots",
      ]);
      if (!cached) {
        setError(
          getOfflineFormReadinessError({
            isOnline,
            currencyCount: 0,
            moduleTitle: "City Transfer",
          }) || "Offline setup missing",
        );
        setShowSend(true);
        return;
      }
      setCities(cached.cities);
      setGodowns(cached.godowns);
      setProducts(cached.products);
      setLots(cached.lots);
      setForm({
        toCityId: 0,
        fromGodownId: 0,
        productId: 0,
        lotId: 0,
        qty: 0,
        notes: "",
        transferDate: new Date().toISOString().split("T")[0],
        ...preset,
      });
      setShowSend(true);
      setError("");
      return;
    }

    const [cR, gR, pR, lR] = await Promise.all([apiCall("/api/v1/cities", { params: { all: "true" } }), apiCall("/api/v1/godowns", { params: { limit: 100 } }), apiCall("/api/v1/products", { params: { limit: 100 } }), apiCall("/api/v1/lots", { params: { limit: 100 } })]);
    const nextCities = cR.success ? (cR.data as any[]).filter((c: any) => c.id !== user?.cityId && c.countryName === user?.countryName) : [];
    const nextGodowns = gR.success ? (gR.data as any[]).filter((g: any) => g.cityId === user?.cityId) : [];
    const nextProducts = pR.success ? (pR.data as any[]) : [];
    const nextLots = lR.success ? (lR.data as any[]) : [];
    if (cR.success) setCities(nextCities);
    if (gR.success) setGodowns(nextGodowns);
    if (pR.success) setProducts(nextProducts);
    if (lR.success) setLots(nextLots);
    if (nextCities.length > 0 && nextGodowns.length > 0 && nextProducts.length > 0) {
      writeOfflineFormCache<CityTransfersFormCache>(CITY_TRANSFERS_FORM_CACHE_KEY, {
        cities: nextCities,
        godowns: nextGodowns,
        products: nextProducts,
        lots: nextLots,
      });
    }
    setForm({ toCityId: 0, fromGodownId: 0, productId: 0, lotId: 0, qty: 0, notes: "", transferDate: new Date().toISOString().split("T")[0], ...preset });
    setShowSend(true); setError("");
  };

  const handleSend = async () => {
    if (!form.toCityId || !form.fromGodownId || !form.productId || !form.qty) { setError(t("fill_required_fields")); return; }
    const body: any = { ...form };
    if (!body.lotId) delete body.lotId;

    if (resolvingQueueId) {
      const ok = await updateQueuedItem(resolvingQueueId, { body: JSON.stringify(body) });
      if (!ok) {
        setError("Queued city transfer entry not found. Please retry from Activity.");
        return;
      }
      if (isOnline) {
        await retryQueuedItem(resolvingQueueId);
        await syncQueue();
      }
      setResolvingQueueId(null);
      setShowSend(false);
      load();
      return;
    }

    if (!isOnline) {
      const toCity = cities.find((c: any) => c.id === form.toCityId);
      const fromGodown = godowns.find((g: any) => g.id === form.fromGodownId);
      const product = products.find((p: any) => p.id === form.productId);
      const lot = lots.find((l: any) => l.id === form.lotId);
      await enqueue({
        url: "/api/v1/city-transfers",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/city-transfers",
        auditMeta: {
          action: "create",
          entityType: "city_transfer",
          entityLabel: "City Transfer (Pending)",
          entityDetail: `${product?.name || "Product"} × ${Number(form.qty || 0).toLocaleString("en-US")}`,
        },
      });
      setTransfers((prev) => [{
        id: `pending-${Date.now()}`,
        transferDate: form.transferDate,
        fromCity: { id: user?.cityId, name: user?.cityName },
        toCity: toCity ? { id: toCity.id, name: toCity.name } : null,
        fromGodown: fromGodown ? { id: fromGodown.id, name: fromGodown.name } : null,
        toGodown: null,
        product: product ? { id: product.id, name: product.name } : null,
        lot: lot ? { id: lot.id, lotNumber: lot.lotNumber } : null,
        qty: Number(form.qty || 0),
        status: "pending",
        _pending: true,
      }, ...prev]);
      setShowSend(false);
      setResolvingQueueId(null);
      return;
    }

    setSubmitting(true);
    const r = await apiCall("/api/v1/city-transfers", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowSend(false); setResolvingQueueId(null); load(); } else { setError(r.error || "Failed"); }
  };

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId) return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/city-transfers");
    if (!target) return;
    const parsed = safeParseQueuedBody(target.body);
    if (!parsed) return;
    openSend({
      toCityId: Number(parsed.toCityId || 0),
      fromGodownId: Number(parsed.fromGodownId || 0),
      productId: Number(parsed.productId || 0),
      lotId: Number(parsed.lotId || 0),
      qty: Number(parsed.qty || 0),
      notes: String(parsed.notes || ""),
      transferDate: String(parsed.transferDate || new Date().toISOString().split("T")[0]),
    });
    setResolvingQueueId(queueId);
    setError("Resolving queued city transfer. Save to update and re-sync.");
    window.history.replaceState({}, "", "/city-transfers");
  }, [queuedItems, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const openApprove = async (tr: any) => {
    setSelected(tr);
    const gR = await apiCall("/api/v1/godowns", { params: { limit: 100 } });
    if (gR.success) {
      setMyGodowns((gR.data as any[]).filter((g: any) => g.cityId === user?.cityId));
    } else if (!isOnline) {
      const cached = readOfflineFormCache<CityTransfersFormCache>(CITY_TRANSFERS_FORM_CACHE_KEY, [
        "cities",
        "godowns",
        "products",
        "lots",
      ]);
      if (cached?.godowns?.length) {
        setMyGodowns(cached.godowns.filter((g: any) => g.cityId === user?.cityId));
      } else {
        setMyGodowns([]);
      }
    }
    setApproveForm({ toGodownId: 0, approvalNotes: "" });
    setShowApprove(true); setError("");
  };

  const handleApprove = async () => {
    if (!approveForm.toGodownId) { setError(t("select_godown")); return; }
    const body = { action: "approve", ...approveForm };
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/city-transfers/${selected.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/city-transfers",
        auditMeta: {
          action: "approve",
          entityType: "city_transfer",
          entityLabel: "City Transfer Approval (Pending)",
          entityDetail: `${selected?.product?.name || "Transfer"} × ${Number(selected?.qty || 0).toLocaleString("en-US")}`,
        },
      });
      setTransfers((prev) =>
        prev.map((tr: any) =>
          tr.id === selected.id
            ? {
                ...tr,
                status: "approved",
                toGodown: myGodowns.find((g: any) => g.id === approveForm.toGodownId) || tr.toGodown,
                approvalNotes: approveForm.approvalNotes || tr.approvalNotes,
                _pending: true,
              }
            : tr
        )
      );
      setShowApprove(false);
      return;
    }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/city-transfers/${selected.id}`, { method: "PUT", body });
    setSubmitting(false);
    if (r.success) { setShowApprove(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleReject = async (tr: any) => {
    const reason = prompt(t("reason_for_rejection"));
    if (!reason) return;
    const body = { action: "reject", approvalNotes: reason };
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/city-transfers/${tr.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/city-transfers",
        auditMeta: {
          action: "reject",
          entityType: "city_transfer",
          entityLabel: "City Transfer Rejection (Pending)",
          entityDetail: `${tr?.product?.name || "Transfer"} × ${Number(tr?.qty || 0).toLocaleString("en-US")}`,
        },
      });
      setTransfers((prev) =>
        prev.map((row: any) =>
          row.id === tr.id ? { ...row, status: "rejected", approvalNotes: reason, _pending: true } : row
        )
      );
      return;
    }
    await apiCall(`/api/v1/city-transfers/${tr.id}`, { method: "PUT", body });
    load();
  };

  const pendingIncoming = transfers.filter(tr => !tr._pending && tr.status === "pending" && tr.toCity?.id === user?.cityId);

  return (
    <div>
      <PageHeader title={t("city_transfers")} subtitle={`${total} ${t("transfers").toLowerCase()}`} action={user?.role === "city_admin" ? <button onClick={() => { void openSend(); }} className="btn-primary text-sm">📦 {t("send_goods")}</button> : undefined} />
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached city transfer data for this device.
        </div>
      )}

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

      <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        searchPlaceholder="Search transfers (min 2 chars)"
        columns={[
        { key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) },
        { key: "fromCity", label: t("from"), render: (tr: any) => <span>{tr.fromCity?.name} <span className="text-xs text-gray-400">({tr.fromGodown?.name})</span></span> },
        { key: "toCity", label: t("to"), render: (tr: any) => <span>{tr.toCity?.name} {tr.toGodown ? <span className="text-xs text-gray-400">({tr.toGodown.name})</span> : ""}</span> },
        { key: "product", label: t("product"), render: (tr: any) => tr.product?.name },
        { key: "qty", label: t("cartons"), render: (tr: any) => <span className="font-medium">{tr.qty}</span> },
        { key: "lot", label: t("lot"), render: (tr: any) => tr.lot?.lotNumber || "-" },
        { key: "status", label: t("status"), render: (tr: any) => <span className={`text-xs px-2 py-0.5 rounded font-medium ${tr._pending ? "bg-amber-100 text-amber-700" : tr.status === "approved" ? "bg-green-50 text-green-700" : tr.status === "rejected" ? "bg-red-50 text-red-700" : "bg-yellow-50 text-yellow-700"}`}>{tr._pending ? "syncing…" : tr.status}</span> },
        { key: "sentBy", label: t("sent_by"), render: (tr: any) => tr.sentBy?.fullName },
        { key: "actions", label: "", render: (tr: any) => (
          !tr._pending && tr.status === "pending" && tr.toCity?.id === user?.cityId ? (
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
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleSend} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("send")}</button></div>
      </Modal>

      {/* Approve Modal */}
      <Modal open={showApprove} onClose={() => setShowApprove(false)} title={t("approve_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        {selected && <div className="mb-3 p-2 bg-gray-50 rounded text-sm">{t("received")} <strong>{selected.qty} {t("cartons")}</strong> {t("of")} <strong>{selected.product?.name}</strong> {t("from")} <strong>{selected.fromCity?.name}</strong></div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("store_in_godown")} *</label><select value={approveForm.toGodownId} onChange={e => setApproveForm(f => ({ ...f, toGodownId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select_godown")}</option>{myGodowns.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={approveForm.approvalNotes} onChange={e => setApproveForm(f => ({ ...f, approvalNotes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleApprove} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("approve_receive")}</button></div>
      </Modal>
    </div>
  );
}
