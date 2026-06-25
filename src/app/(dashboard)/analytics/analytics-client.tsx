"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, formatNumber } from "@/components/ui";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import {
  ResponsiveContainer,
  ComposedChart, Area, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
  ReferenceLine,
} from "recharts";

type Period = "daily" | "monthly" | "yearly" | "custom";

interface ChartRow {
  label: string;
  period: string;
  sales: number;
  cartons: number;
  payments: number;
  expenses: number;
  hajiTransfers: number;
}

interface Totals {
  sales: number;
  cartons: number;
  payments: number;
  expenses: number;
  hajiTransfers: number;
}

const PALETTE = {
  sales:         { stroke: "#6366f1", fill: "#6366f1" },
  payments:      { stroke: "#10b981", fill: "#10b981" },
  expenses:      { stroke: "#f43f5e", fill: "#f43f5e" },
  hajiTransfers: { stroke: "#f97316", fill: "#f97316" },
  cartons:       { stroke: "#8b5cf6", fill: "#8b5cf6" },
};

const ANALYTICS_READ_CACHE_KEY = "mrf-analytics-read-cache-v1";

type AnalyticsReadSnapshot = {
  cities: any[];
  chartData: ChartRow[];
  totals: Totals | null;
  period: Period;
  year: number;
  from: string;
  to: string;
  cityId: number;
};

const KPI_CONFIG = [
  { key: "sales"         as const, label: "Total Sales",       icon: "🧾", toggleable: true,
    bg: "from-indigo-50 to-white", border: "border-indigo-200", activeBg: "bg-indigo-600",
    dot: "bg-indigo-500", value: "text-indigo-700", badge: "bg-indigo-100 text-indigo-700" },
  { key: "payments"      as const, label: "Payments Received", icon: "💰", toggleable: true,
    bg: "from-emerald-50 to-white", border: "border-emerald-200", activeBg: "bg-emerald-600",
    dot: "bg-emerald-500", value: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
  { key: "cartons"       as const, label: "Cartons Sold",      icon: "📦", toggleable: false,
    bg: "from-violet-50 to-white", border: "border-violet-200", activeBg: "bg-violet-600",
    dot: "bg-violet-500", value: "text-violet-700", badge: "bg-violet-100 text-violet-700" },
  { key: "expenses"      as const, label: "Expenses",          icon: "💸", toggleable: true,
    bg: "from-rose-50 to-white", border: "border-rose-200", activeBg: "bg-rose-600",
    dot: "bg-rose-500", value: "text-rose-700", badge: "bg-rose-100 text-rose-700" },
  { key: "hajiTransfers" as const, label: "Haji Transfers",    icon: "↗️", toggleable: true,
    bg: "from-orange-50 to-white", border: "border-orange-200", activeBg: "bg-orange-600",
    dot: "bg-orange-500", value: "text-orange-700", badge: "bg-orange-100 text-orange-700" },
];

const currencyFmt = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `${(v / 1_000).toFixed(0)}K`
  : String(Math.round(v));

const Spinner = ({ size = "lg" }: { size?: "sm" | "lg" }) => (
  <div className={`border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin ${size === "lg" ? "w-8 h-8" : "w-5 h-5"}`} />
);

// Custom tooltip shared across charts
const CustomTooltip = ({ active, payload, label, valueLabel }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur rounded-xl shadow-xl border border-gray-100 px-4 py-3 text-sm min-w-[140px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-gray-500 text-xs">{p.name}:</span>
          <span className="font-bold text-gray-800 ml-auto">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsClient() {
  const { user } = useAuth();
  const { isOnline } = useOffline();

  const [period,        setPeriod]        = useState<Period>("monthly");
  const [year,          setYear]          = useState(new Date().getFullYear());
  const [from,          setFrom]          = useState("");
  const [to,            setTo]            = useState("");
  const [cityId,        setCityId]        = useState<number>(0);
  const [cities,        setCities]        = useState<any[]>([]);
  const [chartData,     setChartData]     = useState<ChartRow[]>([]);
  const [totals,        setTotals]        = useState<Totals | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [activeMetrics, setActiveMetrics] = useState({
    sales: true, payments: true, expenses: true, hajiTransfers: true,
  });

  useEffect(() => {
    if (user?.role === "super_admin")
      apiCall("/api/v1/cities").then((r) => {
        if (r.success) {
          setCities(r.data as any[]);
          const existing = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY)?.data;
          writeOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY, {
            cities: r.data as any[],
            chartData: existing?.chartData || [],
            totals: existing?.totals || null,
            period: existing?.period || period,
            year: existing?.year || year,
            from: existing?.from || from,
            to: existing?.to || to,
            cityId: existing?.cityId || cityId,
          });
          setShowOfflineSnapshot(false);
        } else if (!isOnline) {
          const snapshot = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY)?.data;
          if (snapshot?.cities?.length) {
            setCities(snapshot.cities);
            setShowOfflineSnapshot(true);
          }
        }
      });
  }, [cityId, from, isOnline, period, to, user, year]);

  useEffect(() => {
    if (isOnline) return;
    const snapshot = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY)?.data;
    if (!snapshot) return;
    if (snapshot.cities?.length) setCities(snapshot.cities);
    if (snapshot.chartData?.length) setChartData(snapshot.chartData);
    if (snapshot.totals) setTotals(snapshot.totals);
    setShowOfflineSnapshot(true);
  }, [isOnline]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { period, year: String(year) };
    if (period === "custom" && from && to) { params.from = from; params.to = to; }
    if (cityId) params.cityId = String(cityId);
    const r = await apiCall("/api/v1/analytics", { params });
    if (r.success) {
      const d = r.data as any;
      setChartData(d.chartData || []);
      setTotals(d.totals || null);
      writeOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY, {
        cities,
        chartData: d.chartData || [],
        totals: d.totals || null,
        period,
        year,
        from,
        to,
        cityId,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<AnalyticsReadSnapshot>(ANALYTICS_READ_CACHE_KEY)?.data;
      if (snapshot?.chartData) {
        setChartData(snapshot.chartData);
        setTotals(snapshot.totals || null);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [cities, cityId, from, isOnline, period, to, year]);

  useEffect(() => { load(); }, [load]);

  const toggleMetric = (key: keyof typeof activeMetrics) =>
    setActiveMetrics((prev) => ({ ...prev, [key]: !prev[key] }));

  if (loading && chartData.length === 0) return (
    <div className="flex items-center justify-center py-20">
      <Spinner />
    </div>
  );

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const showDots = chartData.length <= 2;

  const noData = !loading && chartData.length === 0;

  return (
    <div>
      <PageHeader title="Analytics" />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      {/* ── Period Tabs ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["daily", "monthly", "yearly", "custom"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-all ${
              period === p
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {p === "daily" ? "Last 30 Days" : p === "monthly" ? "Monthly" : p === "yearly" ? "Yearly" : "Custom Range"}
          </button>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        {period === "monthly" && (
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className="select-field w-28 text-sm">
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {period === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field w-38 text-sm" />
            <span className="text-gray-400 text-sm font-medium">→</span>
            <input type="date" value={to}   onChange={(e) => setTo(e.target.value)}   className="input-field w-38 text-sm" />
          </>
        )}
        {user?.role === "super_admin" && (
          <select value={cityId} onChange={(e) => setCityId(parseInt(e.target.value))} className="select-field w-44 text-sm">
            <option value={0}>All Cities</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button onClick={load} disabled={loading} className="btn-primary text-sm px-5 py-1.5 flex items-center gap-2 disabled:opacity-60">
          {loading && <Spinner size="sm" />}
          {loading ? "Loading…" : "Apply"}
        </button>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {KPI_CONFIG.map((cfg) => {
          const isActive = !cfg.toggleable || activeMetrics[cfg.key as keyof typeof activeMetrics];
          return (
            <div
              key={cfg.key}
              onClick={() => cfg.toggleable && toggleMetric(cfg.key as keyof typeof activeMetrics)}
              className={`relative overflow-hidden rounded-2xl border p-4 transition-all select-none ${
                cfg.toggleable ? "cursor-pointer" : "cursor-default"
              } ${isActive ? `bg-gradient-to-b ${cfg.bg} ${cfg.border} shadow-sm` : "border-gray-200 bg-white opacity-60"}`}
            >
              {/* Top row: icon + toggle dot */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl">{cfg.icon}</span>
                {cfg.toggleable && (
                  <span className={`w-2 h-2 rounded-full transition-colors ${isActive ? cfg.dot : "bg-gray-300"}`} />
                )}
              </div>
              {/* Label */}
              <p className="text-xs text-gray-500 font-medium leading-tight mb-1">{cfg.label}</p>
              {/* Value */}
              <p className={`text-2xl font-extrabold tracking-tight ${isActive ? cfg.value : "text-gray-300"}`}>
                {totals ? formatNumber(totals[cfg.key as keyof Totals]) : "—"}
              </p>
              {/* Toggle hint */}
              {cfg.toggleable && (
                <p className={`text-[10px] mt-2 font-medium ${isActive ? "text-gray-400" : "text-gray-300"}`}>
                  {isActive ? "● Visible in chart" : "○ Hidden"}
                </p>
              )}
              {/* Decorative circle */}
              {isActive && (
                <div className={`absolute -bottom-4 -right-4 w-16 h-16 rounded-full opacity-10 ${cfg.activeBg}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Main Chart: Sales & Payments ─────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-gray-800">Sales &amp; Payments Over Time</h2>
            <p className="text-xs text-gray-400 mt-0.5">Amounts in local currency</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block bg-indigo-500" />
              Sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block bg-emerald-500" />
              Payments
            </span>
          </div>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center"><Spinner /></div>
        ) : noData ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-300 gap-3">
            <span className="text-5xl">📊</span>
            <span className="text-sm font-medium">No data for this period</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={PALETTE.sales.fill}    stopOpacity={0.22} />
                  <stop offset="100%" stopColor={PALETTE.sales.fill}    stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="paymentsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={PALETTE.payments.fill} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={PALETTE.payments.fill} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#9ca3af", fontWeight: 500 }}
                tickLine={false} axisLine={false}
              />
              <YAxis
                tickFormatter={currencyFmt}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                tickLine={false} axisLine={false} width={52}
              />
              <Tooltip content={<CustomTooltip />} />
              {activeMetrics.sales && (
                <Area
                  type="monotone" dataKey="sales" name="Sales"
                  stroke={PALETTE.sales.stroke} strokeWidth={2.5}
                  fill="url(#salesGrad)"
                  dot={showDots ? { r: 5, fill: PALETTE.sales.fill, stroke: "#fff", strokeWidth: 2.5 } : false}
                  activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2.5 }}
                />
              )}
              {activeMetrics.payments && (
                <Area
                  type="monotone" dataKey="payments" name="Payments"
                  stroke={PALETTE.payments.stroke} strokeWidth={2.5}
                  fill="url(#paymentsGrad)"
                  dot={showDots ? { r: 5, fill: PALETTE.payments.fill, stroke: "#fff", strokeWidth: 2.5 } : false}
                  activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2.5 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Bottom Charts Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">

        {/* Cartons Sold */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">📦</span>
            <h2 className="text-sm font-bold text-gray-800">Cartons Sold</h2>
          </div>
          {loading ? (
            <div className="h-48 flex items-center justify-center"><Spinner /></div>
          ) : noData ? (
            <div className="h-48 flex items-center justify-center text-gray-300 text-sm font-medium">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="cartonsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={PALETTE.cartons.fill} stopOpacity={1} />
                    <stop offset="100%" stopColor={PALETTE.cartons.fill} stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="cartons" name="Cartons" fill="url(#cartonsGrad)" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expenses & Haji Transfers */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">💸</span>
              <h2 className="text-sm font-bold text-gray-800">Expenses &amp; Haji Transfers</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PALETTE.expenses.fill }} />
                Expenses
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PALETTE.hajiTransfers.fill }} />
                Haji
              </span>
            </div>
          </div>
          {loading ? (
            <div className="h-48 flex items-center justify-center"><Spinner /></div>
          ) : noData ? (
            <div className="h-48 flex items-center justify-center text-gray-300 text-sm font-medium">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }} barGap={3}>
                <defs>
                  <linearGradient id="expensesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={PALETTE.expenses.fill} stopOpacity={1} />
                    <stop offset="100%" stopColor={PALETTE.expenses.fill} stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="hajiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={PALETTE.hajiTransfers.fill} stopOpacity={1} />
                    <stop offset="100%" stopColor={PALETTE.hajiTransfers.fill} stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={currencyFmt} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<CustomTooltip />} />
                {activeMetrics.expenses && (
                  <Bar dataKey="expenses" name="Expenses" fill="url(#expensesGrad)" radius={[5, 5, 0, 0]} maxBarSize={28} />
                )}
                {activeMetrics.hajiTransfers && (
                  <Bar dataKey="hajiTransfers" name="Haji Transfers" fill="url(#hajiGrad)" radius={[5, 5, 0, 0]} maxBarSize={28} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center pb-4">
        Click any coloured KPI card above to toggle its series on/off in the charts
      </p>
    </div>
  );
}
