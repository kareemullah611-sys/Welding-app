"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, formatNumber } from "@/components/ui";
import {
  ResponsiveContainer,
  ComposedChart, Area, Line,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
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

const COLORS = {
  sales:         "#3b82f6",
  payments:      "#22c55e",
  expenses:      "#ef4444",
  hajiTransfers: "#f97316",
  cartons:       "#8b5cf6",
};

// Static Tailwind classes — never use dynamic `border-${color}-200` (gets purged in prod)
const CARD_STYLES: Record<string, { active: string; inactive: string; dot: string; value: string }> = {
  sales:         { active: "border-blue-200 bg-blue-50 shadow ring-1 ring-blue-100",     inactive: "border-gray-200 bg-white hover:bg-gray-50", dot: "bg-blue-500",    value: "text-blue-700"   },
  payments:      { active: "border-green-200 bg-green-50 shadow ring-1 ring-green-100",  inactive: "border-gray-200 bg-white hover:bg-gray-50", dot: "bg-green-500",   value: "text-green-700"  },
  cartons:       { active: "border-purple-200 bg-purple-50 shadow ring-1 ring-purple-100", inactive: "border-gray-200 bg-white hover:bg-gray-50", dot: "bg-purple-500", value: "text-purple-700" },
  expenses:      { active: "border-red-200 bg-red-50 shadow ring-1 ring-red-100",        inactive: "border-gray-200 bg-white hover:bg-gray-50", dot: "bg-red-500",     value: "text-red-700"    },
  hajiTransfers: { active: "border-orange-200 bg-orange-50 shadow ring-1 ring-orange-100", inactive: "border-gray-200 bg-white hover:bg-gray-50", dot: "bg-orange-500", value: "text-orange-700" },
};

const currencyFmt = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `${(v / 1_000).toFixed(0)}K`
  : String(Math.round(v));

const Spinner = ({ size = "lg" }: { size?: "sm" | "lg" }) => (
  <div className={`border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin ${size === "lg" ? "w-8 h-8" : "w-5 h-5"}`} />
);

export default function AnalyticsClient() {
  const { user } = useAuth();

  const [period,       setPeriod]       = useState<Period>("monthly");
  const [year,         setYear]         = useState(new Date().getFullYear());
  const [from,         setFrom]         = useState("");
  const [to,           setTo]           = useState("");
  const [cityId,       setCityId]       = useState<number>(0);
  const [cities,       setCities]       = useState<any[]>([]);
  const [chartData,    setChartData]    = useState<ChartRow[]>([]);
  const [totals,       setTotals]       = useState<Totals | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [activeMetrics, setActiveMetrics] = useState({
    sales: true, payments: true, expenses: true, hajiTransfers: true,
  });

  useEffect(() => {
    if (user?.role === "super_admin")
      apiCall("/api/v1/cities").then((r) => { if (r.success) setCities(r.data as any[]); });
  }, [user]);

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
    }
    setLoading(false);
  }, [period, year, from, to, cityId]);

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

  // Show dot on single-point charts so data is visible
  const showDots = chartData.length <= 2;

  const KPI_ITEMS = [
    { key: "sales"         as const, label: "Total Sales",       icon: "🧾", toggleable: true  },
    { key: "payments"      as const, label: "Payments Received", icon: "💰", toggleable: true  },
    { key: "cartons"       as const, label: "Cartons Sold",      icon: "📦", toggleable: false },
    { key: "expenses"      as const, label: "Expenses",          icon: "💸", toggleable: true  },
    { key: "hajiTransfers" as const, label: "Haji Transfers",    icon: "↗️", toggleable: true  },
  ];

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Sales, payments & operational insights" />

      {/* ── Period Tabs ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["daily", "monthly", "yearly", "custom"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
              period === p ? "bg-primary-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {p === "daily" ? "Last 30 Days" : p === "monthly" ? "Monthly" : p === "yearly" ? "Yearly" : "Custom Range"}
          </button>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
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

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {KPI_ITEMS.map(({ key, label, icon, toggleable }) => {
          const isActive = !toggleable || activeMetrics[key as keyof typeof activeMetrics];
          const styles   = CARD_STYLES[key];
          return (
            <div
              key={key}
              onClick={() => toggleable && toggleMetric(key as keyof typeof activeMetrics)}
              className={`rounded-xl p-4 border transition-all select-none ${
                toggleable ? "cursor-pointer" : "cursor-default"
              } ${isActive ? styles.active : styles.inactive}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-base">{icon}</span>
                {toggleable && (
                  <span className={`w-2 h-2 rounded-full ${isActive ? styles.dot : "bg-gray-300"}`} />
                )}
              </div>
              <p className="text-xs text-gray-500 leading-tight mb-1">{label}</p>
              <p className={`text-xl font-bold ${isActive ? styles.value : "text-gray-400"}`}>
                {totals ? formatNumber(totals[key as keyof Totals]) : "—"}
              </p>
              {toggleable && (
                <p className="text-[10px] mt-1.5 text-gray-400">
                  {isActive ? "● showing in chart" : "○ hidden"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Main Chart: Sales & Payments ────────────────────────────── */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Sales & Payments Over Time</h2>
          <span className="text-xs text-gray-400">Amounts in local currency</span>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center"><Spinner /></div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400 gap-2">
            <span className="text-3xl">📊</span>
            <span className="text-sm">No data for this period</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={COLORS.sales}    stopOpacity={0.18} />
                  <stop offset="100%" stopColor={COLORS.sales}    stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="paymentsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={COLORS.payments} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={COLORS.payments} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={currencyFmt} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={52} />
              <Tooltip
                formatter={(val: number, name: string) => [
                  formatNumber(val),
                  name === "sales" ? "Sales" : name === "payments" ? "Payments" : name,
                ]}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                labelStyle={{ fontWeight: 600, color: "#374151", marginBottom: 4 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                formatter={(value) => value === "sales" ? "Sales" : "Payments"}
              />
              {activeMetrics.sales && (
                <Area
                  type="monotone" dataKey="sales" name="sales"
                  stroke={COLORS.sales} strokeWidth={2.5}
                  fill="url(#salesGrad)"
                  dot={showDots ? { r: 5, fill: COLORS.sales, stroke: "#fff", strokeWidth: 2 } : false}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                />
              )}
              {activeMetrics.payments && (
                <Area
                  type="monotone" dataKey="payments" name="payments"
                  stroke={COLORS.payments} strokeWidth={2.5}
                  fill="url(#paymentsGrad)"
                  dot={showDots ? { r: 5, fill: COLORS.payments, stroke: "#fff", strokeWidth: 2 } : false}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Bottom Charts Row ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-4">

        {/* Cartons Sold */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">📦 Cartons Sold</h2>
          {loading ? (
            <div className="h-44 flex items-center justify-center"><Spinner /></div>
          ) : chartData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  formatter={(val: number) => [formatNumber(val), "Cartons"]}
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e5e7eb" }}
                />
                <Bar dataKey="cartons" name="Cartons" fill={COLORS.cartons} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expenses & Haji Transfers */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">💸 Expenses & Haji Transfers</h2>
          {loading ? (
            <div className="h-44 flex items-center justify-center"><Spinner /></div>
          ) : chartData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 10, left: 0, bottom: 4 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={currencyFmt} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  formatter={(val: number, name: string) => [
                    formatNumber(val),
                    name === "expenses" ? "Expenses" : "Haji Transfers",
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e5e7eb" }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => value === "expenses" ? "Expenses" : "Haji Transfers"}
                />
                {activeMetrics.expenses && (
                  <Bar dataKey="expenses" name="expenses" fill={COLORS.expenses} radius={[4, 4, 0, 0]} maxBarSize={28} />
                )}
                {activeMetrics.hajiTransfers && (
                  <Bar dataKey="hajiTransfers" name="hajiTransfers" fill={COLORS.hajiTransfers} radius={[4, 4, 0, 0]} maxBarSize={28} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center pb-2">
        Click any coloured KPI card above to toggle its series on/off in the charts
      </p>
    </div>
  );
}
