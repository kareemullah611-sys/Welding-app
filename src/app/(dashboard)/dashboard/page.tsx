"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, StatsCard, formatNumber, DataTable, formatDate, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";
import Link from "next/link";

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const [cashPosition, setCashPosition] = useState<any>(null);
  const [treasury, setTreasury] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [showOperationalDetails, setShowOperationalDetails] = useState(false);
  const [quickAction, setQuickAction] = useState<{ title: string; src: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const treasuryRequest = user?.role === "city_admin" ? apiCall("/api/v1/treasury") : Promise.resolve(null);
      const [dashRes, cashRes, treasuryRes] = await Promise.all([
        apiCall("/api/v1/dashboard"),
        apiCall("/api/v1/cash-position"),
        treasuryRequest,
      ]);
      if (dashRes.success) setData(dashRes.data);
      if (cashRes.success) setCashPosition(cashRes.data);
      if (treasuryRes?.success) setTreasury(treasuryRes.data);
      setLoading(false);
    };
    load();
  }, [user?.role]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "dashboard-quick-close") setQuickAction(null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;

  // ─── CITY ADMIN DASHBOARD ─────────────────────────────────────────────────
  if (user?.role === "city_admin") {
    // Build treasury cards
    const hasTreasury = treasury && (treasury.hasBankAccounts || treasury.cashInOffice || treasury.chequesInHand);

    // Format multi-currency value for a pot
    const formatPot = (pot: Record<string, number> | undefined) => {
      if (!pot) return "0";
      const entries = Object.entries(pot).filter(([, v]) => Number(v) !== 0);
      if (entries.length === 0) return "0";
      if (entries.length === 1) return formatNumber(entries[0][1]);
      return entries.map(([cc, amt]) => `${cc} ${formatNumber(amt)}`).join(" · ");
    };

    return (
      <div>
        <PageHeader title={t("dashboard")} subtitle={`${t("welcome")}, ${user?.fullName}`} />
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowOperationalDetails((v) => !v)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-[510] text-[#d0d6e0] hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white"
          >
            {showOperationalDetails ? "Hide Details" : "Show Details"}
          </button>
        </div>

        <div className="card mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-[590] tracking-[-0.02em] text-[#f7f8f8]">Daily Work</h3>
              <p className="mt-1 text-sm text-[#8a8f98]">Open the task you need without leaving the dashboard.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <button onClick={() => setQuickAction({ title: "New Sale", src: "/sales?create=1&embed=1" })} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 text-left transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">Sales</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">New Sale</div>
            </button>
            <button onClick={() => setQuickAction({ title: "Receive Payment", src: "/payments?create=payment&embed=1" })} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 text-left transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">Treasury</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">Receive Payment</div>
            </button>
            <button onClick={() => setQuickAction({ title: "Record Expense", src: "/expenses?create=1&embed=1" })} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 text-left transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">Treasury</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">Record Expense</div>
            </button>
            <button onClick={() => setQuickAction({ title: "Personal Withdrawal", src: "/personal-withdrawals?create=1&embed=1" })} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 text-left transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">Treasury</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">Personal Withdrawal</div>
            </button>
            <button onClick={() => setQuickAction({ title: "Haji Transfer", src: "/haji-transfers?create=1&embed=1" })} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 text-left transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">Treasury</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">Haji Transfer</div>
            </button>
            <button onClick={() => setQuickAction({ title: "New Customer", src: "/customers?create=1&embed=1" })} className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 text-left transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">People</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">New Customer</div>
            </button>
            <Link href="/inventory" className="rounded-xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.92))] px-4 py-4 transition-colors hover:border-[#7170ff]/30 hover:bg-[#17181d]">
              <div className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d]">Stock</div>
              <div className="mt-2 text-sm font-[510] text-[#f7f8f8]">Move Stock</div>
            </Link>
          </div>
        </div>
        {showOperationalDetails && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {/* Treasury 3-pot cards (if treasury data available) */}
          {hasTreasury ? (
            <>
              <StatsCard
                title={`💵 ${t("cash_in_office")}`}
                value={formatPot(treasury.cashInOffice)}
                color="green"
                icon="💵"
              />
              {(treasury.hasBankAccounts || Object.values(treasury.chequesInHand || {}).some(v => Number(v) > 0)) && (
                <StatsCard
                  title={`🧾 ${t("cheques_in_hand")}`}
                  value={formatPot(treasury.chequesInHand)}
                  color="yellow"
                  icon="🧾"
                />
              )}
              {treasury.hasBankAccounts && (
                <StatsCard
                  title={`🏦 ${t("bank_balance")}`}
                  value={formatPot(treasury.bankBalance)}
                  color="blue"
                  icon="🏦"
                />
              )}
            </>
          ) : (
            /* Fallback to old single cash card */
            <StatsCard title={`💰 ${t("cash_in_hand")}`} value={formatNumber(cashPosition?.netCashInHand || 0)} color="green" icon="💰" />
          )}

          {/* Outstanding */}
          {Object.entries(data?.outstandingByCurrency || {}).length > 0
            ? Object.entries(data.outstandingByCurrency).map(([cc, amt]: [string, any]) => (
                <StatsCard key={`out-${cc}`} title={`📋 ${t("outstanding")} (${cc})`} value={`${cc} ${formatNumber(amt || 0)}`} color="red" icon="📋" />
              ))
            : <StatsCard title={`📋 ${t("outstanding")}`} value="0" color="red" icon="📋" />
          }

          <StatsCard title={`📦 ${t("cartons_sold")}`} value={formatNumber(data?.totalCartonsSold || 0)} color="blue" icon="📦" />

          {/* Owed to Haji */}
          {Object.entries(data?.hajiByCurrency || {}).length > 0
            ? Object.entries(data.hajiByCurrency).map(([cc, amt]: [string, any]) => (
                <StatsCard key={`haji-${cc}`} title={`↗️ ${t("owed_to_haji")} (${cc})`} value={`${cc} ${formatNumber(amt || 0)}`} color="yellow" icon="↗️" />
              ))
            : <StatsCard title={`↗️ ${t("owed_to_haji")}`} value="0" color="yellow" icon="↗️" />
          }
        </div>
        )}

        {/* Bank account breakdown (if available) */}
        {showOperationalDetails && treasury?.hasBankAccounts && treasury.bankAccounts?.length > 1 && (
          <div className="card mb-6">
            <h3 className="text-sm font-semibold text-gray-500 mb-3">🏦 Bank Accounts</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {treasury.bankAccounts.map((ba: any) => (
                <div key={ba.id} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
                  <p className="text-sm font-[510] text-[#f7f8f8]">{ba.bankName}</p>
                  <p className="mt-1 text-lg font-[590] text-[#c6c8ff]">
                    {Object.entries(ba.balance || {}).filter(([, v]) => Number(v) !== 0).map(([cc, amt]: [string, any]) => (
                      <span key={cc}>{cc} {formatNumber(amt)}</span>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cash breakdown — collapsed by default (hidden for Afghanistan) */}
        {showOperationalDetails && cashPosition && (
          <div className="card mb-6">
            <h3 className="mb-3 text-sm font-[590] text-[#8a8f98]">{t("cash_position_breakdown")}</h3>
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("cash_received")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber(cashPosition.incomingToHand?.cash || 0)}</div></div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("cheques")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber(cashPosition.incomingToHand?.cheque || 0)}</div></div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("bank_online")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber((cashPosition.incomingToHand?.bankTransfer || 0) + (cashPosition.incomingToHand?.online || 0))}</div></div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("direct_to_haji")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber(cashPosition.directToHaji || 0)}</div></div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("expenses_paid")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber(cashPosition.outgoing?.expenses || 0)}</div></div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("withdrawals")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber(cashPosition.outgoing?.personalWithdrawals || 0)}</div></div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3"><div className="text-[#8a8f98]">{t("haji_transfers")}</div><div className="text-lg font-[590] text-[#f7f8f8]">{formatNumber(cashPosition.outgoing?.hajiTransfers || 0)}</div></div>
                </div>
              </>
          </div>
        )}

        {showOperationalDetails && data?.ongoingLots?.length > 0 && (
          <div className="card">
            <h3 className="mb-3 text-sm font-[590] text-[#8a8f98]">{t("ongoing_lots")}</h3>
            {data.ongoingLots.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-0">
                <span className="font-mono text-[#f7f8f8] font-medium">{l.lotNumber}</span>
                <span className="text-sm text-[#8a8f98]">{formatDate(l.lotDate)}</span>
              </div>
            ))}
          </div>
        )}

        <Modal open={!!quickAction} onClose={() => setQuickAction(null)} title={quickAction?.title || "Quick Action"} size="xl">
          {quickAction && <iframe src={quickAction.src} title={quickAction.title} className="h-[78vh] w-full rounded-xl border border-white/[0.08] bg-[#0f1011]" />}
        </Modal>

      </div>
    );
  }

  // ─── SUPER ADMIN DASHBOARD ───────────────────────────────────────────────
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
