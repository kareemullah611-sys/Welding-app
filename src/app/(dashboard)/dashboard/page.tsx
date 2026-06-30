"use client";
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, StatsCard, formatNumber, DataTable } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { applyPendingDashboardMetrics } from "@/lib/offline-dashboard";
import { formatCityAmount, isSingleCurrencyCityAdmin } from "@/lib/city-money-format";
import { cn } from "@/lib/utils";
import BalanceHub from "@/components/dashboard/BalanceHub";
import { QUICKFORM_POST_MESSAGE } from "@/lib/quickform-embed";
import Link from "next/link";
import { 
  ShoppingCart, 
  Banknote, 
  Receipt, 
  Wallet, 
  ArrowRightLeft, 
  Package, 
  TrendingUp, 
  TrendingDown,
  Building2,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";

const DASHBOARD_READ_CACHE_KEY = "mrf-dashboard-read-cache-v1";

type DashboardReadSnapshot = {
  data: any | null;
  cashPosition: any | null;
  treasury: any | null;
};

const QuickActionCard = ({
  icon: Icon,
  title,
  src,
  color,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  src?: string;
  color: string;
  onClick?: () => void;
}) => {
  const themes: Record<string, { glow: string; icon: string }> = {
    blue: { glow: "bg-sky-400", icon: "from-[#5ac8fa] to-[#007aff]" },
    green: { glow: "bg-emerald-400", icon: "from-[#34d399] to-[#059669]" },
    orange: { glow: "bg-orange-400", icon: "from-[#ffb340] to-[#ff9500]" },
    red: { glow: "bg-rose-400", icon: "from-[#ff6b8a] to-[#ff3b30]" },
    purple: { glow: "bg-violet-400", icon: "from-[#c084fc] to-[#af52de]" },
  };
  const theme = themes[color] || themes.blue;

  const inner = (
    <>
      <div
        className={`quick-action-glow pointer-events-none absolute left-1/2 top-5 h-14 w-14 -translate-x-1/2 rounded-full blur-2xl ${theme.glow}`}
      />
      <div
        className={`relative flex h-12 w-12 items-center justify-center rounded-[14px] bg-gradient-to-b text-white shadow-[0_8px_20px_-8px_rgba(0,0,0,0.45)] ring-1 ring-white/40 transition-transform duration-500 ease-[cubic-bezier(0.34,1.45,0.64,1)] group-hover:scale-110 group-active:scale-95 ${theme.icon}`}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[14px] bg-gradient-to-b from-white/35 to-transparent" />
        <Icon className="relative h-[22px] w-[22px]" strokeWidth={2} />
      </div>
      <span className="relative px-1 text-center text-[13px] font-medium leading-tight tracking-tight text-[#2f241b]">
        {title}
      </span>
    </>
  );

  if (src) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="quick-action-tile group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B0F1A]/25 focus-visible:ring-offset-2"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="quick-action-tile group">
      {inner}
    </div>
  );
};

const MetricCard = ({ 
  title, 
  value, 
  subtitle, 
  trend,
  icon: Icon,
  color,
  glass = true,
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  trend?: 'up' | 'down' | null;
  icon: React.ElementType;
  color: string;
  glass?: boolean;
}) => {
  const colors: Record<string, { bg: string; icon: string; value: string }> = {
    green: { bg: "from-emerald-50 to-white", icon: "text-emerald-600", value: "text-emerald-700" },
    red: { bg: "from-rose-50 to-white", icon: "text-rose-600", value: "text-rose-700" },
    blue: { bg: "from-blue-50 to-white", icon: "text-blue-600", value: "text-blue-700" },
    yellow: { bg: "from-amber-50 to-white", icon: "text-amber-600", value: "text-amber-700" },
    purple: { bg: "from-violet-50 to-white", icon: "text-violet-600", value: "text-violet-700" },
  };
  const c = colors[color] || colors.blue;
  
  return (
    <div
      className={cn(
        "p-5 transition-shadow",
        glass
          ? "rounded-[1.5rem] border border-white/60 bg-white/40 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-24px_rgba(42,6,8,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_28px_70px_-26px_rgba(42,6,8,0.34)]"
          : "rounded-2xl bg-gradient-to-br bg-white border border-gray-100 shadow-sm hover:shadow-md"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn("p-2.5 rounded-xl bg-gradient-to-br shadow-sm", glass && "ring-1 ring-white/70", c.bg)}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend === 'up' ? 'text-emerald-600' : 'text-rose-600'}`}>
            {trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{title}</p>
      <p className={`text-xl font-bold ${c.value} tabular-nums`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
    </div>
  );
};

const SectionCard = ({ 
  title, 
  children, 
  action 
}: { 
  title: string; 
  children: React.ReactNode; 
  action?: React.ReactNode;
}) => (
  <div className="overflow-hidden rounded-[1.5rem] border border-white/60 bg-white/50 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-30px_rgba(42,6,8,0.28)]">
    <div className="px-5 py-4 border-b border-white/50 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {action}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, queuedItems } = useOffline();
  const [data, setData] = useState<any>(null);
  const [cashPosition, setCashPosition] = useState<any>(null);
  const [treasury, setTreasury] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [quickAction, setQuickAction] = useState<{ title: string; src: string } | null>(null);
  const [quickFrameLoading, setQuickFrameLoading] = useState(false);
  const [quickFrameKey, setQuickFrameKey] = useState(0);
  const [quickformPortalReady, setQuickformPortalReady] = useState(false);

  useEffect(() => setQuickformPortalReady(true), []);

  const loadDashboard = useCallback(async () => {
      const snapshot = readOfflineReadSnapshot<DashboardReadSnapshot>(DASHBOARD_READ_CACHE_KEY)?.data;
      const hasSnapshot = Boolean(snapshot?.data || snapshot?.cashPosition || snapshot?.treasury);
      if (hasSnapshot) {
        setData(snapshot!.data ?? null);
        setCashPosition(snapshot!.cashPosition ?? null);
        setTreasury(snapshot!.treasury ?? null);
        setLoading(false);
      } else {
        setLoading(true);
      }

      const treasuryRequest = user?.role === "city_admin" ? apiCall("/api/v1/treasury") : Promise.resolve(null);
      const cashPositionRequest = user?.role === "city_admin" ? apiCall("/api/v1/cash-position") : Promise.resolve(null);
      const [dashRes, cashRes, treasuryRes] = await Promise.all([
        apiCall("/api/v1/dashboard"),
        cashPositionRequest,
        treasuryRequest,
      ]);
      let usedSnapshot = false;
      let usedLive = false;
      let nextData = snapshot?.data ?? null;
      let nextCashPosition = snapshot?.cashPosition ?? null;
      let nextTreasury = snapshot?.treasury ?? null;

      if (dashRes.success) {
        nextData = dashRes.data;
        setData(dashRes.data);
        usedLive = true;
      } else if (!isOnline && snapshot?.data) {
        setData(snapshot.data);
        usedSnapshot = true;
      }

      if (cashRes?.success) {
        nextCashPosition = cashRes.data;
        setCashPosition(cashRes.data);
        usedLive = true;
      } else if (!isOnline && snapshot?.cashPosition) {
        setCashPosition(snapshot.cashPosition);
        usedSnapshot = true;
      }

      if (treasuryRes?.success) {
        nextTreasury = treasuryRes.data;
        setTreasury(treasuryRes.data);
        usedLive = true;
      } else if (!isOnline && snapshot?.treasury) {
        setTreasury(snapshot.treasury);
        usedSnapshot = true;
      }

      if (usedLive) {
        if (!isOnline && user?.role === "city_admin") {
          const merged = applyPendingDashboardMetrics(nextData, nextCashPosition, queuedItems as any);
          nextData = merged.data;
          nextCashPosition = merged.cashPosition;
          setData(merged.data);
          setCashPosition(merged.cashPosition);
        }
        writeOfflineReadSnapshot<DashboardReadSnapshot>(DASHBOARD_READ_CACHE_KEY, {
          data: nextData,
          cashPosition: nextCashPosition,
          treasury: nextTreasury,
        });
      } else if (!isOnline && user?.role === "city_admin" && (nextData || nextCashPosition)) {
        const merged = applyPendingDashboardMetrics(nextData, nextCashPosition, queuedItems as any);
        setData(merged.data);
        setCashPosition(merged.cashPosition);
      }
      setShowOfflineSnapshot(usedSnapshot);
      setLoading(false);
    }, [isOnline, queuedItems, user?.role]);

  const closeQuickForm = useCallback(() => {
    setQuickAction(null);
    setQuickFrameLoading(false);
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const openQuickForm = useCallback((title: string, src: string) => {
    setQuickFrameLoading(true);
    setQuickAction({ title, src });
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === QUICKFORM_POST_MESSAGE.close) {
        closeQuickForm();
        return;
      }
      if (event.data?.type === QUICKFORM_POST_MESSAGE.reload && quickAction) {
        setQuickFrameLoading(true);
        setQuickFrameKey((key) => key + 1);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [closeQuickForm, quickAction]);

  useEffect(() => {
    if (!quickAction) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeQuickForm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeQuickForm, quickAction]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ─── CITY ADMIN DASHBOARD ─────────────────────────────────────────────────
  if (user?.role === "city_admin") {
    const isAfghanistanCityAdmin = user?.countryName === "Afghanistan";
    const singleCurrency = isSingleCurrencyCityAdmin(user);

    return (
      <div className="space-y-6">
        <PageHeader title={t("dashboard")} />
        {showOfflineSnapshot && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Offline snapshot mode: showing last cached dashboard data for this device.
          </div>
        )}

        <div className="quick-action-panel relative overflow-hidden rounded-[1.75rem] border border-white/55 p-3">
          <div className="pointer-events-none absolute inset-0 opacity-90 [background:radial-gradient(circle_at_12%_22%,rgba(56,189,248,0.16),transparent_44%),radial-gradient(circle_at_88%_68%,rgba(168,85,247,0.12),transparent_40%),radial-gradient(circle_at_50%_95%,rgba(16,185,129,0.1),transparent_36%)]" />
          <div className="relative grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <QuickActionCard 
            icon={ShoppingCart} 
            title="New Sale" 
            src="/sales?create=1&embed=1"
            color="blue"
            onClick={() => openQuickForm("New Sale", "/sales?create=1&embed=1")}
          />
          <QuickActionCard 
            icon={Banknote} 
            title="Receive Payment" 
            src="/payments?create=payment&embed=1"
            color="green"
            onClick={() => openQuickForm("Receive Payment", "/payments?create=payment&embed=1")}
          />
          <QuickActionCard 
            icon={ArrowRightLeft} 
            title="Haji Transfer" 
            src="/haji-transfers?create=1&embed=1"
            color="orange"
            onClick={() => openQuickForm("Haji Transfer", "/haji-transfers?create=1&embed=1")}
          />
          <QuickActionCard 
            icon={Receipt} 
            title="Record Expense" 
            src="/expenses?create=1&embed=1"
            color="red"
            onClick={() => openQuickForm("Record Expense", "/expenses?create=1&embed=1")}
          />
          <div className="col-span-2 flex justify-center lg:col-span-1 lg:col-start-2 xl:col-span-1 xl:col-start-auto">
            <div className="w-[calc((100%-0.625rem)/2)] sm:w-[calc((100%-0.75rem)/2)] lg:w-full">
              <QuickActionCard 
                icon={Wallet} 
                title="Withdrawal" 
                src="/personal-withdrawals?create=1&embed=1"
                color="purple"
                onClick={() => openQuickForm("Personal Withdrawal", "/personal-withdrawals?create=1&embed=1")}
              />
            </div>
          </div>
          </div>
        </div>
        <BalanceHub user={user} treasury={treasury} glass />

        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Outstanding */}
          {Object.entries(data?.outstandingByCurrency || {}).length > 0
            ? Object.entries(data.outstandingByCurrency).map(([cc, amt]: [string, any]) => (
                <MetricCard 
                  key={`out-${cc}`} 
                  title={singleCurrency ? "Outstanding" : `Outstanding (${cc})`} 
                  value={formatCityAmount(user, amt || 0, cc)}
                  icon={AlertCircle}
                  color="red"
                />
              ))
            : <MetricCard title="Outstanding" value="0" icon={CheckCircle2} color="green" />
          }
          
          <MetricCard 
            title="Cartons Sold" 
            value={formatNumber(data?.totalCartonsSold || 0)} 
            icon={Package} 
            color="blue" 
          />
          
          {/* Owed to Haji */}
          {Object.entries(data?.hajiByCurrency || {}).length > 0
            ? Object.entries(data.hajiByCurrency).map(([cc, amt]: [string, any]) => (
                <MetricCard 
                  key={`haji-${cc}`} 
                  title={singleCurrency ? "Owed to Haji" : `Owed to Haji (${cc})`} 
                  value={formatCityAmount(user, amt || 0, cc)}
                  icon={ArrowRightLeft}
                  color="orange"
                />
              ))
            : <MetricCard title="Owed to Haji" value="0" icon={ArrowRightLeft} color="green" />
          }
        </div>

        {quickformPortalReady && quickAction &&
          createPortal(
            <div className="fixed inset-0 z-[100] flex flex-col sm:items-center sm:justify-center sm:p-4">
              <button
                type="button"
                aria-label="Close"
                className="absolute inset-0 bg-black/70 backdrop-blur-[2px] touch-none"
                onClick={closeQuickForm}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="quickform-title"
                className="relative z-[101] flex h-[100dvh] w-full flex-col overflow-hidden bg-[linear-gradient(168deg,rgba(255,248,239,0.99),rgba(245,233,219,0.94))] sm:h-[min(92dvh,760px)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-[#e9dccb] sm:shadow-[0_22px_50px_-42px_rgba(51,42,33,0.38)]"
              >
                <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#eadfce] bg-[linear-gradient(135deg,rgba(255,248,239,0.98),rgba(245,233,219,0.88))] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                  <div className="min-w-0 flex-1">
                    <h2 id="quickform-title" className="truncate text-base font-semibold text-[#2f241b] sm:text-lg">
                      {quickAction.title}
                    </h2>
                    {quickFrameLoading && (
                      <p className="text-xs text-[#8f7963]">Loading form…</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeQuickForm}
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[#d8c7b3] text-[#5d4a3a] hover:bg-[#fbf4ea] active:bg-[#f3e8d8]"
                    aria-label="Close form"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <iframe
                  key={`${quickAction.src}-${quickFrameKey}`}
                  src={quickAction.src}
                  title={`${quickAction.title} form`}
                  onLoad={() => setQuickFrameLoading(false)}
                  className="min-h-0 flex-1 w-full border-0 bg-transparent"
                />
              </div>
            </div>,
            document.body
          )}
      </div>
    );
  }

  // ─── SUPER ADMIN DASHBOARD ───────────────────────────────────────────────
  const citiesOverview = data?.citiesOverview || [];
  const countries = Array.from(new Set(citiesOverview.map((c: any) => c.country)));
  const activeCountry: string = selectedCountry || (countries[0] as string) || "";
  const countryCities = citiesOverview.filter((c: any) => c.country === activeCountry);

  const sumDueFromCities = (cities: any[]) => {
    const byCurr: Record<string, number> = {};
    for (const c of cities) {
      for (const [cur, amt] of Object.entries(c.hajiByCurrency || {})) {
        byCurr[cur] = (byCurr[cur] || 0) + (amt as number);
      }
    }
    return byCurr;
  };

  const globalDueFromCities = sumDueFromCities(citiesOverview);

  const countryTotals = countries.map((country) => {
    const cc = citiesOverview.filter((c: any) => c.country === country);
    return {
      country,
      dueFromCitiesByCurrency: sumDueFromCities(cc),
      cartons: cc.reduce((s: number, c: any) => s + c.cartonsSold, 0),
      currency: cc[0]?.currency || "PKR",
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("dashboard")} />
      {showOfflineSnapshot && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached dashboard data for this device.
        </div>
      )}

      {/* Global Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(globalDueFromCities).map(([cc, amt]: [string, any]) => (
          <MetricCard 
            key={`due-${cc}`} 
            title={`Due from Cities (${cc})`} 
            value={`${cc} ${formatNumber(amt)}`}
            icon={ArrowRightLeft}
            color="orange"
          />
        ))}
        <MetricCard 
          title="Total Cartons Sold" 
          value={formatNumber(data?.totalCartonsSold || 0)} 
          icon={Package} 
          color="blue" 
        />
        {data?.supplierPayable && (
          <MetricCard 
            title="Owed to Company" 
            value={`$${formatNumber(data.supplierPayable.balanceUsd)}`}
            icon={Building2}
            color="purple"
          />
        )}
      </div>

      {/* Country Tabs */}
      {countries.length > 0 && (
        <div className="space-y-6">
          {/* Country Selector */}
          <div className="flex gap-2">
            {countries.map((c) => (
              <button 
                key={c as string} 
                onClick={() => setSelectedCountry(c as string)}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeCountry === c 
                    ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-lg shadow-amber-200' 
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {c === "Pakistan" ? '🇵🇰' : '🇦🇫'} {c as string}
              </button>
            ))}
          </div>

          {/* Country Summary */}
          {countryTotals.filter((ct) => ct.country === activeCountry).map((ct) => (
            <div key={ct.country as string} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries((ct as any).dueFromCitiesByCurrency || {}).map(([cc, amt]: [string, any]) => (
                <MetricCard 
                  key={`${ct.country}-due-${cc}`} 
                  title={`Due from Cities (${cc})`} 
                  value={`${cc} ${formatNumber(amt)}`}
                  icon={ArrowRightLeft}
                  color="orange"
                />
              ))}
              <MetricCard 
                title={`${ct.country} Cartons`} 
                value={formatNumber(ct.cartons)} 
                icon={Package} 
                color="blue" 
              />
            </div>
          ))}

          {/* City Breakdown Table */}
          <SectionCard title={`${activeCountry} — City Breakdown`} action={<span className="text-xs text-gray-400">{countryCities.length} {countryCities.length === 1 ? "city" : "cities"}</span>}>
            <DataTable columns={[
              { key: "cityName", label: t("city"), render: (c: any) => (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="font-medium">{c.cityName}</span>
                </div>
              )},
              {
                key: "dueFromCities", label: "Due from Cities",
                render: (c: any) => (
                  <div className="space-y-0.5">
                    {Object.entries(c.hajiByCurrency || {}).map(([cc, amt]: [string, any]) => (
                      <div key={cc} className="text-amber-700 font-semibold text-sm tabular-nums">{cc} {formatNumber(amt as number)}</div>
                    ))}
                    {!Object.keys(c.hajiByCurrency || {}).length && <span className="text-gray-400">—</span>}
                  </div>
                ),
              },
              { key: "cartonsSold", label: t("cartons_sold"), render: (c: any) => (
                <span className="font-semibold tabular-nums">{formatNumber(c.cartonsSold)}</span>
              )},
              {
                key: "personalWithdrawals", label: t("withdrawals"),
                render: (c: any) => (
                  <div className="space-y-0.5">
                    {Object.entries(c.withdrawalByCurrency || {}).map(([cc, amt]: [string, any]) => (
                      <div key={cc} className="text-amber-600 text-sm tabular-nums">{cc} {formatNumber(amt as number)}</div>
                    ))}
                    {!Object.keys(c.withdrawalByCurrency || {}).length && <span className="text-gray-400">—</span>}
                  </div>
                ),
              },
            ]} data={countryCities} loading={false} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}
