"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function AccountsPage() {
  const { user } = useAuth();
  const { t } = useLang();

  const TABS = [
    { key: "pnl", label: t("profit_loss") },
    { key: "cash", label: t("cash_position") },
    { key: "receivables", label: t("receivables") },
    { key: "payables", label: t("payables") },
    { key: "balance_sheet", label: t("balance_sheet") },
  ];
  const [tab, setTab] = useState("pnl");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [cityId, setCityId] = useState<string>("");
  const [cities, setCities] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role === "super_admin") apiCall("/api/v1/cities").then(r => { if (r.success) setCities(r.data as any[]); });
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { report: tab, year };
    if (cityId) params.city_id = cityId;
    const r = await apiCall("/api/v1/financial-reports", { params });
    if (r.success) setData(r.data);
    setLoading(false);
  }, [tab, year, cityId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title={t("financial_reports")} subtitle={t("double_entry")} />
      <div className="flex flex-wrap gap-1 mb-4 bg-gray-100 p-1 rounded-lg">
        {TABS.map(tab_item => (
          <button key={tab_item.key} onClick={() => setTab(tab_item.key)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${tab === tab_item.key ? "bg-white shadow text-primary-700" : "text-gray-500 hover:text-gray-700"}`}>
            {tab_item.label}
          </button>
        ))}
      </div>
      <div className="flex gap-3 mb-4">
        {tab === "pnl" && <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="select-field w-auto text-sm">{[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}</select>}
        {user?.role === "super_admin" && <select value={cityId} onChange={e => setCityId(e.target.value)} className="select-field w-auto text-sm"><option value="">{t("all_cities")}</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </div>
      {loading ? <div className="py-12 text-center text-gray-400">{t("loading")}</div> : data ? (
        <>
          {tab === "pnl" && <PnLReport data={data} />}
          {tab === "cash" && <CashReport data={data} />}
          {tab === "receivables" && <ReceivablesReport data={data} />}
          {tab === "payables" && <PayablesReport data={data} />}
          {tab === "balance_sheet" && <BalanceSheetReport data={data} />}
        </>
      ) : <div className="py-12 text-center text-gray-400">{t("no_data_start")}</div>}
    </div>
  );
}

function PnLReport({ data }: { data: any }) {
  const { t } = useLang();
  const pnl = data.pnl || [];
  if (!pnl.length) return <div className="text-gray-400 py-8 text-center">{t("no_data")}</div>;
  return (<div className="space-y-6">{pnl.map((p: any, i: number) => (
    <div key={i} className="card">
      <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">{t("profit_loss")} — {p.currency}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatsCard title={t("revenue")} value={n(p.revenue)} icon="💰" color="green" />
        <StatsCard title={t("cogs")} value={n(p.cogs)} icon="📦" color="blue" />
        <StatsCard title={t("gross_profit")} value={n(p.grossProfit)} icon="📈" color={p.grossProfit >= 0 ? "green" : "red"} />
        <StatsCard title={t("net_profit")} value={n(p.netProfit)} icon={p.netProfit >= 0 ? "🎉" : "⚠️"} color={p.netProfit >= 0 ? "green" : "red"} />
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm mb-3">
        <div><span className="text-gray-500">{t("gross_margin")}:</span> <strong>{p.grossMargin}%</strong></div>
        <div><span className="text-gray-500">{t("net_margin")}:</span> <strong>{p.netMargin}%</strong></div>
      </div>
      {Object.keys(p.expenses || {}).length > 0 && (
        <div className="pt-3 border-t">
          <h4 className="text-sm font-semibold text-gray-600 mb-2">{t("expenses_breakdown")}</h4>
          {Object.entries(p.expenses).map(([name, amt]: any) => (
            <div key={name} className="flex justify-between text-sm py-1 border-b border-gray-50"><span className="text-gray-600">{name}</span><span className="font-medium">{n(amt)}</span></div>
          ))}
          <div className="flex justify-between text-sm font-bold pt-1"><span>{t("total_expenses")}</span><span>{n(p.expenseTotal)}</span></div>
        </div>
      )}
    </div>
  ))}</div>);
}

function CashReport({ data }: { data: any }) {
  const { t } = useLang();
  const positions = data.cashPositions || [];
  const byCurr: Record<string, { items: any[]; total: number }> = {};
  for (const p of positions) { if (!byCurr[p.currency]) byCurr[p.currency] = { items: [], total: 0 }; byCurr[p.currency].items.push(p); byCurr[p.currency].total += p.balance; }
  return (<div className="space-y-4">
    {Object.entries(byCurr).map(([curr, { items, total }]) => (
      <div key={curr} className="card">
        <div className="flex justify-between items-center mb-3 border-b pb-2">
          <h3 className="text-lg font-bold text-gray-800">{t("cash")} — {curr}</h3>
          <span className={`text-xl font-bold ${total >= 0 ? "text-green-700" : "text-red-700"}`}>{n(total)}</span>
        </div>
        {items.map((p: any, i: number) => (
          <div key={i} className="flex justify-between py-1.5 text-sm border-b border-gray-50"><span className="text-gray-600">{p.account}</span><span className={`font-medium ${p.balance >= 0 ? "text-green-700" : "text-red-700"}`}>{n(p.balance)}</span></div>
        ))}
      </div>
    ))}
    {!positions.length && <div className="text-gray-400 py-8 text-center">{t("no_cash_transactions")}</div>}
  </div>);
}

function ReceivablesReport({ data }: { data: any }) {
  const { t } = useLang();
  const totals = data.totalByCurrency || {};
  const customers = data.customers || [];
  return (<div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
      {Object.entries(totals).map(([curr, amt]: any) => <StatsCard key={curr} title={`${t("outstanding")} (${curr})`} value={n(amt)} icon="📥" color="red" />)}
    </div>
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-600 mb-3">{t("customer_balances")}</h3>
      {customers.length ? customers.map((c: any, i: number) => (
        <div key={i} className="flex justify-between py-1.5 text-sm border-b border-gray-50"><span>{c.account.replace("AR - ", "")}</span><span className="font-medium text-red-600">{c.currency} {n(c.balance)}</span></div>
      )) : <div className="text-gray-400 text-sm">{t("no_receivables")}</div>}
    </div>
  </div>);
}

function PayablesReport({ data }: { data: any }) {
  const { t } = useLang();
  return (<div className="space-y-4">
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-600 mb-3">{t("supplier_payables")}</h3>
      {(data.suppliers || []).length ? (data.suppliers || []).map((s: any, i: number) => (
        <div key={i} className="flex justify-between py-1.5 text-sm border-b border-gray-50"><span>{s.account.replace("Payable - ", "")}</span><span className="font-medium text-orange-600">{s.currency} {n(s.balance)}</span></div>
      )) : <div className="text-gray-400 text-sm">{t("no_supplier_payables")}</div>}
    </div>
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-600 mb-3">{t("agent_payables")}</h3>
      {(data.agents || []).length ? (data.agents || []).map((a: any, i: number) => (
        <div key={i} className="flex justify-between py-1.5 text-sm border-b border-gray-50"><span>{a.account.replace("Payable - ", "")}</span><span className="font-medium text-orange-600">{a.currency} {n(a.balance)}</span></div>
      )) : <div className="text-gray-400 text-sm">{t("no_agent_payables")}</div>}
    </div>
  </div>);
}

function BalanceSheetReport({ data }: { data: any }) {
  const { t } = useLang();
  const S = ({ title, items, c }: { title: string; items: any[]; c: string }) => (
    <div className="card mb-4">
      <h3 className={`text-sm font-semibold mb-2 ${c}`}>{title}</h3>
      {items.length ? items.map((a: any, i: number) => (
        <div key={i} className="flex justify-between py-1 text-sm border-b border-gray-50"><span className="text-gray-600">{a.name} <span className="text-xs text-gray-400">({a.code})</span></span><span className="font-medium">{a.currency} {n(a.balance)}</span></div>
      )) : <div className="text-gray-400 text-sm">{t("no_data")}</div>}
    </div>
  );
  return (<div>
    <S title={t("assets")} items={data.assets || []} c="text-green-700" />
    <S title={t("liabilities")} items={data.liabilities || []} c="text-red-700" />
    <S title={t("equity")} items={data.equity || []} c="text-blue-700" />
  </div>);
}

function n(v: number) { return v?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) || "0"; }
