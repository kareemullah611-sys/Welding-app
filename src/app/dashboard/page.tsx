"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, StatsCard, formatNumber, DataTable } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const [cashPosition, setCashPosition] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [showCashBreakdown, setShowCashBreakdown] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [dashRes, cashRes] = await Promise.all([
        apiCall("/api/v1/dashboard"),
        apiCall("/api/v1/cash-position"),
      ]);
      if (dashRes.success) setData(dashRes.data);
      if (cashRes.success) setCashPosition(cashRes.data);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;

  // CITY ADMIN DASHBOARD
  if (user?.role === "city_admin") {
    return (
      <div>
        <PageHeader title={t("dashboard")} subtitle={`${t("welcome")}, ${user?.fullName}`} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <StatsCard title={`💰 ${t("cash_in_hand")}`} value={formatNumber(cashPosition?.netCashInHand || 0)} color="green" icon="💰" />
          {Object.entries(data?.outstandingByCurrency || {}).length > 0
            ? Object.entries(data.outstandingByCurrency).map(([cc, amt]: [string, any]) => (
                <StatsCard key={`out-${cc}`} title={`📋 ${t("outstanding")} (${cc})`} value={`${cc} ${formatNumber(amt || 0)}`} color="red" icon="📋" />
              ))
            : <StatsCard title={`📋 ${t("outstanding")}`} value="0" color="red" icon="📋" />
          }
          <StatsCard title={`📦 ${t("cartons_sold")}`} value={formatNumber(data?.totalCartonsSold || 0)} color="blue" icon="📦" />
          {Object.entries(data?.hajiByCurrency || {}).length > 0
            ? Object.entries(data.hajiByCurrency).map(([cc, amt]: [string, any]) => (
                <StatsCard key={`haji-${cc}`} title={`↗️ ${t("owed_to_haji")} (${cc})`} value={`${cc} ${formatNumber(amt || 0)}`} color="yellow" icon="↗️" />
              ))
            : <StatsCard title={`↗️ ${t("owed_to_haji")}`} value="0" color="yellow" icon="↗️" />
          }
        </div>
        {/* Cash breakdown — collapsed by default */}
        {cashPosition && (
          <div className="card mb-6">
            <button
              onClick={() => setShowCashBreakdown((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <h3 className="text-sm font-semibold text-gray-500">{t("cash_position_breakdown")}</h3>
              <span className="text-gray-400 text-xs">{showCashBreakdown ? t("hide") : t("show")}</span>
            </button>
            {showCashBreakdown && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mt-3">
                  <div className="bg-green-50 rounded-lg p-3"><div className="text-gray-500">{t("cash_received")}</div><div className="text-lg font-bold text-green-700">{formatNumber(cashPosition.incomingToHand?.cash || 0)}</div></div>
                  <div className="bg-blue-50 rounded-lg p-3"><div className="text-gray-500">{t("cheques")}</div><div className="text-lg font-bold text-blue-700">{formatNumber(cashPosition.incomingToHand?.cheque || 0)}</div></div>
                  <div className="bg-purple-50 rounded-lg p-3"><div className="text-gray-500">{t("bank_online")}</div><div className="text-lg font-bold text-purple-700">{formatNumber((cashPosition.incomingToHand?.bankTransfer || 0) + (cashPosition.incomingToHand?.online || 0))}</div></div>
                  <div className="bg-orange-50 rounded-lg p-3"><div className="text-gray-500">{t("direct_to_haji")}</div><div className="text-lg font-bold text-orange-700">{formatNumber(cashPosition.directToHaji || 0)}</div></div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                  <div className="bg-red-50 rounded-lg p-3"><div className="text-gray-500">{t("expenses_paid")}</div><div className="text-lg font-bold text-red-700">{formatNumber(cashPosition.outgoing?.expenses || 0)}</div></div>
                  <div className="bg-yellow-50 rounded-lg p-3"><div className="text-gray-500">{t("withdrawals")}</div><div className="text-lg font-bold text-yellow-700">{formatNumber(cashPosition.outgoing?.personalWithdrawals || 0)}</div></div>
                  <div className="bg-orange-50 rounded-lg p-3"><div className="text-gray-500">{t("haji_transfers")}</div><div className="text-lg font-bold text-orange-700">{formatNumber(cashPosition.outgoing?.hajiTransfers || 0)}</div></div>
                </div>
              </>
            )}
          </div>
        )}
        {data?.ongoingLots?.length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-500 mb-3">{t("ongoing_lots")}</h3>
            {data.ongoingLots.map((l: any) => (
              <div key={l.id} className="flex justify-between items-center py-2 border-b last:border-0"><span className="font-mono font-medium">{l.lotNumber}</span><span className="text-sm text-gray-500">{l.lotDate}</span></div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // SUPER ADMIN DASHBOARD
  const citiesOverview = data?.citiesOverview || [];
  const countries = Array.from(new Set(citiesOverview.map((c: any) => c.country)));
  const activeCountry: string = selectedCountry || (countries[0] as string) || "";
  const countryCities = citiesOverview.filter((c: any) => c.country === activeCountry);

  const countryTotals = countries.map((country) => {
    const cc = citiesOverview.filter((c: any) => c.country === country);
    const outByCurr: Record<string, number> = {};
    const hajiByCurr: Record<string, number> = {};
    for (const c of cc) {
      for (const [cur, amt] of Object.entries(c.outstandingByCurrency || {})) { outByCurr[cur] = (outByCurr[cur] || 0) + (amt as number); }
      for (const [cur, amt] of Object.entries(c.hajiByCurrency || {})) { hajiByCurr[cur] = (hajiByCurr[cur] || 0) + (amt as number); }
    }
    return {
      country, outstandingByCurrency: outByCurr, hajiByCurrency: hajiByCurr,
      cartons: cc.reduce((s: number, c: any) => s + c.cartonsSold, 0),
      currency: cc[0]?.currency || "PKR",
    };
  });

  return (
    <div>
      <PageHeader title={t("dashboard")} subtitle={`${t("welcome")}, ${user?.fullName}`} />

      {/* Global stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {Object.entries(data?.outstandingByCurrency || {}).map(([cc, amt]: [string, any]) => (
          <StatsCard key={`out-${cc}`} title={`${t("outstanding")} (${cc})`} value={`${cc} ${formatNumber(amt)}`} color="red" icon="📋" />
        ))}
        <StatsCard title={t("cartons_sold")} value={formatNumber(data?.totalCartonsSold || 0)} color="blue" icon="📦" />
        {data?.supplierPayable && <StatsCard title="Owed to Company" value={`$${formatNumber(data.supplierPayable.balanceUsd)}`} color="yellow" icon="🏭" />}
      </div>

      {/* Country tabs */}
      {countries.length > 0 && (
        <div className="mb-6">
          <div className="flex gap-2 mb-4">
            {countries.map((c) => (
              <button key={c as string} onClick={() => setSelectedCountry(c as string)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeCountry === c ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {c === "Pakistan" ? "🇵🇰" : "🇦🇫"} {c as string}
              </button>
            ))}
          </div>

          {/* Country summary */}
          {countryTotals.filter((ct) => ct.country === activeCountry).map((ct) => (
            <div key={ct.country as string} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {Object.entries((ct as any).outstandingByCurrency || {}).map(([cc, amt]: [string, any]) => (
                <StatsCard key={`${ct.country}-out-${cc}`} title={`${t("outstanding")} (${cc})`} value={`${cc} ${formatNumber(amt)}`} color="red" icon="📋" />
              ))}
              {Object.entries((ct as any).hajiByCurrency || {}).map(([cc, amt]: [string, any]) => (
                <StatsCard key={`${ct.country}-haji-${cc}`} title={`${t("owed_to_haji")} (${cc})`} value={`${cc} ${formatNumber(amt)}`} color="yellow" icon="↗️" />
              ))}
              <StatsCard title={`${ct.country} ${t("cartons")}`} value={formatNumber(ct.cartons)} color="blue" icon="📦" />
            </div>
          ))}

          {/* City breakdown table */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-500 mb-3">{activeCountry} — {t("city")} Breakdown</h3>
            <DataTable columns={[
              { key: "cityName", label: t("city"), render: (c: any) => <span className="font-medium">{c.cityName}</span> },
              {
                key: "outstanding", label: t("outstanding"),
                render: (c: any) => (
                  <div className="space-y-0.5">
                    {Object.entries(c.outstandingByCurrency || {}).map(([cc, amt]: [string, any]) => (
                      <div key={cc} className="text-red-600 font-medium text-sm">{cc} {(amt as number).toLocaleString("en-US")}</div>
                    ))}
                    {!Object.keys(c.outstandingByCurrency || {}).length && <span className="text-gray-400">—</span>}
                  </div>
                ),
              },
              {
                key: "owedToHaji", label: t("owed_to_haji"),
                render: (c: any) => (
                  <div className="space-y-0.5">
                    {Object.entries(c.hajiByCurrency || {}).map(([cc, amt]: [string, any]) => (
                      <div key={cc} className="text-orange-600 font-medium text-sm">{cc} {(amt as number).toLocaleString("en-US")}</div>
                    ))}
                    {!Object.keys(c.hajiByCurrency || {}).length && <span className="text-gray-400">—</span>}
                  </div>
                ),
              },
              { key: "cartonsSold", label: t("cartons_sold"), render: (c: any) => formatNumber(c.cartonsSold) },
              {
                key: "personalWithdrawals", label: t("withdrawals"),
                render: (c: any) => (
                  <div className="space-y-0.5">
                    {Object.entries(c.withdrawalByCurrency || {}).map(([cc, amt]: [string, any]) => (
                      <div key={cc} className="text-red-500 text-sm">{cc} {(amt as number).toLocaleString("en-US")}</div>
                    ))}
                    {!Object.keys(c.withdrawalByCurrency || {}).length && <span className="text-gray-400">—</span>}
                  </div>
                ),
              },
              { key: "activeLots", label: t("ongoing_lots") },
            ]} data={countryCities} loading={false} />
          </div>
        </div>
      )}
    </div>
  );
}
