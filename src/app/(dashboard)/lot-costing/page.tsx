"use client";
import React, { useEffect, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function LotCostingPage() {
  const { t } = useLang();

  const COST_TYPES = [
    { value: "freight",           label: t("cost_type_freight") },
    { value: "customs_duty",      label: t("cost_type_customs") },
    { value: "port_charges",      label: t("cost_type_port") },
    { value: "transport",         label: t("cost_type_transport") },
    { value: "loading_unloading", label: t("cost_type_loading") },
    { value: "insurance",         label: t("cost_type_insurance") },
    { value: "other",             label: t("cost_type_other") },
  ];

  const [lots,        setLots]        = useState<any[]>([]);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [lotProducts, setLotProducts] = useState<any[]>([]); // source-of-truth carton counts
  const [purchases,   setPurchases]   = useState<any[]>([]);
  const [costs,       setCosts]       = useState<any[]>([]);
  const [lotExpensesTotal, setLotExpensesTotal] = useState(0); // lot-tagged expenses included in landed cost
  const [suppliers,   setSuppliers]   = useState<any[]>([]);
  const [products,    setProducts]    = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [showAddCost,     setShowAddCost]     = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState("");
  const [agents,      setAgents]      = useState<any[]>([]);
  const [shippingLines, setShippingLines] = useState<any[]>([]);

  const [purchaseForm, setPurchaseForm] = useState<{ supplierId: number; exchangeRate: number; products: any[] }>({
    supplierId: 0, exchangeRate: 0, products: [{ productId: 0, qty: 0, unitPriceUsd: 0 }],
  });
  const [costForm, setCostForm] = useState({
    costType: "freight", description: "", amount: 0, currencyCode: "PKR",
    exchangeRate: 0, costDate: new Date().toISOString().split("T")[0], notes: "", agentId: 0, shippingLineId: 0,
  });

  // USD/PKR rate — seeded from stored records; user can override
  const [usdPkrRate, setUsdPkrRate] = useState(280);

  // ── Seed rate whenever purchases / costs change ──
  useEffect(() => {
    const fromPurchases = purchases.filter(p => p.exchangeRate > 0).map(p => p.exchangeRate);
    const fromCosts     = costs.filter(c => c.exchangeRate > 0).map(c => c.exchangeRate);
    const all = [...fromPurchases, ...fromCosts];
    if (all.length > 0) setUsdPkrRate(all[all.length - 1]); // latest stored rate
  }, [purchases, costs]);

  useEffect(() => {
    (async () => {
      const [lotsR, suppR, prodR] = await Promise.all([
        apiCall("/api/v1/lots", { params: { limit: 100 } }),
        apiCall("/api/v1/suppliers", { params: { limit: 100 } }),
        apiCall("/api/v1/products", { params: { limit: 100 } }),
      ]);
      if (lotsR.success) setLots(lotsR.data as any[]);
      if (suppR.success) setSuppliers(suppR.data as any[]);
      if (prodR.success) setProducts(prodR.data as any[]);
      setLoading(false);
    })();
  }, []);

  const loadLotData = async (lotId: number) => {
    const [purchR, costR, detailR] = await Promise.all([
      apiCall("/api/v1/lot-purchases", { params: { lot_id: lotId } }),
      apiCall("/api/v1/lot-costs",     { params: { lot_id: lotId } }),
      apiCall(`/api/v1/lots/${lotId}`),
    ]);
    if (purchR.success) setPurchases(purchR.data as any[]);
    if (costR.success)  setCosts(costR.data as any[]);
    if (detailR.success) {
      const d = detailR.data as any;
      // totalLotExpenses is already summed by the API into costSummary
      setLotExpensesTotal(d.costSummary?.totalLotExpenses ?? 0);
    }
  };

  const selectLot = async (lot: any) => {
    setSelectedLot(lot);
    setLotProducts([]);
    setLotExpensesTotal(0);
    // loadLotData now also fetches lot detail (products + expense totals)
    const [purchR, costR, detailR] = await Promise.all([
      apiCall("/api/v1/lot-purchases", { params: { lot_id: lot.id } }),
      apiCall("/api/v1/lot-costs",     { params: { lot_id: lot.id } }),
      apiCall(`/api/v1/lots/${lot.id}`),
    ]);
    if (purchR.success) setPurchases(purchR.data as any[]);
    if (costR.success)  setCosts(costR.data as any[]);
    if (detailR.success) {
      const d = detailR.data as any;
      setLotProducts(d.products || []);
      setLotExpensesTotal(d.costSummary?.totalLotExpenses ?? 0);
    }
  };

  // ── Purchase form helpers ──
  const updateProductRow = (i: number, field: string, value: any) => {
    setPurchaseForm(f => ({
      ...f,
      products: f.products.map((p, idx) => {
        if (idx !== i) return p;
        const row = { ...p, [field]: value };
        // Auto-fill qty when product is selected (only if currently 0)
        if (field === "productId") {
          const lp = lotProducts.find(l => l.productId === value);
          if (lp && (row.qty === 0 || row.qty === "")) row.qty = lp.totalQty;
        }
        return row;
      }),
    }));
  };

  const openAddPurchase = () => {
    // Pre-fill product rows from lot product list with qty auto-filled
    const prefilled = lotProducts.length > 0
      ? lotProducts.map(lp => ({ productId: lp.productId, qty: lp.totalQty, unitPriceUsd: 0 }))
      : [{ productId: 0, qty: 0, unitPriceUsd: 0 }];
    // Pre-fill exchange rate from the latest stored rate for this lot
    const latestRate = purchases.filter(p => p.exchangeRate > 0).slice(-1)[0]?.exchangeRate ?? 0;
    setPurchaseForm({ supplierId: 0, exchangeRate: latestRate, products: prefilled });
    setShowAddPurchase(true); setError("");
  };

  const openAddCost = async () => {
    const [agentsRes, shippingLinesRes] = await Promise.all([
      apiCall("/api/v1/agents", { params: { limit: 100 } }),
      apiCall("/api/v1/shipping-lines", { params: { limit: 100 } }),
    ]);
    if (agentsRes.success) setAgents(agentsRes.data as any[]);
    if (shippingLinesRes.success) setShippingLines((shippingLinesRes.data as any).items || shippingLinesRes.data as any[]);
    // Pre-fill exchange rate from latest stored rate
    const latestRate =
      purchases.filter(p => p.exchangeRate > 0).slice(-1)[0]?.exchangeRate ??
      costs.filter(c => c.exchangeRate > 0).slice(-1)[0]?.exchangeRate ?? 0;
    setCostForm({
      costType: "freight", description: "", amount: 0, currencyCode: "PKR",
      exchangeRate: latestRate, costDate: new Date().toISOString().split("T")[0], notes: "", agentId: 0, shippingLineId: 0,
    });
    setShowAddCost(true); setError("");
  };

  const handleAddPurchase = async () => {
    if (!purchaseForm.supplierId || purchaseForm.products.some(p => !p.productId || !p.qty || !p.unitPriceUsd)) {
      setError(t("fill_all_fields")); return;
    }
    setSubmitting(true);
    const r = await apiCall("/api/v1/lot-purchases", { method: "POST", body: { lotId: selectedLot.id, ...purchaseForm } });
    setSubmitting(false);
    if (r.success) { setShowAddPurchase(false); loadLotData(selectedLot.id); } else { setError(r.error || "Failed"); }
  };

  const handleAddCost = async () => {
    if (!costForm.description || !costForm.amount) { setError(t("fill_description_amount")); return; }
    if (costForm.costType === "freight" && !costForm.shippingLineId) { setError("Select a shipping line for freight"); return; }
    setSubmitting(true);
    const body: any = { lotId: selectedLot.id, ...costForm };
    if (body.costType === "freight") {
      delete body.agentId;
      if (!body.shippingLineId) delete body.shippingLineId;
    } else {
      delete body.shippingLineId;
      if (!body.agentId) delete body.agentId;
    }
    const r = await apiCall("/api/v1/lot-costs", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowAddCost(false); loadLotData(selectedLot.id); } else { setError(r.error || "Failed"); }
  };

  const deleteCost = async (id: number) => {
    if (!confirm(t("confirm_delete_cost"))) return;
    await apiCall(`/api/v1/lot-costs/${id}`, { method: "DELETE" });
    loadLotData(selectedLot.id);
  };

  // ── Calculations ──
  // Total cartons = lot product totals (source of truth, not sum of purchases)
  const totalLotCartons  = lotProducts.reduce((s, p) => s + Number(p.totalQty), 0);
  const totalPurchaseUsd = purchases.reduce((s, p) => s + Number(p.totalPriceUsd), 0);
  const totalCostsUsd    = costs.reduce((s, c) => {
    if (c.currencyCode === "USD") return s + Number(c.amount);
    const rate = c.exchangeRate > 0 ? c.exchangeRate : usdPkrRate;
    return s + Number(c.amount) / rate;
  }, 0);
  // Include lot-tagged expenses (paid from cash but linked to this lot) in landed cost
  const totalLanded       = totalPurchaseUsd + totalCostsUsd + lotExpensesTotal;
  const landedPerCarton   = totalLotCartons > 0 ? totalLanded / totalLotCartons : 0;
  const landedPerCartonPkr = landedPerCarton * usdPkrRate;

  // Per-product purchased totals (for over-purchase warning in form)
  const purchasedQtyByProduct: Record<number, number> = {};
  purchases.forEach(p => { purchasedQtyByProduct[p.productId] = (purchasedQtyByProduct[p.productId] || 0) + Number(p.qty); });

  return (
    <div>
      <PageHeader title={t("lot_costing")} subtitle={t("lot_costing_subtitle")} />

      {/* ── Lot selector ── */}
      <div className="card mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">{t("select_lot")}</label>
        <div className="flex flex-wrap gap-2">
          {lots.map(lot => (
            <button key={lot.id} onClick={() => selectLot(lot)}
              className={`px-3 py-2 rounded-lg text-sm border transition-colors ${selectedLot?.id === lot.id ? "bg-primary-600 text-white border-primary-600" : "bg-white border-gray-200 hover:border-primary-300"}`}>
              {lot.lotNumber} <span className="text-xs opacity-70">({lot.countryName})</span>
            </button>
          ))}
        </div>
      </div>

      {selectedLot && <>
        {/* ── Lot product summary banner ── */}
        {lotProducts.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold">📦 {t("lot_products")}:</span>
            {lotProducts.map((lp, i) => (
              <span key={lp.productId}>
                {lp.productName}: <strong>{formatNumber(lp.totalQty)}</strong> {t("cartons")}
                {purchasedQtyByProduct[lp.productId] > 0 && (
                  <span className={`ml-1 text-xs ${purchasedQtyByProduct[lp.productId] > lp.totalQty ? "text-red-600 font-bold" : "text-blue-500"}`}>
                    ({formatNumber(purchasedQtyByProduct[lp.productId])} purchased)
                  </span>
                )}
              </span>
            ))}
            <span className="text-blue-500 text-xs">· Total: {formatNumber(totalLotCartons)} {t("cartons")}</span>
          </div>
        )}

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatsCard title={`${t("purchase_cost")} (USD)`} value={`$${formatNumber(totalPurchaseUsd)}`} icon="📦" color="blue" />
          <StatsCard title={t("additional_costs")} value={`$${formatNumber(Math.round((totalCostsUsd + lotExpensesTotal) * 100) / 100)}${lotExpensesTotal > 0 ? ` (incl. $${formatNumber(lotExpensesTotal)} exp.)` : ""}`} icon="💸" color="red" />
          <StatsCard title={t("total_landed")} value={`$${formatNumber(Math.round(totalLanded * 100) / 100)}`} icon="🏷️" color="yellow" />
          <StatsCard title={t("total_cartons")} value={formatNumber(totalLotCartons)} icon="📦" color="blue" />
          <StatsCard title={`${t("cost_per_carton")} (USD)`} value={`$${(Math.round(landedPerCarton * 100) / 100).toFixed(2)}`} icon="💰" color="green" />
          <StatsCard title={`${t("cost_per_carton")} (PKR)`} value={`PKR ${formatNumber(Math.round(landedPerCartonPkr))}`} icon="💵" color="green" />
        </div>
        <div className="flex items-center gap-2 mb-4 -mt-2">
          <label className="text-xs text-gray-500">USD/PKR rate:</label>
          <input type="number" value={usdPkrRate} onChange={e => setUsdPkrRate(parseFloat(e.target.value) || 0)} className="input-field w-28 text-xs" step="0.5" />
          <span className="text-xs text-gray-400">(used for non-USD cost conversion)</span>
        </div>

        {/* ── Purchase prices table ── */}
        <div className="card mb-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-600">{t("purchase_prices")}</h3>
            <button onClick={openAddPurchase} className="btn-primary text-xs">+ {t("add_cost")}</button>
          </div>
          <DataTable columns={[
            { key: "supplierName",  label: t("supplier") },
            { key: "productName",   label: t("product") },
            { key: "qty",           label: t("cartons"),    render: (p: any) => formatNumber(p.qty) },
            { key: "unitPriceUsd",  label: t("unit_price"), render: (p: any) => `$${p.unitPriceUsd}` },
            { key: "totalPriceUsd", label: t("total"),      render: (p: any) => <span className="font-medium">${Number(p.totalPriceUsd).toLocaleString("en-US")}</span> },
            { key: "exchangeRate",  label: t("exchange_rate"), render: (p: any) => p.exchangeRate ? p.exchangeRate : "-" },
          ]} data={purchases} loading={false} emptyMessage={t("no_purchases")} />
        </div>

        {/* ── Additional costs table ── */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-600">{t("additional_costs")}</h3>
            <button onClick={openAddCost} className="btn-primary text-xs">+ {t("add_cost")}</button>
          </div>
          {totalLotCartons > 0 && (
            <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
              💡 Additional costs per carton: <strong>${(totalCostsUsd / totalLotCartons).toFixed(2)}</strong>
              {" "}· Total landed per carton: <strong>${landedPerCarton.toFixed(2)}</strong> / <strong>PKR {formatNumber(Math.round(landedPerCartonPkr))}</strong>
            </div>
          )}
          <DataTable columns={[
            { key: "costType",    label: t("type"),        render: (c: any) => <span className="text-xs">{COST_TYPES.find(ct => ct.value === c.costType)?.label || c.costType}</span> },
            { key: "description", label: t("description") },
            { key: "amount",      label: t("amount"),      render: (c: any) => <span className="font-medium">{c.currencyCode !== "USD" ? c.currencyCode + " " : "$"}{Number(c.amount).toLocaleString("en-US")}</span> },
            { key: "usdEquiv",    label: "≈ USD",          render: (c: any) => {
              if (c.currencyCode === "USD") return `$${Number(c.amount).toFixed(2)}`;
              const rate = c.exchangeRate > 0 ? c.exchangeRate : usdPkrRate;
              return <span className="text-gray-400 text-xs">${(Number(c.amount) / rate).toFixed(2)}</span>;
            }},
            { key: "costDate",    label: t("date") },
            { key: "actions",     label: "", render: (c: any) => <button onClick={() => deleteCost(c.id)} className="text-xs text-red-600 hover:underline">{t("delete")}</button> },
          ]} data={costs} loading={false} emptyMessage={t("no_costs")} />
        </div>
      </>}

      {/* ══════════════ ADD PURCHASE MODAL ══════════════ */}
      <Modal open={showAddPurchase} onClose={() => setShowAddPurchase(false)} title={t("purchase_prices")} size="lg">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("supplier")} *</label>
              <select value={purchaseForm.supplierId} onChange={e => setPurchaseForm(f => ({ ...f, supplierId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("select")}</option>
                {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("exchange_rate")} (USD→{t("currency")})</label>
              <input type="number" step="0.01" value={purchaseForm.exchangeRate || ""} placeholder="e.g. 280"
                onChange={e => setPurchaseForm(f => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" />
            </div>
          </div>

          <h4 className="text-sm font-medium text-gray-700 pt-1">{t("product")}</h4>
          {purchaseForm.products.map((p, i) => {
            const lp = lotProducts.find(l => l.productId === p.productId);
            const alreadyPurchased = purchasedQtyByProduct[p.productId] || 0;
            const totalAfterThis = alreadyPurchased + (Number(p.qty) || 0);
            const isOverQty = lp && totalAfterThis > lp.totalQty;
            return (
              <div key={i} className="space-y-1">
                <div className="grid grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">{t("product")}</label>
                    <select value={p.productId} onChange={e => updateProductRow(i, "productId", parseInt(e.target.value))} className="select-field text-sm">
                      <option value={0}>{t("select")}</option>
                      {products.map((pr: any) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      {t("cartons")}
                      {lp && <span className="ml-1 text-blue-500">(lot total: {formatNumber(lp.totalQty)})</span>}
                    </label>
                    <input type="number" value={p.qty || ""} min={0}
                      onChange={e => updateProductRow(i, "qty", parseFloat(e.target.value) || 0)}
                      className={`input-field text-sm ${isOverQty ? "border-amber-400 bg-amber-50" : ""}`} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">$/{t("cartons")}</label>
                    <input type="number" step="0.01" value={p.unitPriceUsd || ""}
                      onChange={e => updateProductRow(i, "unitPriceUsd", parseFloat(e.target.value) || 0)}
                      className="input-field text-sm" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-gray-600">${((Number(p.qty) || 0) * (Number(p.unitPriceUsd) || 0)).toLocaleString("en-US")}</span>
                    {i > 0 && <button onClick={() => setPurchaseForm(f => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }))} className="text-red-500 text-xl leading-none ml-1">×</button>}
                  </div>
                </div>
                {isOverQty && (
                  <p className="text-xs text-amber-600 pl-1">
                    ⚠ Already purchased {formatNumber(alreadyPurchased)} + this {formatNumber(Number(p.qty) || 0)} = {formatNumber(totalAfterThis)} exceeds lot qty {formatNumber(lp!.totalQty)}
                  </p>
                )}
              </div>
            );
          })}
          <button onClick={() => setPurchaseForm(f => ({ ...f, products: [...f.products, { productId: 0, qty: 0, unitPriceUsd: 0 }] }))} className="text-xs text-primary-600 hover:underline">
            + {t("add_item")}
          </button>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowAddPurchase(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleAddPurchase} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* ══════════════ ADD COST MODAL ══════════════ */}
      <Modal open={showAddCost} onClose={() => setShowAddCost(false)} title={t("add_cost")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("type")} *</label>
            <select value={costForm.costType} onChange={e => setCostForm(f => ({ ...f, costType: e.target.value, agentId: 0, shippingLineId: 0 }))} className="select-field">
              {COST_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("description")} *</label>
            <input value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} className="input-field" />
          </div>
          {costForm.costType === "freight" ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Line *</label>
              <select value={costForm.shippingLineId} onChange={e => setCostForm(f => ({ ...f, shippingLineId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("select")}</option>
                {shippingLines.map((line: any) => <option key={line.id} value={line.id}>{line.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">Freight costs must be booked to a shipping line, not a clearing agent.</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("agent")}</label>
              <select value={costForm.agentId} onChange={e => setCostForm(f => ({ ...f, agentId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("cash")}</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.agentType})</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
              <input type="number" step="0.01" value={costForm.amount || ""}
                onChange={e => setCostForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
              <select value={costForm.currencyCode} onChange={e => setCostForm(f => ({ ...f, currencyCode: e.target.value }))} className="select-field">
                <option value="USD">USD</option>
                <option value="PKR">PKR</option>
                <option value="AFN">AFN</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label>
              <input type="date" value={costForm.costDate} onChange={e => setCostForm(f => ({ ...f, costDate: e.target.value }))} className="input-field" />
            </div>
          </div>
          {costForm.currencyCode !== "USD" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("exchange_rate")} (USD→{costForm.currencyCode})
              </label>
              <input type="number" step="0.01" placeholder="e.g. 280"
                value={costForm.exchangeRate || ""}
                onChange={e => setCostForm(f => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))}
                className="input-field" />
            </div>
          )}
          {costForm.currencyCode !== "USD" && costForm.amount > 0 && (
            <p className="text-xs text-gray-500">
              ≈ USD ${costForm.exchangeRate > 0 ? (costForm.amount / costForm.exchangeRate).toFixed(2) : `(enter exchange rate)`}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowAddCost(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleAddCost} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
