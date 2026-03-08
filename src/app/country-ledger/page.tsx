"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";
export default function CountryLedgerPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [countries, setCountries] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  const [cityData, setCityData] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { const [cR, ciR] = await Promise.all([apiCall("/api/v1/countries"), apiCall("/api/v1/cities")]); if (cR.success) { setCountries(cR.data as any[]); if ((cR.data as any[]).length) setSel((cR.data as any[])[0].id); } if (ciR.success) setCities(ciR.data as any[]); setLoading(false); })(); }, []);
  useEffect(() => { if (!sel || !cities.length) return; (async () => { const cc = cities.filter(c => c.countryId === sel); const d: Record<number, any> = {}; for (const city of cc) { const [cashR, ledR] = await Promise.all([apiCall("/api/v1/cash-position", { params: { city_id: city.id } }), apiCall("/api/v1/city-ledger", { params: { city_id: city.id } })]); d[city.id] = { name: city.name, cash: cashR.success ? cashR.data : null, ledger: ledR.success ? (ledR.data as any).summary : null }; } setCityData(d); })(); }, [sel, cities]);
  if (user?.role !== "super_admin") return <div><PageHeader title={t("country_ledger")} /><div className="card text-center py-12 text-gray-400">{t("super_admin_only")}</div></div>;
  const tots = Object.values(cityData).reduce((a: any, c: any) => ({ sales: (a.sales||0)+(c.ledger?.totalSales||0), payments: (a.payments||0)+(c.ledger?.totalPayments||0), expenses: (a.expenses||0)+(c.ledger?.totalExpenses||0), haji: (a.haji||0)+(c.ledger?.totalHajiTransfers||0), withdrawals: (a.withdrawals||0)+(c.ledger?.totalWithdrawals||0), cashInHand: (a.cashInHand||0)+(c.cash?.netCashInHand||0), receivables: (a.receivables||0)+(c.ledger?.totalReceivables||0), hajiOwed: (a.hajiOwed||0)+(c.ledger?.totalHajiOwed||0) }), {} as any);
  return (
    <div>
      <PageHeader title={t("country_ledger")} subtitle={t("financial_overview")} />
      <div className="flex gap-2 mb-6">{countries.map(c => <button key={c.id} onClick={() => setSel(c.id)} className={`px-4 py-2 rounded-lg text-sm font-medium ${sel === c.id ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{c.name} ({c.code})</button>)}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatsCard title={t("total_sales")} value={formatNumber(tots.sales||0)} icon="🧾" color="blue" />
        <StatsCard title={t("payments_received")} value={formatNumber(tots.payments||0)} icon="💰" color="green" />
        <StatsCard title={t("cash_in_hand")} value={formatNumber(tots.cashInHand||0)} icon="💵" color="green" />
        <StatsCard title={t("outstanding")} value={formatNumber(tots.receivables||0)} icon="📋" color="yellow" />
        <StatsCard title={t("expenses")} value={formatNumber(tots.expenses||0)} icon="💸" color="red" />
        <StatsCard title={t("sent_to_haji")} value={formatNumber(tots.haji||0)} icon="↗️" color="yellow" />
        <StatsCard title={t("owed_to_haji")} value={formatNumber(tots.hajiOwed||0)} icon="⚠️" color="red" />
        <StatsCard title={t("withdrawals")} value={formatNumber(tots.withdrawals||0)} icon="🏦" color="purple" />
      </div>
      <h2 className="text-lg font-semibold text-gray-700 mb-3">{t("city_breakdown")}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {cities.filter(c => c.countryId === sel).map(city => {
          const cl = cityData[city.id]; if (!cl) return <div key={city.id} className="card animate-pulse h-48" />;
          return (<div key={city.id} className="card"><h3 className="text-base font-semibold text-gray-800 mb-3 pb-2 border-b">{cl.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">{t("sales")}</span><span className="font-medium">{(cl.ledger?.totalSales||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("payments")}</span><span className="font-medium text-green-600">{(cl.ledger?.totalPayments||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("outstanding")}</span><span className="font-medium text-yellow-600">{(cl.ledger?.totalReceivables||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("cash_in_hand")}</span><span className="font-bold text-green-700">{(cl.cash?.netCashInHand||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("expenses")}</span><span className="font-medium text-red-600">{(cl.ledger?.totalExpenses||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("haji_transfers")}</span><span className="font-medium text-orange-600">{(cl.ledger?.totalHajiTransfers||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("owed_to_haji")}</span><span className="font-bold text-red-700">{(cl.ledger?.totalHajiOwed||0).toLocaleString("en-US")}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t("withdrawals")}</span><span className="font-medium text-purple-600">{(cl.ledger?.totalWithdrawals||0).toLocaleString("en-US")}</span></div>
            </div>
            {cl.cash && <div className="mt-3 pt-2 border-t"><p className="text-xs font-semibold text-gray-400 mb-1">{t("in_hand_breakdown")}</p><div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded">💵 {t("cash")}: {(cl.cash.incomingToHand?.cash||0).toLocaleString("en-US")}</span>
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">🏦 {t("cheque")}: {(cl.cash.incomingToHand?.cheque||0).toLocaleString("en-US")}</span>
              <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">🏧 {t("bank_transfer")}: {(cl.cash.incomingToHand?.bankTransfer||0).toLocaleString("en-US")}</span>
              <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">📱 {t("online")}: {(cl.cash.incomingToHand?.online||0).toLocaleString("en-US")}</span>
            </div></div>}
          </div>);
        })}
      </div>
    </div>
  );
}
