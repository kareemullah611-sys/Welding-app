"use client";
import React, { useEffect, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function LotCostingPage() {
  const { t } = useLang();

  const COST_TYPES = [
    { value: "freight", label: t("cost_type_freight") },
    { value: "customs_duty", label: t("cost_type_customs") },
    { value: "port_charges", label: t("cost_type_port") },
    { value: "transport", label: t("cost_type_transport") },
    { value: "loading_unloading", label: t("cost_type_loading") },
    { value: "insurance", label: t("cost_type_insurance") },
    { value: "other", label: t("cost_type_other") },
  ];
  const [lots, setLots] = useState<any[]>([]);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPurchase, setShowAddPurchase] = useState(false);
  const [showAddCost, setShowAddCost] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [purchaseForm, setPurchaseForm] = useState({ supplierId: 0, exchangeRate: 0, products: [{ productId: 0, qty: 0, unitPriceUsd: 0 }] as any[] });
  const [costForm, setCostForm] = useState({ costType: "freight", description: "", amount: 0, currencyCode: "PKR", exchangeRate: 0, costDate: new Date().toISOString().split("T")[0], notes: "", agentId: 0 });
  const [agents, setAgents] = useState<any[]>([]);

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
    const [purchR, costR] = await Promise.all([
      apiCall("/api/v1/lot-purchases", { params: { lot_id: lotId } }),
      apiCall("/api/v1/lot-costs", { params: { lot_id: lotId } }),
    ]);
    if (purchR.success) setPurchases(purchR.data as any[]);
    if (costR.success) setCosts(costR.data as any[]);
  };

  const selectLot = (lot: any) => { setSelectedLot(lot); loadLotData(lot.id); };

  const addProductRow = () => setPurchaseForm(f => ({ ...f, products: [...f.products, { productId: 0, qty: 0, unitPriceUsd: 0 }] }));
  const removeProductRow = (i: number) => setPurchaseForm(f => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }));
  const updateProductRow = (i: number, field: string, value: any) => setPurchaseForm(f => ({ ...f, products: f.products.map((p, idx) => idx === i ? { ...p, [field]: value } : p) }));

  const handleAddPurchase = async () => {
    if (!purchaseForm.supplierId || purchaseForm.products.some(p => !p.productId || !p.qty || !p.unitPriceUsd)) { setError(t("fill_all_fields")); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/lot-purchases", { method: "POST", body: { lotId: selectedLot.id, ...purchaseForm } });
    setSubmitting(false);
    if (r.success) { setShowAddPurchase(false); loadLotData(selectedLot.id); } else { setError(r.error || "Failed"); }
  };

  const handleAddCost = async () => {
    if (!costForm.description || !costForm.amount) { setError(t("fill_description_amount")); return; }
    setSubmitting(true);
    const body: any = { lotId: selectedLot.id, ...costForm };
    if (!body.agentId) delete body.agentId;
    const r = await apiCall("/api/v1/lot-costs", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowAddCost(false); loadLotData(selectedLot.id); } else { setError(r.error || "Failed"); }
  };

  const deleteCost = async (id: number) => { if (!confirm(t("confirm_delete_cost"))) return; await apiCall(`/api/v1/lot-costs/${id}`, { method: "DELETE" }); loadLotData(selectedLot.id); };

  const totalPurchaseUsd = purchases.reduce((s, p) => s + p.totalPriceUsd, 0);
  const totalCartons = purchases.reduce((s, p) => s + p.qty, 0);
  const [usdPkrRate, setUsdPkrRate] = useState(280);

  // Convert each cost to USD before summing:
  // - USD costs → added as-is
  // - PKR/AFN costs → divided by their stored exchangeRate (USD→local rate)
  //   If no exchangeRate was saved, fall back to the usdPkrRate slider on screen
  const totalCostsUsd = costs.reduce((s, c) => {
    if (c.currencyCode === "USD") return s + c.amount;
    const rate = c.exchangeRate && c.exchangeRate > 0 ? c.exchangeRate : usdPkrRate;
    return s + c.amount / rate;
  }, 0);

  const totalLanded = totalPurchaseUsd + totalCostsUsd;
  const landedPerCarton = totalCartons > 0 ? totalLanded / totalCartons : 0;
  const landedPerCartonPkr = landedPerCarton * usdPkrRate;

  return (
    <div>
      <PageHeader title={t("lot_costing")} subtitle={t("lot_costing_subtitle")} />

      {/* Lot selector */}
      <div className="card mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">{t("select_lot")}</label>
        <div className="flex flex-wrap gap-2">
          {lots.map(lot => (
            <button key={lot.id} onClick={() => selectLot(lot)} className={`px-3 py-2 rounded-lg text-sm border transition-colors ${selectedLot?.id === lot.id ? "bg-primary-600 text-white border-primary-600" : "bg-white border-gray-200 hover:border-primary-300"}`}>
              {lot.lotNumber} <span className="text-xs opacity-70">({lot.countryName})</span>
            </button>
          ))}
        </div>
      </div>

      {selectedLot && <>
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatsCard title={`${t("purchase_cost")} (USD)`} value={`$${formatNumber(totalPurchaseUsd)}`} icon="📦" color="blue" />
          <StatsCard title={t("additional_costs")} value={`$${formatNumber(Math.round(totalCostsUsd * 100) / 100)}`} icon="💸" color="red" />
          <StatsCard title={t("total_landed")} value={`$${formatNumber(totalLanded)}`} icon="🏷️" color="yellow" />
          <StatsCard title={t("total_cartons")} value={formatNumber(totalCartons)} icon="📦" color="blue" />
          <StatsCard title={t("cost_per_carton")} value={`PKR ${formatNumber(Math.round(landedPerCartonPkr))}`} icon="💰" color="green" />
          <div className="flex items-center gap-2 mt-1"><label className="text-xs text-gray-500">USD/PKR:</label><input type="number" value={usdPkrRate} onChange={e => setUsdPkrRate(parseFloat(e.target.value) || 0)} className="input-field w-24 text-xs" step="0.5" /></div>
        </div>

        {/* Purchase prices */}
        <div className="card mb-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-600">{t("purchase_prices")}</h3>
            <button onClick={() => { setPurchaseForm({ supplierId: suppliers[0]?.id || 0, exchangeRate: 0, products: [{ productId: 0, qty: 0, unitPriceUsd: 0 }] }); setShowAddPurchase(true); setError(""); }} className="btn-primary text-xs">+ {t("add_cost")}</button>
          </div>
          <DataTable columns={[
            { key: "supplierName", label: t("supplier") },
            { key: "productName", label: t("product") },
            { key: "qty", label: t("cartons"), render: (p: any) => formatNumber(p.qty) },
            { key: "unitPriceUsd", label: t("unit_price"), render: (p: any) => `$${p.unitPriceUsd}` },
            { key: "totalPriceUsd", label: t("total"), render: (p: any) => <span className="font-medium">${p.totalPriceUsd.toLocaleString()}</span> },
            { key: "exchangeRate", label: t("exchange_rate"), render: (p: any) => p.exchangeRate || "-" },
          ]} data={purchases} loading={false} emptyMessage={t("no_purchases")} />
        </div>

        {/* Additional costs */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-gray-600">{t("additional_costs")}</h3>
            <button onClick={() => { apiCall("/api/v1/agents", { params: { limit: 100 } }).then(r => { if (r.success) setAgents(r.data as any[]); }); setCostForm({ costType: "freight", description: "", amount: 0, currencyCode: "PKR", exchangeRate: 0, costDate: new Date().toISOString().split("T")[0], notes: "", agentId: 0 }); setShowAddCost(true); setError(""); }} className="btn-primary text-xs">+ {t("add_cost")}</button>
          </div>
          <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
            💡 {t("lot_costing_subtitle")}. {totalCartons > 0 && `${t("cartons")}: $${(totalCostsUsd / totalCartons).toFixed(2)}`}
          </div>
          <DataTable columns={[
            { key: "costType", label: t("type"), render: (c: any) => <span className="text-xs">{COST_TYPES.find(ct => ct.value === c.costType)?.label || c.costType}</span> },
            { key: "description", label: t("description") },
            { key: "amount", label: t("amount"), render: (c: any) => <span className="font-medium">{c.currencyCode === "USD" ? "$" : ""}{c.amount.toLocaleString()}</span> },
            { key: "costDate", label: t("date") },
            { key: "actions", label: "", render: (c: any) => <button onClick={() => deleteCost(c.id)} className="text-xs text-red-600 hover:underline"> {t("delete")}</button> },
          ]} data={costs} loading={false} emptyMessage={t("no_costs")} />
        </div>
      </>}

      {/* Add Purchase Modal */}
      <Modal open={showAddPurchase} onClose={() => setShowAddPurchase(false)} title={t("purchase_prices")} size="lg">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("supplier")} *</label><select value={purchaseForm.supplierId} onChange={e => setPurchaseForm(f => ({ ...f, supplierId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select")}</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("exchange_rate")} (USD→{t("currency")})</label><input type="number" step="0.01" value={purchaseForm.exchangeRate || ""} onChange={e => setPurchaseForm(f => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          </div>
          <h4 className="text-sm font-medium text-gray-700">{t("product")}</h4>
          {purchaseForm.products.map((p, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 items-end">
              <div><label className="block text-xs text-gray-500 mb-1">{t("product")}</label><select value={p.productId} onChange={e => updateProductRow(i, "productId", parseInt(e.target.value))} className="select-field text-sm"><option value={0}>{t("select")}</option>{products.map((pr: any) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}</select></div>
              <div><label className="block text-xs text-gray-500 mb-1">{t("cartons")}</label><input type="number" value={p.qty || ""} onChange={e => updateProductRow(i, "qty", parseFloat(e.target.value) || 0)} className="input-field text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">$/{t("cartons")}</label><input type="number" step="0.01" value={p.unitPriceUsd || ""} onChange={e => updateProductRow(i, "unitPriceUsd", parseFloat(e.target.value) || 0)} className="input-field text-sm" /></div>
              <div className="flex gap-1"><span className="text-sm font-medium text-gray-600 self-center">${((p.qty || 0) * (p.unitPriceUsd || 0)).toLocaleString()}</span>{i > 0 && <button onClick={() => removeProductRow(i)} className="text-red-500 text-lg">×</button>}</div>
            </div>
          ))}
          <button onClick={addProductRow} className="text-xs text-primary-600 hover:underline">+ {t("add_item")}</button>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowAddPurchase(false)} className="btn-secondary text-sm"> {t("cancel")}</button><button onClick={handleAddPurchase} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      {/* Add Cost Modal */}
      <Modal open={showAddCost} onClose={() => setShowAddCost(false)} title={t("add_cost")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")} *</label><select value={costForm.costType} onChange={e => setCostForm(f => ({ ...f, costType: e.target.value }))} className="select-field">{COST_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("description")} *</label><input value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("agent")}</label><select value={costForm.agentId} onChange={e => setCostForm(f => ({ ...f, agentId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("cash")}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.agentType})</option>)}</select></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" step="0.01" value={costForm.amount || ""} onChange={e => setCostForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label><select value={costForm.currencyCode} onChange={e => setCostForm(f => ({ ...f, currencyCode: e.target.value }))} className="select-field"><option value="USD">USD</option><option value="PKR">PKR</option><option value="AFN">AFN</option></select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label><input type="date" value={costForm.costDate} onChange={e => setCostForm(f => ({ ...f, costDate: e.target.value }))} className="input-field" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowAddCost(false)} className="btn-secondary text-sm"> {t("cancel")}</button><button onClick={handleAddCost} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </div>
  );
}
