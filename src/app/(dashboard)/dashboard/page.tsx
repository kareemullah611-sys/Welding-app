"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, StatsCard, formatNumber, DataTable, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { applyPendingDashboardMetrics } from "@/lib/offline-dashboard";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { 
  ShoppingCart, 
  Banknote, 
  Receipt, 
  Wallet, 
  ArrowRightLeft, 
  Users, 
  Package, 
  TrendingUp, 
  TrendingDown,
  Building2,
  ChevronRight,
  ChevronDown,
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
  onClick 
}: { 
  icon: React.ElementType; 
  title: string; 
  src?: string; 
  color: string; 
  onClick?: () => void;
}) => {
  const colors: Record<string, { bg: string; border: string; icon: string; text: string; hover: string }> = {
    blue: { bg: "bg-blue-50", border: "border-blue-200", icon: "text-blue-600", text: "text-blue-900", hover: "hover:bg-blue-100" },
    green: { bg: "bg-emerald-50", border: "border-emerald-200", icon: "text-emerald-600", text: "text-emerald-900", hover: "hover:bg-emerald-100" },
    red: { bg: "bg-rose-50", border: "border-rose-200", icon: "text-rose-600", text: "text-rose-900", hover: "hover:bg-rose-100" },
    amber: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-700", text: "text-amber-900", hover: "hover:bg-amber-100" },
    purple: { bg: "bg-violet-50", border: "border-violet-200", icon: "text-violet-600", text: "text-violet-900", hover: "hover:bg-violet-100" },
    orange: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600", text: "text-amber-900", hover: "hover:bg-amber-100" },
    teal: { bg: "bg-teal-50", border: "border-teal-200", icon: "text-teal-600", text: "text-teal-900", hover: "hover:bg-teal-100" },
  };
  const c = colors[color] || colors.blue;
  
  const content = (
    <div className={`${c.bg} ${c.border} border rounded-2xl p-4 cursor-pointer transition-all duration-200 ${c.hover} group`}>
      <div className="flex items-center gap-3">
        <div className={`${c.icon} p-2.5 rounded-xl bg-white/80 shadow-sm`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className={`text-sm font-semibold ${c.text} group-hover:translate-x-0.5 transition-transform`}>
          {title}
        </span>
        <ChevronRight className={`w-4 h-4 ml-auto ${c.icon} opacity-0 group-hover:opacity-100 transition-opacity`} />
      </div>
    </div>
  );
  
  if (src) return <button onClick={onClick} className="w-full text-left">{content}</button>;
  return content;
};

const MetricCard = ({ 
  title, 
  value, 
  subtitle, 
  trend,
  icon: Icon,
  color 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  trend?: 'up' | 'down' | null;
  icon: React.ElementType;
  color: string;
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
    <div className="bg-gradient-to-br bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl bg-gradient-to-br ${c.bg} shadow-sm`}>
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
  <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
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
  const [showOperationalDetails, setShowOperationalDetails] = useState(true);
  const [quickAction, setQuickAction] = useState<{ title: string; src: string } | null>(null);
  const [quickFrameLoading, setQuickFrameLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
      setLoading(true);
      const snapshot = readOfflineReadSnapshot<DashboardReadSnapshot>(DASHBOARD_READ_CACHE_KEY)?.data;
      const treasuryRequest = user?.role === "city_admin" ? apiCall("/api/v1/treasury") : Promise.resolve(null);
      const [dashRes, cashRes, treasuryRes] = await Promise.all([
        apiCall("/api/v1/dashboard"),
        apiCall("/api/v1/cash-position"),
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

      if (cashRes.success) {
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
      if (event.data?.type === "dashboard-quick-close") {
        closeQuickForm();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [closeQuickForm]);

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
    const hasTreasury = treasury && (treasury.hasBankAccounts || treasury.cashInOffice || treasury.chequesInHand);
    const formatPot = (pot: Record<string, number> | undefined) => {
      if (!pot) return "0";
      const entries = Object.entries(pot).filter(([, v]) => Number(v) !== 0);
      if (entries.length === 0) return "0";
      if (entries.length === 1) return formatNumber(entries[0][1]);
      return entries.map(([cc, amt]) => `${cc} ${formatNumber(amt)}`).join(" · ");
    };

    return (
      <div className="space-y-6">
        <PageHeader 
          title={t("dashboard")} 
          subtitle={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.fullName}`} 
        />
        {showOfflineSnapshot && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Offline snapshot mode: showing last cached dashboard data for this device.
          </div>
        )}

        {/* Quick Actions - Featured */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            icon={Receipt} 
            title="Record Expense" 
            src="/expenses?create=1&embed=1"
            color="red"
            onClick={() => openQuickForm("Record Expense", "/expenses?create=1&embed=1")}
          />
          <QuickActionCard 
            icon={Wallet} 
            title="Withdrawal" 
            src="/personal-withdrawals?create=1&embed=1"
            color="purple"
            onClick={() => openQuickForm("Personal Withdrawal", "/personal-withdrawals?create=1&embed=1")}
          />
        </div>

        {/* Secondary Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <QuickActionCard 
            icon={ArrowRightLeft} 
            title="Haji Transfer" 
            src="/haji-transfers?create=1&embed=1"
            color="orange"
            onClick={() => openQuickForm("Haji Transfer", "/haji-transfers?create=1&embed=1")}
          />
          <QuickActionCard 
            icon={Users} 
            title="New Customer" 
            src="/customers?create=1&embed=1"
            color="teal"
            onClick={() => openQuickForm("New Customer", "/customers?create=1&embed=1")}
          />
          <Link href="/inventory" className="sm:col-span-2 lg:col-span-4">
            <QuickActionCard icon={Package} title="Move Stock" color="amber" />
          </Link>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {hasTreasury ? (
            <>
              <MetricCard 
                title="Cash in Office" 
                value={formatPot(treasury.cashInOffice)} 
                icon={Banknote} 
                color="green" 
              />
              {!isAfghanistanCityAdmin && (treasury.hasBankAccounts || Object.values(treasury.chequesInHand || {}).some(v => Number(v) > 0)) && (
                <MetricCard 
                  title="Cheques in Hand" 
                  value={formatPot(treasury.chequesInHand)} 
                  icon={Receipt} 
                  color="yellow" 
                />
              )}
              {!isAfghanistanCityAdmin && treasury.hasBankAccounts && (
                <MetricCard 
                  title="Bank Balance" 
                  value={formatPot(treasury.bankBalance)} 
                  icon={Building2} 
                  color="blue" 
                />
              )}
            </>
          ) : (
            <MetricCard 
              title="Cash in Hand" 
              value={formatNumber(cashPosition?.netCashInHand || 0)} 
              icon={Banknote} 
              color="green" 
            />
          )}
          
          {/* Outstanding */}
          {Object.entries(data?.outstandingByCurrency || {}).length > 0
            ? Object.entries(data.outstandingByCurrency).map(([cc, amt]: [string, any]) => (
                <MetricCard 
                  key={`out-${cc}`} 
                  title={`Outstanding (${cc})`} 
                  value={`${cc} ${formatNumber(amt || 0)}`}
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
                  title={`Owed to Haji (${cc})`} 
                  value={`${cc} ${formatNumber(amt || 0)}`}
                  icon={ArrowRightLeft}
                  color="orange"
                />
              ))
            : <MetricCard title="Owed to Haji" value="0" icon={ArrowRightLeft} color="green" />
          }
        </div>

        {/* Operational Details */}
        {showOperationalDetails && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cash Flow Breakdown */}
            {cashPosition && (
              <SectionCard title="Cash Flow">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Incoming</p>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Cash Received</span>
                        <span className="font-semibold text-emerald-700">{formatNumber(cashPosition.incomingToHand?.cash || 0)}</span>
                      </div>
                      {!isAfghanistanCityAdmin && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">Cheques</span>
                          <span className="font-semibold text-blue-700">{formatNumber(cashPosition.incomingToHand?.cheque || 0)}</span>
                        </div>
                      )}
                      {!isAfghanistanCityAdmin && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">Bank/Online</span>
                          <span className="font-semibold text-violet-700">{formatNumber((cashPosition.incomingToHand?.bankTransfer || 0) + (cashPosition.incomingToHand?.online || 0))}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Direct to Haji</span>
                        <span className="font-semibold text-amber-700">{formatNumber(cashPosition.directToHaji || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-100">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total In</span>
                        <span className="font-bold text-emerald-700 tabular-nums">{formatNumber((cashPosition.incomingToHand?.cash || 0) + (cashPosition.incomingToHand?.cheque || 0) + (cashPosition.incomingToHand?.bankTransfer || 0) + (cashPosition.incomingToHand?.online || 0) + (cashPosition.directToHaji || 0))}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Outgoing</p>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Expenses</span>
                        <span className="font-semibold text-rose-700">{formatNumber(cashPosition.outgoing?.expenses || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Withdrawals</span>
                        <span className="font-semibold text-amber-700">{formatNumber(cashPosition.outgoing?.personalWithdrawals || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">Haji Transfers</span>
                        <span className="font-semibold text-orange-700">{formatNumber(cashPosition.outgoing?.hajiTransfers || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-100">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Out</span>
                        <span className="font-bold text-rose-700 tabular-nums">{formatNumber((cashPosition.outgoing?.expenses || 0) + (cashPosition.outgoing?.personalWithdrawals || 0) + (cashPosition.outgoing?.hajiTransfers || 0))}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Net Position</span>
                  {(() => {
                    const incoming = (cashPosition.incomingToHand?.cash || 0) + (cashPosition.incomingToHand?.cheque || 0) + (cashPosition.incomingToHand?.bankTransfer || 0) + (cashPosition.incomingToHand?.online || 0) + (cashPosition.directToHaji || 0);
                    const outgoing = (cashPosition.outgoing?.expenses || 0) + (cashPosition.outgoing?.personalWithdrawals || 0) + (cashPosition.outgoing?.hajiTransfers || 0);
                    const net = incoming - outgoing;
                    return (
                      <span className={cn("text-sm font-bold tabular-nums", net >= 0 ? "text-emerald-700" : "text-rose-700")}>
                        {net >= 0 ? "+" : ""}{formatNumber(net)}
                      </span>
                    );
                  })()}
                </div>
              </SectionCard>
            )}

            {/* Bank Accounts */}
            {treasury?.hasBankAccounts && treasury.bankAccounts?.length > 1 && (
              <SectionCard title="Bank Accounts">
                <div className="space-y-3">
                  {treasury.bankAccounts.map((ba: any) => (
                    <div key={ba.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          <Building2 className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{ba.bankName}</p>
                          <p className="text-xs text-gray-500">{ba.accountNumber}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {Object.entries(ba.balance || {}).filter(([, v]) => Number(v) !== 0).map(([cc, amt]: [string, any]) => (
                          <p key={cc} className="text-sm font-bold text-blue-700">{cc} {formatNumber(amt)}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Ongoing Lots */}
            {data?.ongoingLots?.length > 0 && (
              <SectionCard 
                title="Ongoing Lots" 
                action={<Link href="/lots" className="text-xs text-gray-500 hover:text-blue-600 transition-colors">{data.ongoingLots.length} active · View all →</Link>}
              >
                <div className="space-y-2">
                  {data.ongoingLots.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="font-mono text-sm font-medium text-gray-900">{l.lotNumber}</span>
                      </div>
                      <span className="text-sm text-gray-500">{formatDate(l.lotDate)}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        )}

        {/* Toggle Details */}
        <div className="flex justify-center">
          <button
            onClick={() => setShowOperationalDetails((v) => !v)}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5 transition-colors"
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", !showOperationalDetails && "-rotate-90")} />
            {showOperationalDetails ? 'Hide details' : 'Show more details'}
          </button>
        </div>

        {quickAction && (
          <div className="fixed inset-0 z-[90] flex flex-col sm:items-center sm:justify-center sm:p-4">
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-[#0b1220]/50 sm:bg-[#0b1220]/55"
              onClick={closeQuickForm}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="quickform-title"
              className="relative z-[91] flex h-[100dvh] w-full flex-col overflow-hidden bg-[#faf6f0] sm:h-[min(92dvh,760px)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-[#e8dccf] sm:shadow-[0_24px_64px_-28px_rgba(12,18,29,0.65)]"
            >
              <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#e8dccf] bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                <div className="min-w-0 flex-1">
                  <h2 id="quickform-title" className="truncate text-base font-semibold text-[#2f241c] sm:text-lg">
                    {quickAction.title}
                  </h2>
                  {quickFrameLoading && (
                    <p className="text-xs text-[#8d7561]">Loading form…</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeQuickForm}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[#e8dccf] text-[#5c4a3a] hover:bg-[#f5efe6] active:bg-[#ebe3d8]"
                  aria-label="Close form"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <iframe
                key={quickAction.src}
                src={quickAction.src}
                title={`${quickAction.title} form`}
                onLoad={() => setQuickFrameLoading(false)}
                className="min-h-0 flex-1 w-full border-0 bg-[#faf6f0]"
              />
            </div>
          </div>
        )}
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
    <div className="space-y-6">
      <PageHeader 
        title={t("dashboard")} 
        subtitle={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.fullName}`} 
      />
      {showOfflineSnapshot && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached dashboard data for this device.
        </div>
      )}

      {/* Global Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(data?.outstandingByCurrency || {}).map(([cc, amt]: [string, any]) => (
          <MetricCard 
            key={`out-${cc}`} 
            title={`Total Outstanding (${cc})`} 
            value={`${cc} ${formatNumber(amt)}`}
            icon={AlertCircle}
            color="red"
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
              {Object.entries((ct as any).outstandingByCurrency || {}).map(([cc, amt]: [string, any]) => (
                <MetricCard 
                  key={`${ct.country}-out-${cc}`} 
                  title={`Outstanding (${cc})`} 
                  value={`${cc} ${formatNumber(amt)}`}
                  icon={AlertCircle}
                  color="red"
                />
              ))}
              {Object.entries((ct as any).hajiByCurrency || {}).map(([cc, amt]: [string, any]) => (
                <MetricCard 
                  key={`${ct.country}-haji-${cc}`} 
                  title={`Owed to Haji (${cc})`} 
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
                key: "outstanding", label: t("outstanding"),
                render: (c: any) => (
                  <div className="space-y-0.5">
                    {Object.entries(c.outstandingByCurrency || {}).map(([cc, amt]: [string, any]) => (
                      <div key={cc} className="text-rose-700 font-semibold text-sm tabular-nums">{cc} {formatNumber(amt as number)}</div>
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
              { key: "activeLots", label: t("ongoing_lots"), render: (c: any) => (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  {c.activeLots}
                </span>
              )},
            ]} data={countryCities} loading={false} />
            {countryCities.length > 0 && (
              <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2">
                  <div className="col-span-full sm:col-span-3 lg:col-span-1 text-xs font-semibold text-gray-500 uppercase tracking-wide lg:text-right">Totals</div>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">Outstanding</span>
                    {Object.entries(countryCities.reduce((acc: Record<string, number>, c: any) => {
                      for (const [cur, amt] of Object.entries(c.outstandingByCurrency || {})) acc[cur] = (acc[cur] || 0) + (amt as number);
                      return acc;
                    }, {})).map(([cc, amt]) => (
                      <div key={cc} className="font-bold text-rose-700 tabular-nums">{cc} {formatNumber(amt as number)}</div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">Owed to Haji</span>
                    {Object.entries(countryCities.reduce((acc: Record<string, number>, c: any) => {
                      for (const [cur, amt] of Object.entries(c.hajiByCurrency || {})) acc[cur] = (acc[cur] || 0) + (amt as number);
                      return acc;
                    }, {})).map(([cc, amt]) => (
                      <div key={cc} className="font-bold text-amber-700 tabular-nums">{cc} {formatNumber(amt as number)}</div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">Cartons</span>
                    <div className="font-bold text-blue-700 tabular-nums">{formatNumber(countryCities.reduce((s: number, c: any) => s + c.cartonsSold, 0))}</div>
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">Withdrawals</span>
                    {Object.entries(countryCities.reduce((acc: Record<string, number>, c: any) => {
                      for (const [cur, amt] of Object.entries(c.withdrawalByCurrency || {})) acc[cur] = (acc[cur] || 0) + (amt as number);
                      return acc;
                    }, {})).map(([cc, amt]) => (
                      <div key={cc} className="font-bold text-amber-600 tabular-nums">{cc} {formatNumber(amt as number)}</div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <span className="text-xs text-gray-400">Active Lots</span>
                    <div className="font-bold text-blue-700 tabular-nums">{countryCities.reduce((s: number, c: any) => s + (c.activeLots || 0), 0)}</div>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
