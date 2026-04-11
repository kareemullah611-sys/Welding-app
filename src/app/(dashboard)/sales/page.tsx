"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatusBadge, formatCurrency, formatDate } from "@/components/ui";
import CustomerSearch from "@/components/CustomerSearch";
import { useLang } from "@/lib/lang";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function SalesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const { isOnline, enqueue, cacheGodownStock, getCachedGodownStock, lastSyncResult } = useOffline();
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showCorrect, setShowCorrect] = useState(false);
  const [correctItems, setCorrectItems] = useState<any[]>([]);
  const [correctReason, setCorrectReason] = useState("");
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [filters, setFilters] = useState({ status: "", date_from: "", date_to: "" });
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [hardDeleteSubmitting, setHardDeleteSubmitting] = useState(false);
  const [openActionId, setOpenActionId] = useState<number | null>(null);

  // Dropdowns
  const [customers, setCustomers] = useState<any[]>([]);
  const [godowns, setGodowns] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);

  // Godown stock - available qty per product in selected godown
  const [godownStock, setGodownStock] = useState<any[]>([]);
  const [stockLoading, setStockLoading] = useState(false);


  // Form state
  const [form, setForm] = useState({
    customerId: 0, godownId: 0, lotId: 0, saleDate: new Date().toISOString().split("T")[0],
    currencyId: 0, notes: "",
    items: [{ productId: 0, qty: 0, ratePerCarton: 0 }],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [shortConfirmed, setShortConfirmed] = useState(false);
  const [saleSavedNotice, setSaleSavedNotice] = useState<string | null>(null);
  const [prefillHandled, setPrefillHandled] = useState(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  // Cancel form
  const [cancelReason, setCancelReason] = useState("");
  // Discount form
  const [discountForm, setDiscountForm] = useState({ discountAmount: 0, notes: "", discountDate: new Date().toISOString().split("T")[0] });

  const loadSales = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    if (filters.status) params.status = filters.status;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    const result = await apiCall("/api/v1/sales", { params });
    if (result.success) {
      setSales(result.data as any[]);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => { loadSales(); }, [loadSales]);
  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    openCreate();
    window.history.replaceState({}, "", isEmbed ? "/sales?embed=1" : "/sales");
  }, [prefillHandled, searchParams, user?.role]);

  // Reload from server after pending entries sync successfully
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.synced > 0) loadSales();
  }, [lastSyncResult, loadSales]);

  const loadDropdowns = async () => {
    const [custRes, gdRes, prodRes, lotRes, cityRes] = await Promise.all([
      Promise.resolve({ success: true, data: [] }), // customers loaded on-demand via CustomerSearch
      apiCall("/api/v1/godowns", { params: { limit: 200, is_active: "true", show_all: "true" } }),
      apiCall("/api/v1/products", { params: { limit: 100, is_active: "true" } }),
      apiCall("/api/v1/lots", { params: { limit: 100, status: "ongoing" } }),
      apiCall("/api/v1/cities"),
    ]);
    if (custRes.success) setCustomers(custRes.data as any[]);
    if (gdRes.success) setGodowns(gdRes.data as any[]);
    if (prodRes.success) setProducts(prodRes.data as any[]);
    if (lotRes.success) setLots(lotRes.data as any[]);
    if (cityRes.success && user?.cityId) {
      const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) {
        setForm((f) => ({ ...f, currencyId: city.currencies[0].id }));
        setCurrencies(city.currencies);
      }
    }
  };

  // Load godown stock — serves from local cache when offline
  const loadGodownStock = async (godownId: number) => {
    if (!godownId) { setGodownStock([]); return; }
    setStockLoading(true);
    if (!isOnline) {
      const cached = await getCachedGodownStock(godownId);
      setGodownStock(cached ?? []);
      setStockLoading(false);
      return;
    }
    const result = await apiCall("/api/v1/inventory/godown-stock", { params: { godown_id: godownId } });
    if (result.success) {
      setGodownStock(result.data as any[]);
      await cacheGodownStock(godownId, result.data as any[]); // save for offline use
    } else setGodownStock([]);
    setStockLoading(false);
  };

  const openCreate = async () => {
    await loadDropdowns();
    setForm((prev) => ({
      customerId: 0, godownId: 0, lotId: 0, saleDate: new Date().toISOString().split("T")[0],
      currencyId: prev.currencyId || 0, notes: "",
      items: [{ productId: 0, qty: 0, ratePerCarton: 0 }],
    }));
    setGodownStock([]);
    setShowCreate(true); setFormError("");
  };

  const onGodownChange = (godownId: number) => {
    setForm((f) => ({ ...f, godownId }));
    loadGodownStock(godownId);
  };


  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { productId: 0, qty: 0, ratePerCarton: 0 }] }));
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: string, value: number) => setForm((f) => ({ ...f, items: f.items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)) }));

  const getAvailable = (productId: number) => {
    const s = godownStock.find((s) => s.productId === productId);
    return s?.available || 0;
  };

  const totalAmount = form.items.reduce((sum, i) => sum + i.qty * i.ratePerCarton, 0);

  const handleSubmit = async () => {
    setFormError("");
    if (!form.customerId) { setFormError("Please select a customer"); return; }
    if (!form.godownId) { setFormError("Please select a godown"); return; }
    const validItems = form.items.filter((i) => i.productId && i.qty > 0);
    if (!validItems.length) { setFormError("Add at least one product with quantity"); return; }

    // Warn (non-blocking) if any item exceeds available stock — API will mark sale as "marked_short"
    const shortItems = validItems.filter((item) => item.qty > getAvailable(item.productId));
    if (shortItems.length > 0) {
      const names = shortItems.map((item) => {
        const avail = getAvailable(item.productId);
        const pName = products.find((p: any) => p.id === item.productId)?.name || "Item";
        return avail <= 0 ? `${pName} (no stock)` : `${pName} (${avail} available)`;
      });
      setFormError(`⚠ Short stock: ${names.join(", ")} — sale will be marked short. Submit again to confirm.`);
      if (!shortConfirmed) { setShortConfirmed(true); return; }
    }
    setShortConfirmed(false);

    const payload = { customerId: form.customerId, godownId: form.godownId, lotId: form.lotId || null, saleDate: form.saleDate, currencyId: form.currencyId, notes: form.notes, items: validItems };

    // ── Offline: queue the sale and update stock locally ──
    if (!isOnline) {
      await enqueue({
        url: "/api/v1/sales",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        pathname: "/sales",
      });

      // Deduct sold qty from local stock so the next sale uses the correct number
      const updatedStock = godownStock.map((s) => {
        const sold = validItems.find((i) => i.productId === s.productId);
        return sold ? { ...s, available: Math.max(0, s.available - sold.qty) } : s;
      });
      setGodownStock(updatedStock);
      await cacheGodownStock(form.godownId, updatedStock);

      // Add an optimistic row to the sales list
      const currency = currencies.find((c) => c.id === form.currencyId);
      setSales((prev) => [{
        id: `pending-${Date.now()}`,
        voucherNo: "—",
        saleDate: form.saleDate,
        customer: { name: "..." },
        totalAmount: totalAmount,
        status: "pending_sync",
        currency: { code: currency?.code ?? "" },
        _pending: true,
      }, ...prev]);

      setShowCreate(false);
      setShortConfirmed(false);
      setForm({ customerId: 0, godownId: 0, lotId: 0, saleDate: new Date().toISOString().split("T")[0], currencyId: currencies[0]?.id || 0, notes: "", items: [{ productId: 0, qty: 0, ratePerCarton: 0 }] });
      return;
    }

    // ── Online: normal submit ──
    setSubmitting(true);
    const result = await apiCall("/api/v1/sales", { method: "POST", body: payload });
    setSubmitting(false);
    if (result.success) {
      setShowCreate(false);
      if (isEmbed) closeEmbed();
      setShortConfirmed(false);
      setForm({ customerId: 0, godownId: 0, lotId: 0, saleDate: new Date().toISOString().split("T")[0], currencyId: currencies[0]?.id || 0, notes: "", items: [{ productId: 0, qty: 0, ratePerCarton: 0 }] });
      const isPakistanWalkIn = user?.role === "city_admin" && user?.countryName === "Pakistan" && form.customerId === -1;
      if (isPakistanWalkIn) {
        const params = new URLSearchParams({
          create: "payment",
          customer_id: "-1",
          customer_name: "Walk-in Customer",
          detail: `Walk-in sale payment`,
        });
        window.location.href = `/payments?${params.toString()}`;
        return;
      }
      setSaleSavedNotice("Sale recorded successfully. Next step: record the customer payment if money was received.");
      setTimeout(() => setSaleSavedNotice(null), 5000);
      loadSales();
    } else { setFormError(result.error || "Failed to create sale"); }
  };

  // Hard delete sale (super admin + 2FA)
  const openHardDelete = (sale: any) => { setHardDeleteTarget(sale); setHardDeletePassword(""); setHardDeleteError(""); setShowHardDelete(true); };
  const handleHardDelete = async () => {
    if (!hardDeletePassword.trim()) { setHardDeleteError("Password is required"); return; }
    setHardDeleteSubmitting(true);
    const result = await apiCall(`/api/v1/sales/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setHardDeleteSubmitting(false);
    if (result.success) { setShowHardDelete(false); loadSales(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  // Cancel sale
  const openCancel = (sale: any) => { setSelectedSale(sale); setCancelReason(""); setShowCancel(true); setFormError(""); };
  const handleCancel = async () => {
    if (!cancelReason.trim()) { setFormError("Cancellation reason is required"); return; }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/sales/${selectedSale.id}/cancel`, { method: "PUT", body: { reason: cancelReason } });
    setSubmitting(false);
    if (result.success) { setShowCancel(false); loadSales(); } else { setFormError(result.error || "Failed"); }
  };

  // Discount
  const openDiscount = (sale: any) => { setSelectedSale(sale); setDiscountForm({ discountAmount: 0, notes: "", discountDate: new Date().toISOString().split("T")[0] }); setShowDiscount(true); setFormError(""); };

  const openCorrect = async (sale: any) => {
    // Load products if not already loaded (fixes empty dropdown on first use)
    if (!products.length) await loadDropdowns();
    setSelectedSale(sale);
    setCorrectItems(sale.items?.map((i: any) => ({ productId: i.productId || i.product?.id, qty: i.qty, ratePerCarton: i.ratePerCarton || i.rate })) || []);
    setCorrectReason(""); setShowCorrect(true); setFormError("");
  };
  const handleCorrect = async () => {
    if (!correctReason.trim()) { setFormError("Provide reason for correction"); return; }
    const validItems = correctItems.filter(i => i.productId && i.qty > 0 && i.ratePerCarton > 0);
    if (!validItems.length) { setFormError("Add at least one item"); return; }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/sales/${selectedSale.id}/correct`, { method: "PUT", body: { items: validItems, reason: correctReason } });
    setSubmitting(false);
    if (r.success) { setShowCorrect(false); loadSales(); } else { setFormError(r.error || "Failed"); }
  };
  const handleDiscount = async () => {
    if (!discountForm.discountAmount || discountForm.discountAmount <= 0) { setFormError("Discount amount must be positive"); return; }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/sales/${selectedSale.id}/discount`, { method: "POST", body: discountForm });
    setSubmitting(false);
    if (result.success) { setShowDiscount(false); loadSales(); } else { setFormError(result.error || "Failed"); }
  };

  return (
    <div onClick={() => setOpenActionId(null)}>
      {!isEmbed && <PageHeader title={t("sales")} subtitle={`${total} ${t("records").toLowerCase()}`} />}
      {!isEmbed && (
      <>

      {saleSavedNotice && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex flex-wrap items-center justify-between gap-3">
          <span>{saleSavedNotice}</span>
          <Link href="/payments" className="text-sm font-semibold text-green-700 hover:underline">
            Go to Payments
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={filters.status} onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }} className="select-field w-auto">
          <option value="">{t("all_statuses")}</option><option value="active">{t("active")}</option><option value="cancelled">{t("cancelled")}</option><option value="marked_short">{t("marked_short")}</option>
        </select>
        <input type="date" value={filters.date_from} onChange={(e) => { setFilters((f) => ({ ...f, date_from: e.target.value })); setPage(1); }} className="input-field w-auto" />
        <input type="date" value={filters.date_to} onChange={(e) => { setFilters((f) => ({ ...f, date_to: e.target.value })); setPage(1); }} className="input-field w-auto" />
      </div>

      <DataTable columns={[
        { key: "voucherNo", label: t("voucher_hash"), render: (s: any) => <span className="font-mono font-medium">{s.voucherNo}</span> },
        { key: "saleDate", label: t("date"), render: (s: any) => formatDate(s.saleDate) },
        { key: "customer", label: t("customer"), render: (s: any) => (
          <div>
            <span>{s.customer?.name}</span>
            {user?.role === "super_admin" && s.cityName && (
              <p className="text-xs text-indigo-500 mt-0.5">{s.cityName}</p>
            )}
          </div>
        )},
        { key: "items", label: t("product"), render: (s: any) => <div className="text-xs">{s.items?.map((i: any, idx: number) => <div key={idx}>{i.productName}</div>)}</div> },
        { key: "cartons", label: t("cartons"), render: (s: any) => <div className="text-xs">{s.items?.map((i: any, idx: number) => <div key={idx} className="font-medium">{i.qty}</div>)}</div> },
        { key: "ratePerCarton", label: "Per Carton", render: (s: any) => (
          <div className="text-xs">
            {s.items?.map((i: any, idx: number) => (
              <div key={idx} className="font-medium">
                {s.currency?.symbol} {Number(i.ratePerCarton || 0).toLocaleString("en-US")}
              </div>
            ))}
          </div>
        )},
        { key: "totalAmount", label: t("amount"), render: (s: any) => <span className="font-medium">{s.currency?.symbol} {formatCurrency(s.totalAmount, "").trim()}</span> },
        { key: "godown", label: t("godown"), render: (s: any) => (
          <span className="flex flex-col">
            <span>{s.godown?.name}</span>
            {s.godown?.crossCity && <span className="text-xs text-orange-500">⟵ {s.godown.sourceCityName}</span>}
          </span>
        )},
        { key: "lot", label: t("lot"), render: (s: any) => s.lot?.lotNumber },
        { key: "status", label: t("status"), render: (s: any) => (
          <div>
            {s._pending
              ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700">⏳ Pending Sync</span>
              : <StatusBadge status={s.status} />
            }
            {s.status === "cancelled" && s.cancellationReason && (
              <p className="text-xs text-gray-500 mt-0.5 max-w-[160px] truncate" title={s.cancellationReason}>
                {s.cancellationReason}
              </p>
            )}
          </div>
        )},
        { key: "actions", label: "", render: (s: any) => (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpenActionId((current) => current === s.id ? null : s.id);
              }}
              className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
            >
              ⋯
            </button>
            {openActionId === s.id && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                {s.status === "active" && (
                  <>
                    <button onClick={() => { setOpenActionId(null); openCorrect(s); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("correct_sale")}</button>
                    <button onClick={() => { setOpenActionId(null); openDiscount(s); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-yellow-700 hover:bg-yellow-50">{t("discount")}</button>
                    <button onClick={() => { setOpenActionId(null); openCancel(s); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("cancel")}</button>
                  </>
                )}
                {user?.role === "super_admin" && (
                  <button onClick={() => { setOpenActionId(null); openHardDelete(s); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-800 hover:bg-red-50">{t("hard_delete")}</button>
                )}
              </div>
            )}
          </div>
        )},
      ]} data={sales} loading={loading} emptyMessage={t("no_data")} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      </>
      )}
      {/* ========== CREATE SALE MODAL ========== */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setShortConfirmed(false); setFormError(""); if (isEmbed) closeEmbed(); }} title={t("new_sale")} size="xl" inline={isEmbed}>
        {formError && (
          <div className={`mb-4 p-3 rounded-lg text-sm border ${shortConfirmed ? "bg-amber-50 border-amber-300 text-amber-800" : "bg-red-50 border-red-200 text-red-700"}`}>
            {formError}
          </div>
        )}

        {/* Date — always first */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
          <input type="date" value={form.saleDate} onChange={(e) => setForm((f) => ({ ...f, saleDate: e.target.value }))} className="input-field" autoFocus />
        </div>
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Step 1</p>
            <h3 className="text-sm font-semibold text-gray-900 mt-1">Choose customer and stock source</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("customer")} *</label>
            <CustomerSearch
              value={form.customerId}
              onChange={(id) => setForm((f) => ({ ...f, customerId: id }))}
              placeholder={t("search_customer")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("godown")} *</label>
            <select value={form.godownId} onChange={(e) => onGodownChange(parseInt(e.target.value))} className="select-field">
              <option value={0}>{t("select_godown")}</option>
              {/* Group godowns by city */}
              {Array.from(new Set(godowns.map((g: any) => g.cityName))).map((cityName) => (
                <optgroup key={cityName as string} label={cityName as string}>
                  {godowns.filter((g: any) => g.cityName === cityName).map((g: any) => (
                    <option key={g.id} value={g.id}>
                      {g.cityId !== user?.cityId ? `⟵ ${g.name}` : g.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* Cross-city warning */}
            {form.godownId > 0 && godowns.find((g: any) => g.id === form.godownId)?.cityId !== user?.cityId && (
              <p className="text-xs text-orange-600 mt-1">⚠️ Cross-city godown — stock will be taken from {godowns.find((g: any) => g.id === form.godownId)?.cityName}</p>
            )}
          </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label>
            <select value={form.lotId} onChange={(e) => setForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
              <option value={0}>{t("auto_fifo")}</option>
              {lots.map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}
            </select>
          </div>
          {currencies.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
              <select value={form.currencyId} onChange={(e) => setForm((f) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} ({c.symbol})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input type="text" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>

        {/* GODOWN STOCK INFO */}
        {form.godownId > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-semibold text-blue-800 mb-2">
              📦 {t("available")} — {godowns.find((g: any) => g.id === form.godownId)?.name || t("godown")}
              {godowns.find((g: any) => g.id === form.godownId)?.cityId !== user?.cityId && (
                <span className="ml-2 text-xs font-normal text-orange-600">({godowns.find((g: any) => g.id === form.godownId)?.cityName})</span>
              )}
            </h4>
            {stockLoading ? (
              <p className="text-sm text-blue-600">{t("loading_stock")}</p>
            ) : godownStock.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {godownStock.map((s) => (
                  <div key={s.productId} className={`text-sm px-2 py-1 rounded ${s.available > 0 ? "bg-white" : "bg-red-50 text-red-400"}`}>
                    <span className="font-medium">{s.productName}:</span>{" "}
                    <strong className={s.available > 0 ? "text-green-700" : "text-red-500"}>{s.available}</strong>
                    <span className="text-xs text-gray-400"> {t("cartons")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-yellow-700">⚠ {t("no_stock")}</p>
            )}
          </div>
        )}

        {/* LINE ITEMS */}
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Step 2</p>
            <h3 className="text-sm font-semibold text-gray-900 mt-1">Add products and selling rates</h3>
          </div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">{t("product")} *</label>
            <button onClick={addItem} className="text-primary-600 text-sm font-medium hover:text-primary-700">+ {t("add_item")}</button>
          </div>
          <div className="space-y-2">
            {form.items.map((item, idx) => {
              const avail = getAvailable(item.productId);
              return (
                <div key={idx} className="flex gap-2 items-end">
                  <div className="flex-1">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("product")}</label>}
                    <select value={item.productId} onChange={(e) => updateItem(idx, "productId", parseInt(e.target.value))} className="select-field text-sm">
                      <option value={0}>{t("select_product")}</option>
                      {products.map((p: any) => {
                        const stock = getAvailable(p.id);
                        return <option key={p.id} value={p.id}>{p.name} {stock > 0 ? `(${stock})` : "(—)"}</option>;
                      })}
                    </select>
                  </div>
                  <div className="w-24">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("qty")}</label>}
                    <input type="number" value={item.qty || ""} onChange={(e) => updateItem(idx, "qty", parseFloat(e.target.value) || 0)} className={`input-field text-sm ${item.productId && item.qty > avail ? "border-red-400 bg-red-50" : ""}`} placeholder="0" max={avail || undefined} />
                  </div>
                  <div className="w-14 text-center">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("available")}</label>}
                    <span className={`text-xs font-medium ${item.productId ? (avail > 0 ? "text-green-600" : "text-red-500") : "text-gray-300"}`}>{item.productId ? avail : "-"}</span>
                  </div>
                  <div className="w-32">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("rate_per_carton")}</label>}
                    <input type="number" value={item.ratePerCarton || ""} onChange={(e) => updateItem(idx, "ratePerCarton", parseFloat(e.target.value) || 0)} className="input-field text-sm" placeholder="0" />
                  </div>
                  <div className="w-28 text-right">
                    {idx === 0 && <label className="block text-xs text-gray-500 mb-1">{t("amount")}</label>}
                    <p className="py-2 text-sm font-medium">{(item.qty * item.ratePerCarton).toLocaleString("en-US")}</p>
                  </div>
                  {form.items.length > 1 && <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 pb-2 text-lg">×</button>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-right">
            <span className="text-sm text-gray-500">{t("total")}: </span>
            <span className="text-lg font-bold text-gray-900">{totalAmount.toLocaleString("en-US")}</span>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Step 3</p>
          <h3 className="text-sm font-semibold text-blue-900 mt-1">Review before saving</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Items</div>
              <div className="text-sm font-semibold text-gray-900">{form.items.filter((i) => i.productId && i.qty > 0).length}</div>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Cartons</div>
              <div className="text-sm font-semibold text-gray-900">{form.items.reduce((sum, i) => sum + (i.qty || 0), 0).toLocaleString("en-US")}</div>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Godown</div>
              <div className="text-sm font-semibold text-gray-900 truncate">{godowns.find((g: any) => g.id === form.godownId)?.name || "Not selected"}</div>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-xs text-gray-500">Sale Total</div>
              <div className="text-sm font-semibold text-gray-900">{totalAmount.toLocaleString("en-US")}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-blue-700">
            After saving, you can go straight to Payments if the customer paid on the spot.
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={() => { setShowCreate(false); setShortConfirmed(false); setFormError(""); }} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleSubmit} disabled={submitting} className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${shortConfirmed ? "bg-amber-500 hover:bg-amber-600 text-white" : "btn-primary"}`}>{submitting ? "..." : shortConfirmed ? "⚠ Confirm Short Sale" : t("new_sale")}</button>
        </div>
      </Modal>

      {/* ========== CANCEL SALE MODAL ========== */}
      <Modal open={showCancel} onClose={() => setShowCancel(false)} title={`${t("cancel_sale")}: ${selectedSale?.voucherNo || ""}`} size="md">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("cancel_reason")} *</label>
          <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="input-field" rows={3} />
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCancel(false)} className="btn-secondary text-sm">{t("back")}</button>
          <button onClick={handleCancel} disabled={submitting} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm">{submitting ? "..." : t("cancel_sale")}</button>
        </div>
      </Modal>

      {/* ========== DISCOUNT MODAL ========== */}
      <Modal open={showDiscount} onClose={() => setShowDiscount(false)} title={`${t("discount")}: ${selectedSale?.voucherNo || ""}`} size="md">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("discount_amount")} *</label>
            <input type="number" value={discountForm.discountAmount || ""} onChange={(e) => setDiscountForm((f) => ({ ...f, discountAmount: parseFloat(e.target.value) || 0 }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label>
            <input type="date" value={discountForm.discountDate} onChange={(e) => setDiscountForm((f) => ({ ...f, discountDate: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={discountForm.notes} onChange={(e) => setDiscountForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowDiscount(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleDiscount} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("apply_discount")}</button>
        </div>
      </Modal>

      {/* ========== CORRECT SALE ITEMS MODAL ========== */}
      <Modal open={showCorrect} onClose={() => setShowCorrect(false)} title={`${t("correct_sale")}: ${selectedSale?.voucherNo || ""}`} size="lg">
        {formError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{formError}</div>}
        <div className="space-y-2 mb-3">
          {correctItems.map((item, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 items-end">
              <div><label className="block text-xs text-gray-500 mb-1">{t("product")}</label><select value={item.productId} onChange={e => { const v = parseInt(e.target.value); setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, productId: v } : c)); }} className="select-field text-sm"><option value={0}>{t("select_product")}</option>{products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className="block text-xs text-gray-500 mb-1">{t("cartons")}</label><input type="number" value={item.qty || ""} onChange={e => { const v = parseFloat(e.target.value) || 0; setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, qty: v } : c)); }} className="input-field text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">{t("rate_per_carton")}</label><input type="number" value={item.ratePerCarton || ""} onChange={e => { const v = parseFloat(e.target.value) || 0; setCorrectItems(ci => ci.map((c, idx) => idx === i ? { ...c, ratePerCarton: v } : c)); }} className="input-field text-sm" /></div>
              <div className="flex gap-1 items-center"><span className="text-sm text-gray-600">{((item.qty || 0) * (item.ratePerCarton || 0)).toLocaleString("en-US")}</span>{correctItems.length > 1 && <button onClick={() => setCorrectItems(ci => ci.filter((_, idx) => idx !== i))} className="text-red-500 text-lg">×</button>}</div>
            </div>
          ))}
          <button onClick={() => setCorrectItems(ci => [...ci, { productId: 0, qty: 0, ratePerCarton: 0 }])} className="text-xs text-primary-600 hover:underline">+ {t("add_item")}</button>
        </div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("cancel_reason")} *</label><input value={correctReason} onChange={e => setCorrectReason(e.target.value)} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCorrect(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleCorrect} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("correct_sale")}</button>
        </div>
      </Modal>

      {/* HARD DELETE 2FA MODAL */}
      <Modal open={showHardDelete} onClose={() => setShowHardDelete(false)} title={`⚠️ ${t("hard_delete")}`} size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">{t("permanent_delete_warning")}</p>
            <p>Sale: <span className="font-bold">{hardDeleteTarget?.voucherNo}</span></p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("enter_admin_password")}</label>
            <input
              type="password"
              value={hardDeletePassword}
              onChange={e => setHardDeletePassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleHardDelete()}
              className="input-field"
              placeholder={t("password")}
              autoFocus
            />
          </div>
          {hardDeleteError && <p className="text-sm text-red-600">{hardDeleteError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setShowHardDelete(false)} className="btn-secondary text-sm">{t("cancel")}</button>
            <button onClick={handleHardDelete} disabled={hardDeleteSubmitting} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {hardDeleteSubmitting ? "..." : t("hard_delete")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
