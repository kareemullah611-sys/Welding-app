"use client";

import React, { useEffect, useMemo, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { DataTable, PageHeader, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

const COST_TYPES: Record<string, string> = {
  freight: "Freight",
  customs_duty: "Customs Duty",
  customs_agent: "Customs Agent",
  clearing_agent: "Clearing Agent",
  port_charges: "Port Charges",
  transport: "Transport",
  loading_unloading: "Loading / Unloading",
  insurance: "Insurance",
  other: "Other",
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function LotCostingPage() {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [lots, setLots] = useState<any[]>([]);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [lotProducts, setLotProducts] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [lotExpensesByCurrency, setLotExpensesByCurrency] = useState<Record<string, number>>({});

  const [usdPkrRate, setUsdPkrRate] = useState(280);
  const [afnPkrRate, setAfnPkrRate] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const lotsRes = await apiCall("/api/v1/lots", { params: { limit: 100 } });
      if (lotsRes.success) {
        setLots((lotsRes.data as any[]) || []);
      } else {
        setError(lotsRes.error || "Failed to load lots");
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const usdFromPurchases = purchases.filter((p) => toNumber(p.exchangeRate) > 0).map((p) => toNumber(p.exchangeRate));
    const usdFromFreightCosts = costs
      .filter((c) => c.costType === "freight" && toNumber(c.exchangeRate) > 0)
      .map((c) => toNumber(c.exchangeRate));
    const usdRates = [...usdFromPurchases, ...usdFromFreightCosts];
    if (usdRates.length > 0) setUsdPkrRate(usdRates[usdRates.length - 1]);

    const afnRates = costs
      .filter((c) => String(c.currencyCode || "").toUpperCase() === "AFN" && toNumber(c.exchangeRate) > 0)
      .map((c) => toNumber(c.exchangeRate));
    if (afnRates.length > 0) setAfnPkrRate(afnRates[afnRates.length - 1]);
  }, [purchases, costs]);

  const loadLotData = async (lot: any) => {
    setSelectedLot(lot);
    setError("");
    const [purchasesRes, costsRes, detailRes] = await Promise.all([
      apiCall("/api/v1/lot-purchases", { params: { lot_id: lot.id } }),
      apiCall("/api/v1/lot-costs", { params: { lot_id: lot.id } }),
      apiCall(`/api/v1/lots/${lot.id}`),
    ]);

    if (purchasesRes.success) setPurchases((purchasesRes.data as any[]) || []);
    else setPurchases([]);

    if (costsRes.success) setCosts((costsRes.data as any[]) || []);
    else setCosts([]);

    if (detailRes.success) {
      const detail = detailRes.data as any;
      setLotProducts(detail.products || []);
      setLotExpensesByCurrency(detail.costSummary?.lotExpensesByCurrency || {});
    } else {
      setLotProducts([]);
      setLotExpensesByCurrency({});
    }
  };

  const selectedLotCountryCode = String(selectedLot?.countryCode || selectedLot?.country?.code || "").toUpperCase();

  const resolveCostPkr = (cost: any) => {
    const amount = toNumber(cost?.amount);
    if (!amount) return 0;
    const currencyCode = String(cost?.currencyCode || "PKR").toUpperCase();

    if (currencyCode === "PKR") return amount;
    if (currencyCode === "AFN") {
      const rate = toNumber(cost?.exchangeRate);
      return rate > 0 ? amount * rate : 0;
    }
    if (currencyCode === "USD") {
      const rate = toNumber(cost?.exchangeRate) > 0 ? toNumber(cost?.exchangeRate) : usdPkrRate;
      return rate > 0 ? amount * rate : 0;
    }

    const legacyRate = toNumber(cost?.exchangeRate);
    if (legacyRate <= 0 || usdPkrRate <= 0) return 0;
    return (amount / legacyRate) * usdPkrRate;
  };

  const totalLotCartons = useMemo(
    () => lotProducts.reduce((sum, p) => sum + toNumber(p.totalQty), 0),
    [lotProducts]
  );
  const totalPurchaseUsd = useMemo(
    () => purchases.reduce((sum, p) => sum + toNumber(p.totalPriceUsd), 0),
    [purchases]
  );
  const totalCostsPkr = useMemo(
    () => costs.reduce((sum, c) => sum + resolveCostPkr(c), 0),
    [costs, usdPkrRate]
  );
  const lotExpensesPkr =
    toNumber(lotExpensesByCurrency.PKR) +
    toNumber(lotExpensesByCurrency.USD) * usdPkrRate +
    toNumber(lotExpensesByCurrency.AFN) * afnPkrRate;
  const totalPurchasePkr = totalPurchaseUsd * usdPkrRate;
  const totalLandedPkr = totalPurchasePkr + totalCostsPkr + lotExpensesPkr;
  const landedPerCartonPkr = totalLotCartons > 0 ? totalLandedPkr / totalLotCartons : 0;
  const landedPerCartonUsd = usdPkrRate > 0 ? landedPerCartonPkr / usdPkrRate : 0;

  const hasUnconvertedAfnExpenses = toNumber(lotExpensesByCurrency.AFN) > 0 && afnPkrRate <= 0;

  const costPkrByType = useMemo(() => {
    return costs.reduce<Record<string, number>>((acc, c) => {
      acc[c.costType] = (acc[c.costType] || 0) + resolveCostPkr(c);
      return acc;
    }, {});
  }, [costs, usdPkrRate]);

  const landedCostRows = useMemo(() => {
    const purchaseByProduct = purchases.reduce<
      Record<number, { productName: string; cartons: number; purchaseUsd: number; weightKg: number }>
    >((acc, purchase) => {
      const productId = toNumber(purchase.productId);
      if (!productId) return acc;
      if (!acc[productId]) {
        acc[productId] = { productName: purchase.productName || "-", cartons: 0, purchaseUsd: 0, weightKg: 0 };
      }
      acc[productId].cartons += toNumber(purchase.qty);
      acc[productId].purchaseUsd += toNumber(purchase.totalPriceUsd);
      acc[productId].weightKg += toNumber(purchase.qty) * toNumber(purchase.weightPerCartonKg);
      return acc;
    }, {});

    const productRows = Object.entries(purchaseByProduct).map(([productId, row]) => ({
      productId: Number(productId),
      ...row,
    }));
    const totalPurchaseBase = productRows.reduce((sum, row) => sum + row.purchaseUsd, 0);
    const totalWeightBase = productRows.reduce((sum, row) => sum + row.weightKg, 0);
    const equalShareTypes = ["port_charges", "loading_unloading", "insurance", "other", "customs_agent", "clearing_agent"];
    const equalSharePkr = equalShareTypes.reduce((sum, type) => sum + (costPkrByType[type] || 0), 0) + lotExpensesPkr;
    const perProductEqualShare = productRows.length > 0 ? equalSharePkr / productRows.length : 0;

    return productRows.map((row) => {
      const purchasePkr = row.purchaseUsd * usdPkrRate;
      const customsShare = totalPurchaseBase > 0 ? ((costPkrByType.customs_duty || 0) * row.purchaseUsd) / totalPurchaseBase : 0;
      const freightShare = totalWeightBase > 0 ? ((costPkrByType.freight || 0) * row.weightKg) / totalWeightBase : 0;
      const transportShare = totalWeightBase > 0 ? ((costPkrByType.transport || 0) * row.weightKg) / totalWeightBase : 0;
      const equalShare = perProductEqualShare;
      const overheadPkr = customsShare + freightShare + transportShare + equalShare;
      const landedTotalPkr = purchasePkr + overheadPkr;
      const landedPerCarton = row.cartons > 0 ? landedTotalPkr / row.cartons : 0;

      return {
        ...row,
        overheadPkr,
        landedTotalPkr,
        landedPerCartonPkr: landedPerCarton,
        landedPerCartonUsd: usdPkrRate > 0 ? landedPerCarton / usdPkrRate : 0,
      };
    });
  }, [costPkrByType, lotExpensesPkr, purchases, usdPkrRate]);

  const purchasedQtyByProduct = useMemo(() => {
    return purchases.reduce<Record<number, number>>((acc, purchase) => {
      const productId = toNumber(purchase.productId);
      if (!productId) return acc;
      acc[productId] = (acc[productId] || 0) + toNumber(purchase.qty);
      return acc;
    }, {});
  }, [purchases]);

  return (
    <div>
      <PageHeader title={t("lot_costing")} subtitle="Read-only landed cost analysis. Manage purchases and costs in Lots." />

      <div className="card mb-6">
        <label className="mb-2 block text-sm font-medium text-gray-700">{t("select_lot")}</label>
        <div className="flex flex-wrap gap-2">
          {lots.map((lot) => (
            <button
              key={lot.id}
              onClick={() => loadLotData(lot)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                selectedLot?.id === lot.id
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-gray-200 bg-white hover:border-primary-300"
              }`}
            >
              {lot.lotNumber} <span className="text-xs opacity-70">({lot.countryName})</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {selectedLot && (
        <>
          <div className="mb-4 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            This screen is analysis-only. Use the <strong>Lots</strong> module for purchase and additional cost entry.
          </div>

          {lotProducts.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <span className="font-semibold">Lot products:</span>
              {lotProducts.map((lp) => (
                <span key={lp.productId}>
                  {lp.productName}: <strong>{formatNumber(toNumber(lp.totalQty))}</strong> cartons
                  {toNumber(purchasedQtyByProduct[lp.productId]) > 0 && (
                    <span
                      className={`ml-1 text-xs ${
                        toNumber(purchasedQtyByProduct[lp.productId]) > toNumber(lp.totalQty) ? "font-bold text-red-600" : "text-blue-500"
                      }`}
                    >
                      ({formatNumber(toNumber(purchasedQtyByProduct[lp.productId]))} purchased)
                    </span>
                  )}
                </span>
              ))}
              <span className="text-xs text-blue-500">Total: {formatNumber(totalLotCartons)} cartons</span>
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatsCard title={`${t("purchase_cost")} (USD)`} value={`$${formatNumber(totalPurchaseUsd)}`} icon="📦" color="blue" />
            <StatsCard
              title={`${t("additional_costs")} (PKR)`}
              value={`PKR ${formatNumber(Math.round(totalCostsPkr + lotExpensesPkr))}`}
              icon="💸"
              color="red"
            />
            <StatsCard title={`${t("total_landed")} (PKR)`} value={`PKR ${formatNumber(Math.round(totalLandedPkr))}`} icon="🏷️" color="yellow" />
            <StatsCard title={t("total_cartons")} value={formatNumber(totalLotCartons)} icon="📦" color="blue" />
            <StatsCard title={`${t("cost_per_carton")} (USD)`} value={`$${landedPerCartonUsd.toFixed(2)}`} icon="💰" color="green" />
            <StatsCard title={`${t("cost_per_carton")} (PKR)`} value={`PKR ${formatNumber(Math.round(landedPerCartonPkr))}`} icon="💵" color="green" />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500">USD/PKR rate:</label>
            <input
              type="number"
              value={usdPkrRate}
              onChange={(event) => setUsdPkrRate(toNumber(event.target.value))}
              className="input-field w-28 text-xs"
              step="0.5"
            />
            <span className="text-xs text-gray-400">(fallback conversion for legacy records)</span>
            {(selectedLotCountryCode === "AFG" || toNumber(lotExpensesByCurrency.AFN) > 0) && (
              <>
                <label className="ml-3 text-xs text-gray-500">AFN/PKR rate:</label>
                <input
                  type="number"
                  value={afnPkrRate || ""}
                  onChange={(event) => setAfnPkrRate(toNumber(event.target.value))}
                  className="input-field w-28 text-xs"
                  step="0.0001"
                />
              </>
            )}
          </div>

          {hasUnconvertedAfnExpenses && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
              Afghanistan lot expenses exist in AFN. Enter AFN/PKR rate above to include them in PKR landed costs.
            </div>
          )}

          <div className="card mb-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-600">{t("purchase_prices")}</h3>
              <span className="text-xs text-gray-400">Managed in Lots</span>
            </div>
            <DataTable
              columns={[
                { key: "supplierName", label: t("supplier") },
                { key: "productName", label: t("product") },
                { key: "qty", label: t("cartons"), render: (row: any) => formatNumber(toNumber(row.qty)) },
                { key: "unitPriceUsd", label: t("unit_price"), render: (row: any) => `$${toNumber(row.unitPriceUsd).toLocaleString("en-US")}` },
                {
                  key: "totalPriceUsd",
                  label: t("total"),
                  render: (row: any) => <span className="font-medium">${toNumber(row.totalPriceUsd).toLocaleString("en-US")}</span>,
                },
                { key: "exchangeRate", label: t("exchange_rate"), render: (row: any) => (toNumber(row.exchangeRate) ? row.exchangeRate : "-") },
              ]}
              data={purchases}
              loading={false}
              emptyMessage={t("no_purchases")}
            />
          </div>

          <div className="card mb-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-600">{t("additional_costs")}</h3>
              <span className="text-xs text-gray-400">Managed in Lots</span>
            </div>
            <DataTable
              columns={[
                {
                  key: "costType",
                  label: t("type"),
                  render: (row: any) => <span className="text-xs">{COST_TYPES[row.costType] || row.costType}</span>,
                },
                { key: "description", label: t("description") },
                {
                  key: "amount",
                  label: t("amount"),
                  render: (row: any) => (
                    <span className="font-medium">
                      {String(row.currencyCode || "PKR").toUpperCase()} {toNumber(row.amount).toLocaleString("en-US")}
                    </span>
                  ),
                },
                {
                  key: "exchangeRate",
                  label: "Costing Rate",
                  render: (row: any) =>
                    row.costType === "freight" || String(row.currencyCode || "").toUpperCase() === "AFN"
                      ? toNumber(row.exchangeRate) || "—"
                      : "—",
                },
                {
                  key: "pkrEquiv",
                  label: "Approx PKR",
                  render: (row: any) => <span className="text-xs text-gray-500">PKR {formatNumber(Math.round(resolveCostPkr(row)))}</span>,
                },
                { key: "costDate", label: t("date") },
              ]}
              data={costs}
              loading={false}
              emptyMessage={t("no_costs")}
            />
          </div>

          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-gray-600">Landed Cost Per Carton by Item</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50">
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
              Customs duty is allocated by purchase value. Freight and transport are allocated by item weight. Port, loading,
              insurance, other charges, and lot-tagged expenses are shared equally across items.
            </p>
          </div>
        </>
      )}

      {loading && (
        <div className="rounded border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Loading lots...</div>
      )}
    </div>
  );
}
