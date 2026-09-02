"use client";
import React, { useEffect, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, StatsCard, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { applyPendingProfitReportPeriod } from "@/lib/offline-profit-report";
import { useAuth } from "@/hooks/useAuth";
import { LotAccountingTrace } from "@/components/lots/LotDetailTabs";

const PROFIT_REPORT_READ_CACHE_KEY = "mrf-profit-report-read-cache-v1";

type ProfitReportReadSnapshot = {
  lots: any[];
  data: any;
  mode: "lot" | "period";
  selectedLotId: number;
  year: number;
};

export default function ProfitReportPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const { isOnline, queuedItems } = useOffline();
  const [mode, setMode] = useState<"lot" | "period">("period");
  const [lots, setLots] = useState<any[]>([]);
  const [selectedLotId, setSelectedLotId] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  useEffect(() => {
    if (isOnline) return;
    const snapshot = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY)?.data;
    if (!snapshot) return;
    if (snapshot.lots?.length) setLots(snapshot.lots);
    if (snapshot.data) setData(snapshot.data);
    if (snapshot.mode) setMode(snapshot.mode);
    if (snapshot.selectedLotId) setSelectedLotId(snapshot.selectedLotId);
    if (snapshot.year) setYear(snapshot.year);
    setShowOfflineSnapshot(true);
  }, [isOnline]);

  const loadLots = async () => {
    if (lots.length) return;
    const r = await apiCall("/api/v1/lots", { params: { limit: 100 } });
    if (r.success) {
      setLots(r.data as any[]);
      const existing = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY)?.data;
      writeOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY, {
        lots: r.data as any[],
        data: existing?.data || null,
        mode: existing?.mode || mode,
        selectedLotId: existing?.selectedLotId || selectedLotId,
        year: existing?.year || year,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY)?.data;
      if (snapshot?.lots?.length) {
        setLots(snapshot.lots);
        setShowOfflineSnapshot(true);
      }
    }
  };

  const generate = async () => {
    setLoading(true); setData(null);
    const params: any = {};
    if (mode === "lot") { if (!selectedLotId) { alert("Select a lot"); setLoading(false); return; } params.lot_id = selectedLotId; }
    else { params.year = year; }
    const r = await apiCall("/api/v1/profit-report", { params });
    if (r.success) {
      let nextData = !isOnline && mode === "period"
        ? applyPendingProfitReportPeriod(r.data, queuedItems as any, year)
        : r.data;
      if (mode === "lot" && selectedLotId) {
        const detailResponse = await apiCall(`/api/v1/lots/${selectedLotId}`);
        if (detailResponse.success) {
          nextData = { ...(nextData as any), accountingTrace: (detailResponse.data as any)?.accountingTrace };
        }
      }
      setData(nextData);
      writeOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY, {
        lots,
        data: nextData,
        mode,
        selectedLotId,
        year,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<ProfitReportReadSnapshot>(PROFIT_REPORT_READ_CACHE_KEY)?.data;
      if (snapshot?.data) {
        const nextData = mode === "period"
          ? applyPendingProfitReportPeriod(snapshot.data, queuedItems as any, year)
          : snapshot.data;
        setData(nextData);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  };

  const traceLot = async (lotId: number) => {
    setLoading(true);
    const [response, detailResponse] = await Promise.all([
      apiCall("/api/v1/profit-report", { params: { lot_id: lotId } }),
      apiCall(`/api/v1/lots/${lotId}`),
    ]);
    if (response.success && detailResponse.success) {
      setSelectedLotId(lotId);
      setMode("lot");
      setData({ ...(response.data as any), accountingTrace: (detailResponse.data as any)?.accountingTrace });
    }
    setLoading(false);
  };

  if (user && user.role !== "super_admin") {
    return <div><PageHeader title={t("profit_report")} /><div className="card py-12 text-center text-gray-400">{t("super_admin_only")}</div></div>;
  }

  return (
    <div>
      <PageHeader title={t("profit_report")} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}
      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("report_type")}</label>
            <select value={mode} onChange={e => { setMode(e.target.value as any); setData(null); }} className="select-field w-auto">
              <option value="period">{t("year_end_pl")}</option><option value="lot">{t("per_lot")}</option>
            </select></div>
          {mode === "lot" && <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("lot")}</label>
            <select value={selectedLotId} onChange={e => setSelectedLotId(parseInt(e.target.value))} className="select-field w-auto" onClick={loadLots}>
              <option value={0}>Select</option>{lots.map(l => <option key={l.id} value={l.id}>{l.lotNumber} ({l.countryName})</option>)}
            </select></div>}
          {mode === "period" && <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("year")}</label>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-field w-24" /></div>}
          <button onClick={generate} disabled={loading} className="btn-primary text-sm">{loading ? t("loading") : t("generate")}</button>
        </div>
      </div>

      {data && mode === "period" && <PeriodReport data={data} onTraceLot={traceLot} />}
      {data && mode === "lot" && <LotReport data={data} />}
    </div>
  );
}

function pkr(value: number | string | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `PKR ${formatNumber(n)}`;
}

function PeriodReport({ data, onTraceLot }: { data: any; onTraceLot: (lotId: number) => void }) {
  const { t } = useLang();
  const pl = data.profitAndLoss;
  const currency = data.reportingCurrency || "PKR";
  return (
    <>
      <div className="mb-3 text-xs text-gray-500">All amounts in {currency}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatsCard title={t("revenue_label")} value={pkr(pl.totalRevenue)} icon="🧾" color="blue" />
        <StatsCard title={t("cost_of_goods")} value={pkr(pl.totalCOGS)} icon="📦" color="red" />
        <StatsCard title={t("gross_profit_label")} value={pkr(pl.grossProfit)} icon="📈" color={pl.grossProfit >= 0 ? "green" : "red"} />
        <StatsCard title={t("net_profit_label")} value={pkr(pl.netProfit)} icon="💰" color={pl.netProfit >= 0 ? "green" : "red"} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatsCard title={t("gross_margin_label")} value={`${pl.grossMarginPercent}%`} icon="📊" color="blue" />
        <StatsCard title={t("net_margin_label")} value={`${pl.netMarginPercent}%`} icon="📊" color="blue" />
        <StatsCard title={t("cartons_sold_label")} value={formatNumber(data.cartonsSold)} icon="📦" color="blue" />
        <StatsCard title={t("expenses")} value={pkr(pl.totalExpenses)} icon="💸" color="red" />
      </div>

      {data.supplierAccount && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-gray-500 mb-3">{t("supplier_account_label")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-blue-50 rounded-lg p-3"><div className="text-xs text-gray-500">{t("purchased_label")}</div><div className="text-lg font-bold text-blue-700">${data.supplierAccount.totalPurchasedUsd.toLocaleString("en-US")}</div></div>
            <div className="bg-green-50 rounded-lg p-3"><div className="text-xs text-gray-500">{t("paid_label")}</div><div className="text-lg font-bold text-green-700">${data.supplierAccount.totalPaidUsd.toLocaleString("en-US")}</div></div>
            <div className={`rounded-lg p-3 ${data.supplierAccount.balanceOwedUsd > 0 ? "bg-red-50" : "bg-green-50"}`}><div className="text-xs text-gray-500">{t("balance_owed")}</div><div className={`text-lg font-bold ${data.supplierAccount.balanceOwedUsd > 0 ? "text-red-700" : "text-green-700"}`}>${data.supplierAccount.balanceOwedUsd.toLocaleString("en-US")}</div></div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-500 mb-3">{t("lot_breakdown")}</h3>
        <DataTable columns={[
          { key: "lotNumber", label: t("lot"), render: (l: any) => <button type="button" onClick={() => onTraceLot(l.lotId)} className="font-semibold text-primary-700 hover:underline">{l.lotNumber}</button> },
          { key: "country", label: t("country") },
          { key: "landedCostPerCarton", label: t("cost_per_carton"), render: (l: any) => pkr(l.landedCostPerCartonPkr ?? l.landedCostPerCarton) },
          { key: "cartonsSold", label: t("sold"), render: (l: any) => formatNumber(l.cartonsSold) },
          { key: "revenue", label: t("revenue"), render: (l: any) => pkr(l.revenue) },
          { key: "cogs", label: t("cogs"), render: (l: any) => <span className="text-red-600">{pkr(l.cogs)}</span> },
          { key: "grossProfit", label: t("gross_profit_label"), render: (l: any) => <span className={l.grossProfit >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>{pkr(l.grossProfit)}</span> },
          { key: "netProfit", label: t("net_profit_label"), render: (l: any) => <span className={l.netProfit >= 0 ? "text-green-700 font-bold" : "text-red-700 font-bold"}>{pkr(l.netProfit)}</span> },
          { key: "trace", label: "Trace", render: (l: any) => <button type="button" onClick={() => onTraceLot(l.lotId)} className="text-xs font-semibold text-primary-700 hover:underline">Trace accounting</button> },
        ]} data={data.lotBreakdown || []} loading={false} />
      </div>
    </>
  );
}

function LotReport({ data }: { data: any }) {
  const { t } = useLang();
  const cs = data.costSummary;
  const ps = data.profitSummary;
  const currency = data.reportingCurrency || "PKR";
  return (
    <>
      <div className="mb-4 p-3 bg-gray-50 border rounded-lg text-sm">
        <strong>{data.lot.lotNumber}</strong> — {data.lot.country} — {formatDate(data.lot.lotDate)} — {t("status")}: <span className={data.lot.status === "ongoing" ? "text-green-600" : "text-gray-500"}>{data.lot.status}</span>
        {data.lot.pkrExchangeRate ? <span className="ml-3 text-xs text-gray-500">USD/PKR: {data.lot.pkrExchangeRate}</span> : null}
      </div>
      <div className="mb-3 text-xs text-gray-500">Landed cost & profit in {currency}</div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatsCard title={t("purchase_cost")} value={pkr(cs.purchasePkr ?? cs.totalPurchaseUsd)} icon="📦" color="blue" />
        <StatsCard title={t("additional_costs")} value={pkr(cs.otherCostsPkr ?? cs.totalAdditionalCosts)} icon="💸" color="red" />
        <StatsCard title={t("total_landed")} value={pkr(cs.totalLandedCostPkr ?? cs.totalLandedCostUsd)} icon="🏷️" color="yellow" />
        <StatsCard title={t("cartons")} value={formatNumber(cs.totalCartons)} icon="📦" color="blue" />
        <StatsCard title={t("cost_per_carton")} value={pkr(cs.landedCostPerCartonPkr ?? cs.landedCostPerCarton)} icon="💰" color="green" />
      </div>

      {Object.keys(cs.costBreakdown).length > 0 && (
        <div className="card mb-4">
          <h3 className="text-sm font-semibold text-gray-500 mb-2">{t("cost_breakdown")}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{Object.entries(cs.costBreakdown).map(([type, amount]) => (
            <div key={type} className="bg-gray-50 rounded p-2 text-sm"><div className="text-xs text-gray-500 capitalize">{type.replace(/_/g, " ")}</div><div className="font-medium">${(amount as number).toLocaleString("en-US")}</div></div>
          ))}</div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatsCard title={t("revenue_label")} value={pkr(ps.totalRevenue)} icon="🧾" color="blue" />
        <StatsCard title={t("cogs")} value={pkr(ps.totalCOGS)} icon="📦" color="red" />
        <StatsCard title={t("gross_profit_label")} value={pkr(ps.totalGrossProfit)} icon="📈" color={ps.totalGrossProfit >= 0 ? "green" : "red"} />
        <StatsCard title={t("expenses")} value={pkr(ps.totalExpenses)} icon="💸" color="red" />
        <StatsCard title={t("net_profit_label")} value={pkr(ps.netProfit)} icon="💰" color={ps.netProfit >= 0 ? "green" : "red"} />
        <StatsCard title={t("unsold_value")} value={pkr(ps.unsoldInventoryValue)} icon="📋" color="yellow" />
      </div>
      {ps.lotExpensesInLandedCost > 0 && (
        <p className="mb-4 text-xs text-gray-500">
          PKR {formatNumber(ps.lotExpensesInLandedCost)} of lot-tagged city expenses are included in landed cost (not subtracted again).
        </p>
      )}

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-500 mb-3">{t("product_profitability")}</h3>
        <DataTable columns={[
          { key: "productName", label: t("product") },
          { key: "qty", label: t("bought") },
          { key: "landedCostPerCartonUsd", label: t("cost_per_carton"), render: (p: any) => pkr(p.landedCostPerCartonPkr ?? p.landedCostPerCartonUsd) },
          { key: "cartonsSold", label: t("sold") },
          { key: "cartonsRemaining", label: t("remaining"), render: (p: any) => p.cartonsRemaining > 0 ? <span className="text-yellow-600">{p.cartonsRemaining}</span> : "0" },
          { key: "revenue", label: t("revenue"), render: (p: any) => pkr(p.revenue) },
          { key: "costOfGoodsSold", label: t("cogs"), render: (p: any) => <span className="text-red-600">{pkr(p.costOfGoodsSold)}</span> },
          { key: "grossProfit", label: t("profit"), render: (p: any) => <span className={p.grossProfit >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>{pkr(p.grossProfit)}</span> },
        ]} data={data.productCosts || []} loading={false} />
      </div>
      <div className="mt-6">
        <LotAccountingTrace selectedLot={data} userRole="super_admin" />
      </div>
    </>
  );
}
