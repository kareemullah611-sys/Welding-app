"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, formatNumber } from "@/components/ui";
import {
  ResponsiveContainer,
  AreaChart, Area,
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

const currencyFmt = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `${(v / 1_000).toFixed(0)}K`
  : String(Math.round(v));

export default function AnalyticsPage() {
  const { user } = useAuth();

  const [period,     setPeriod]     = useState<Period>("monthly");
  const [year,       setYear]       = useState(new Date().getFullYear());
  const [from,       setFrom]       = useState("");
  const [to,         setTo]         = useState("");
  const [cityId,     setCityId]     = useState<number>(0);
  const [cities,     setCities]     = useState<any[]>([]);
  const [chartData,  setChartData]  = useState<ChartRow[]>([]);
  const [totals,     setTotals]     = useState<Totals | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [activeMetrics, setActiveMetrics] = useState({
    sales: true, payments: true, expenses: true, hajiTransfers: true,
  });

  // Load city list for super_admin
  useEffect(() => {
    if (user?.role === "super_admin") {
      apiCall("/api/v1/cities").then((r) => { if (r.success) setCities(r.data as any[]); });
    }
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

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Sales, payments & operational insights" />

      {/* ── Period Tabs ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["daily", "monthly", "yearly", "custom"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
              period === p
                ? "bg-primary-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        {period === "monthly" && (
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="select-field w-32 text-sm"
          >
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}

        {period === "custom" && (
          <>
            <input
              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="input-field w-40 text-sm"
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="input-field w-40 text-sm"
            />
          </>
        )}

        {user?.role === "super_admin" && (
          <select
            value={cityId}
            onChange={(e) => setCityId(parseInt(e.target.value))}
            className="select-field w-44 text-sm"
          >
            <option value={0}>All Cities</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <button onClick={load} className="btn-primary text-sm px-4 py-1.5">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {[
          { key: "sales" as const,         label: "Total Sales",      icon: "🧾", color: "blue"   },
          { key: "payments" as const,      label: "Payments Received",icon: "💰", color: "green"  },
          { key: "cartons" as const,       label: "Cartons Sold",     icon: "📦", color: "purple" },
          { key: "expenses" as const,      label: "Expenses",         icon: "💸", color: "red"    },
          { key: "hajiTransfers" as const, label: "Haji Transfers",   icon: "↗️", color: "orange" },
        ].map(({ key, label, icon, color }) => (
          <div
            key={key}
            className={`rounded-xl p-4 border cursor-pointer transition-all ${
              key !== "cartons" && activeMetrics[key as keyof typeof activeMetrics]
                ? `border-${color}-200 bg-${color}-50 shadow-sm ring-1 ring-${color}-200`
                : "border-gray-200 bg-white"
            }`}
            onClick={() => key !== "cartons" && toggleMetric(key as keyof typeof activeMetrics)}
          >
            <div className="text-lg mb-1">{icon}</div>
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className="text-lg font-bold text-gray-900">
              {totals ? (key === "cartons" ? formatNumber(totals.cartons) : formatNumber(totals[key as keyof Totals])) : "—"}
            </div>
            {key !== "cartons" && (
              <div className={`text-[10px] mt-1 font-medium ${activeMetrics[key as keyof typeof activeMetrics] ? "text-primary-600" : "text-gray-400"}`}>
                {activeMetrics[key as keyof typeof activeMetrics] ? "● Visible" : "○ Hidden"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Main Area Chart: Sales vs Payments ───────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-4">Sales & Payments Over Time</h2>
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-400 text-sm">No data for selected period</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={COLORS.sales}    stopOpacity={0.15} />
                  <stop offset="95%" stopColor={COLORS.sales}    stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="paymentsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={COLORS.payments} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={COLORS.payments} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={currencyFmt} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                formatter={(val: number, name: string) => [formatNumber(val), name === "sales" ? "Sales" : "Payments"]}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeMetrics.sales && (
                <Area type="monotone" dataKey="sales" name="Sales" stroke={COLORS.sales} strokeWidth={2}
                  fill="url(#salesGrad)" dot={false} activeDot={{ r: 4 }} />
              )}
              {activeMetrics.payments && (
                <Area type="monotone" dataKey="payments" name="Payments" stroke={COLORS.payments} strokeWidth={2}
                  fill="url(#paymentsGrad)" dot={false} activeDot={{ r: 4 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Bottom Charts Row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Cartons Sold */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">📦 Cartons Sold</h2>
          {loading || chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-300 text-sm">
              {loading ? <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /> : "No data"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={currencyFmt} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  formatter={(val: number) => [formatNumber(val), "Cartons"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Bar dataKey="cartons" name="Cartons" fill={COLORS.cartons} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expenses & Haji */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 mb-4">💸 Expenses & Haji Transfers</h2>
          {loading || chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-300 text-sm">
              {loading ? <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /> : "No data"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={currencyFmt} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(val: number, name: string) => [formatNumber(val), name === "expenses" ? "Expenses" : "Haji Transfers"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {activeMetrics.expenses && (
                  <Bar dataKey="expenses" name="expenses" fill={COLORS.expenses} radius={[4, 4, 0, 0]} maxBarSize={20} />
                )}
                {activeMetrics.hajiTransfers && (
                  <Bar dataKey="hajiTransfers" name="hajiTransfers" fill={COLORS.hajiTransfers} radius={[4, 4, 0, 0]} maxBarSize={20} />
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4 text-center">
        * Amounts shown in local currency · Click KPI cards to show/hide series in charts
      </p>
    </div>
  );
}
