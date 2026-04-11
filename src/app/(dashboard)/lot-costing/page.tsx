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
    { value: "customs_agent",     label: "Customs Agent" },
    { value: "clearing_agent",    label: "Clearing Agent" },
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
  const [lotExpensesByCurrency, setLotExpensesByCurrency] = useState<Record<string, number>>({});
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
    costType: "freight", description: "", amount: 0, currencyCode: "USD",
    exchangeRate: 0, costDate: new Date().toISOString().split("T")[0], notes: "", agentId: 0, shippingLineId: 0,
  });

  // USD/PKR rate — seeded from stored records; user can override
  const [usdPkrRate, setUsdPkrRate] = useState(280);
  const [afnPkrRate, setAfnPkrRate] = useState(0);
  const selectedLotCountryCode = String(selectedLot?.countryCode || selectedLot?.country?.code || "").toUpperCase();
  const nonFreightCurrency = selectedLotCountryCode === "AFG" ? "AFN" : "PKR";

  // ── Seed rate whenever purchases / costs change ──
  useEffect(() => {
    const fromPurchases = purchases.filter(p => p.exchangeRate > 0).map(p => p.exchangeRate);
    const fromFreightCosts = costs.filter(c => c.costType === "freight" && c.exchangeRate > 0).map(c => c.exchangeRate);
    const usdRates = [...fromPurchases, ...fromFreightCosts];
    if (usdRates.length > 0) setUsdPkrRate(usdRates[usdRates.length - 1]); // latest USD→PKR rate

    const afnRates = costs
      .filter(c => String(c.currencyCode || "").toUpperCase() === "AFN" && c.exchangeRate > 0)
      .map(c => c.exchangeRate);
    if (afnRates.length > 0) setAfnPkrRate(afnRates[afnRates.length - 1]); // latest AFN→PKR rate
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
      setLotExpensesByCurrency(d.costSummary?.lotExpensesByCurrency || {});
    }
  };

  const selectLot = async (lot: any) => {
    setSelectedLot(lot);
    setLotProducts([]);
    setLotExpensesByCurrency({});
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
      setLotExpensesByCurrency(d.costSummary?.lotExpensesByCurrency || {});
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
    const latestUsdRate =
      purchases.filter(p => p.exchangeRate > 0).slice(-1)[0]?.exchangeRate ??
      costs.filter(c => c.costType === "freight" && c.exchangeRate > 0).slice(-1)[0]?.exchangeRate ?? 0;
    setCostForm({
      costType: "freight", description: "", amount: 0, currencyCode: "USD",
      exchangeRate: latestUsdRate || usdPkrRate, costDate: new Date().toISOString().split("T")[0], notes: "", agentId: 0, shippingLineId: 0,
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
    const isFreight = costForm.costType === "freight";
    const isAfgNonFreight = !isFreight && nonFreightCurrency === "AFN";
    if ((isFreight || isAfgNonFreight) && Number(costForm.exchangeRate) <= 0) {
      setError(isFreight ? "Enter a costing exchange rate for freight" : "Enter AFN→PKR exchange rate");
      return;
    }
    if (isFreight && !costForm.shippingLineId) { setError("Select a shipping line for freight"); return; }
    setSubmitting(true);
    const body: any = {
      lotId: selectedLot.id,
      ...costForm,
      currencyCode: isFreight ? "USD" : nonFreightCurrency,
      exchangeRate: isFreight || isAfgNonFreight ? Number(costForm.exchangeRate || 0) : null,
    };
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
  const resolveCostPkr = (c: any) => {
    const amount = Number(c.amount || 0);
    if (!amount) return 0;
    const code = String(c.currencyCode || "PKR").toUpperCase();
    if (code === "PKR") return amount;
    if (code === "AFN") {
      const rate = Number(c.exchangeRate || 0);
      return rate > 0 ? amount * rate : 0;
    }
    if (code === "USD") {
      const rate = Number(c.exchangeRate || 0) > 0 ? Number(c.exchangeRate) : usdPkrRate;
      return rate > 0 ? amount * rate : 0;
    }
    // Legacy fallback for pre-rule records (e.g. AFN): convert via USD when possible.
    const legacyRate = Number(c.exchangeRate || 0);
    if (legacyRate <= 0 || usdPkrRate <= 0) return 0;
    return (amount / legacyRate) * usdPkrRate;
  };
  const lotExpensesPkr =
    Number(lotExpensesByCurrency["PKR"] || 0) +
    Number(lotExpensesByCurrency["USD"] || 0) * usdPkrRate +
    Number(lotExpensesByCurrency["AFN"] || 0) * afnPkrRate;
  const hasUnconvertedAfnExpenses = Number(lotExpensesByCurrency["AFN"] || 0) > 0 && afnPkrRate <= 0;
  const totalCostsPkr = costs.reduce((s, c) => s + resolveCostPkr(c), 0);
  const totalPurchasePkr = totalPurchaseUsd * usdPkrRate;
  const totalLandedPkr = totalPurchasePkr + totalCostsPkr + lotExpensesPkr;
  const landedPerCartonPkr = totalLotCartons > 0 ? totalLandedPkr / totalLotCartons : 0;
  const landedPerCarton = usdPkrRate > 0 ? landedPerCartonPkr / usdPkrRate : 0;

  const costPkrByType = costs.reduce<Record<string, number>>((acc, c) => {
    acc[c.costType] = (acc[c.costType] || 0) + resolveCostPkr(c);
    return acc;
  }, {});

  const purchaseByProduct = purchases.reduce<Record<number, { productName: string; cartons: number; purchaseUsd: number; weightKg: number }>>((acc, p) => {
    if (!acc[p.productId]) acc[p.productId] = { productName: p.productName, cartons: 0, purchaseUsd: 0, weightKg: 0 };
    acc[p.productId].cartons += Number(p.qty || 0);
    acc[p.productId].purchaseUsd += Number(p.totalPriceUsd || 0);
    acc[p.productId].weightKg += Number(p.qty || 0) * Number(p.weightPerCartonKg || 0);
    return acc;
  }, {});
  const productRows = Object.entries(purchaseByProduct).map(([productId, row]) => ({ productId: Number(productId), ...row }));
  const totalPurchaseBase = productRows.reduce((sum, row) => sum + row.purchaseUsd, 0);
  const totalWeightBase = productRows.reduce((sum, row) => sum + row.weightKg, 0);
  const equalShareTypes = ["port_charges", "loading_unloading", "insurance", "other", "customs_agent", "clearing_agent"];
  const equalSharePkr = equalShareTypes.reduce((sum, type) => sum + (costPkrByType[type] || 0), 0) + lotExpensesPkr;
  const perProductEqualShare = productRows.length > 0 ? equalSharePkr / productRows.length : 0;
  const landedCostRows = productRows.map((row) => {
    const purchasePkr = row.purchaseUsd * usdPkrRate;
    const customsShare = totalPurchaseBase > 0 ? ((costPkrByType.customs_duty || 0) * row.purchaseUsd) / totalPurchaseBase : 0;
    const freightShare = totalWeightBase > 0 ? ((costPkrByType.freight || 0) * row.weightKg) / totalWeightBase : 0;
    const transportShare = totalWeightBase > 0 ? ((costPkrByType.transport || 0) * row.weightKg) / totalWeightBase : 0;
    const equalShare = perProductEqualShare;
    const landedTotalPkr = purchasePkr + customsShare + freightShare + transportShare + equalShare;
    const landedPerCartonPkr = row.cartons > 0 ? landedTotalPkr / row.cartons : 0;
    return {
      ...row,
      purchasePkr,
      landedTotalPkr,
      landedTotalUsd: usdPkrRate > 0 ? landedTotalPkr / usdPkrRate : 0,
      landedPerCartonPkr,
      landedPerCartonUsd: usdPkrRate > 0 ? landedPerCartonPkr / usdPkrRate : 0,
      overheadPkr: customsShare + freightShare + transportShare + equalShare,
    };
  });

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
        <div className="mb-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
          This page is now analysis-only. Add or edit purchase prices and additional costs from the <strong>Lots</strong> module.
        </div>

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
          <StatsCard title={`${t("additional_costs")} (PKR)`} value={`PKR ${formatNumber(Math.round(totalCostsPkr + lotExpensesPkr))}${lotExpensesPkr > 0 ? ` (incl. ${formatNumber(Math.round(lotExpensesPkr))} city exp.)` : ""}`} icon="💸" color="red" />
          <StatsCard title={`${t("total_landed")} (PKR)`} value={`PKR ${formatNumber(Math.round(totalLandedPkr))}`} icon="🏷️" color="yellow" />
          <StatsCard title={t("total_cartons")} value={formatNumber(totalLotCartons)} icon="📦" color="blue" />
          <StatsCard title={`${t("cost_per_carton")} (USD)`} value={`$${(Math.round(landedPerCarton * 100) / 100).toFixed(2)}`} icon="💰" color="green" />
          <StatsCard title={`${t("cost_per_carton")} (PKR)`} value={`PKR ${formatNumber(Math.round(landedPerCartonPkr))}`} icon="💵" color="green" />
        </div>
        <div className="flex items-center gap-2 mb-4 -mt-2">
          <label className="text-xs text-gray-500">USD/PKR rate:</label>
          <input type="number" value={usdPkrRate} onChange={e => setUsdPkrRate(parseFloat(e.target.value) || 0)} className="input-field w-28 text-xs" step="0.5" />
          <span className="text-xs text-gray-400">(fallback conversion rate for old records)</span>
          {(selectedLotCountryCode === "AFG" || Number(lotExpensesByCurrency["AFN"] || 0) > 0) && (
            <>
              <label className="text-xs text-gray-500 ml-3">AFN/PKR rate:</label>
              <input type="number" value={afnPkrRate || ""} onChange={e => setAfnPkrRate(parseFloat(e.target.value) || 0)} className="input-field w-28 text-xs" step="0.0001" />
            </>
          )}
        </div>
        {hasUnconvertedAfnExpenses && (
          <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            Afghanistan lot expenses are in AFN. Enter AFN/PKR rate above so these expenses are included in PKR landed cost.
          </div>
        )}

        {/* ── Purchase prices table ── */}
        <div className="card mb-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-600">{t("purchase_prices")}</h3>
            <span className="text-xs text-gray-400">Managed in Lots</span>
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
            <span className="text-xs text-gray-400">Managed in Lots</span>
          </div>
          {totalLotCartons > 0 && (
            <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
              💡 Additional costs per carton: <strong>PKR {formatNumber(Math.round((totalCostsPkr + lotExpensesPkr) / totalLotCartons))}</strong>
              {" "}· Total landed per carton: <strong>PKR {formatNumber(Math.round(landedPerCartonPkr))}</strong> / <strong>${landedPerCarton.toFixed(2)}</strong>
            </div>
          )}
          <DataTable columns={[
            { key: "costType",    label: t("type"),        render: (c: any) => <span className="text-xs">{COST_TYPES.find(ct => ct.value === c.costType)?.label || c.costType}</span> },
            { key: "description", label: t("description") },
            { key: "amount",      label: t("amount"),      render: (c: any) => <span className="font-medium">{c.currencyCode !== "USD" ? c.currencyCode + " " : "$"}{Number(c.amount).toLocaleString("en-US")}</span> },
            { key: "exchangeRate", label: "Costing Rate", render: (c: any) => (c.costType === "freight" || String(c.currencyCode || "").toUpperCase() === "AFN") ? (c.exchangeRate ? c.exchangeRate : "—") : "—" },
            { key: "pkrEquiv",    label: "≈ PKR",          render: (c: any) => {
              const pkr = resolveCostPkr(c);
              return <span className="text-gray-500 text-xs">PKR {formatNumber(Math.round(pkr))}</span>;
            }},
            { key: "costDate",    label: t("date") },
          ]} data={costs} loading={false} emptyMessage={t("no_costs")} />
        </div>

        <div className="card mt-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">Landed Cost Per Carton by Item</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Item</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Cartons</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Weight</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Purchase USD</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Per Carton PKR</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Overheads PKR</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Landed PKR</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Per Carton USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {landedCostRows.map((row) => (
                  <tr key={row.productId}>
                    <td className="px-3 py-2 font-medium text-gray-800">{row.productName}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.cartons)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(row.weightKg)} kg</td>
                    <td className="px-3 py-2 text-right">${row.purchaseUsd.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-blue-700">PKR {formatNumber(Math.round(row.landedPerCartonPkr))}</td>
                    <td className="px-3 py-2 text-right">PKR {formatNumber(Math.round(row.overheadPkr))}</td>
                    <td className="px-3 py-2 text-right font-medium">PKR {formatNumber(Math.round(row.landedTotalPkr))}</td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700">${row.landedPerCartonUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Customs duty is allocated by purchase value. Freight and transport are allocated by item weight. Port, loading, insurance, other charges, and lot-tagged expenses are shared equally across items.
          </p>
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
            <select value={costForm.costType} onChange={e => {
              const type = e.target.value;
              const isFreight = type === "freight";
              setCostForm(f => ({
                ...f,
                costType: type,
                currencyCode: isFreight ? "USD" : nonFreightCurrency,
                exchangeRate: isFreight ? (f.exchangeRate || usdPkrRate || 0) : (nonFreightCurrency === "AFN" ? (f.exchangeRate || afnPkrRate || 0) : 0),
                agentId: 0,
                shippingLineId: 0,
              }));
            }} className="select-field">
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
              <input value={costForm.costType === "freight" ? "USD" : nonFreightCurrency} disabled className="input-field bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label>
              <input type="date" value={costForm.costDate} onChange={e => setCostForm(f => ({ ...f, costDate: e.target.value }))} className="input-field" />
            </div>
          </div>
          {(costForm.costType === "freight" || nonFreightCurrency === "AFN") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {costForm.costType === "freight" ? "Costing Exchange Rate (USD→PKR) *" : "Costing Exchange Rate (AFN→PKR) *"}
              </label>
              <input type="number" step="0.01" placeholder="e.g. 280"
                value={costForm.exchangeRate || ""}
                onChange={e => setCostForm(f => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))}
                className="input-field" />
              {costForm.costType === "freight" && (
                <p className="mt-1 text-xs text-gray-500">Use this rate only for landed-costing. The shipping-line settlement rate can be different later.</p>
              )}
            </div>
          )}
          {costForm.amount > 0 && (
            <p className="text-xs text-gray-500">
              {(costForm.costType === "freight" || nonFreightCurrency === "AFN")
                ? `≈ PKR ${costForm.exchangeRate > 0 ? formatNumber(Math.round(costForm.amount * costForm.exchangeRate)) : "(enter exchange rate)"}`
                : `PKR ${formatNumber(Math.round(costForm.amount))}`
              }
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
