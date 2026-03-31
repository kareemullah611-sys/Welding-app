"use client";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, StatsCard, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";

type ReportType = "sales" | "payments" | "expenses" | "haji_settlement" | "customer_ledger" | "city_ledger" | "discount_history";

export default function ReportsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [filters, setFilters] = useState({ date_from: "", date_to: "", customer_id: "", city_id: "" });
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);

  const loadFilters = async () => {
    const [custRes, cityRes] = await Promise.all([apiCall("/api/v1/customers", { params: { limit: 200 } }), apiCall("/api/v1/cities")]);
    if (custRes.success) setCustomers(custRes.data as any[]);
    if (cityRes.success) setCities(cityRes.data as any[]);
  };

  useEffect(() => {
    if (
      reportType === "customer_ledger" ||
      reportType === "city_ledger" ||
      reportType === "discount_history" ||
      user?.role === "super_admin"
    ) {
      loadFilters();
    }
  }, [reportType, user?.role]);

  const showCityFilter = user?.role === "super_admin" && reportType !== "customer_ledger";

  const runReport = async () => {
    setLoading(true); if (!customers.length) await loadFilters();
    const params: any = { limit: 200, status: reportType === "sales" ? "active,marked_short" : "active" };
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.city_id) params.city_id = filters.city_id;

    if (reportType === "discount_history") {
      const p: any = {};
      if (filters.date_from) p.date_from = filters.date_from;
      if (filters.date_to)   p.date_to   = filters.date_to;
      if (filters.city_id)   p.city_id   = filters.city_id;
      if (filters.customer_id) p.customer_id = filters.customer_id;
      const result = await apiCall("/api/v1/discounts", { params: p });
      if (result.success) {
        const items = result.data as any[];
        setData(items);
        const pag = result.pagination as any;
        setSummary({ count: items.length, totalByCurrency: pag?.totalByCurrency || {} });
      }
    } else if (reportType === "city_ledger") {
      const cid = filters.city_id || (user?.role === "city_admin" ? String(user.cityId) : "");
      if (!cid) { alert("Select a city"); setLoading(false); return; }
      const result = await apiCall("/api/v1/city-ledger", { params: { city_id: cid, date_from: filters.date_from, date_to: filters.date_to } });
      if (result.success) { const d = result.data as any; setData(d.entries || []); setSummary(d.summary); }
    } else if (reportType === "customer_ledger") {
      if (!filters.customer_id) { alert("Select a customer"); setLoading(false); return; }
      const result = await apiCall(`/api/v1/customers/${filters.customer_id}`);
      if (result.success) { const d = result.data as any; setData(d.ledger || []); setSummary({ balance: d.balance, balanceByCurrency: d.balanceByCurrency, name: d.name, isActive: d.isActive }); }
    } else {
      const urls: Record<string, string> = { sales: "/api/v1/sales", payments: "/api/v1/payments", expenses: "/api/v1/expenses", haji_settlement: "/api/v1/haji-transfers", discount_history: "/api/v1/discounts" };
      const result = await apiCall(urls[reportType], { params });
      if (result.success) { const items = result.data as any[]; setData(items);
        if (reportType === "sales") setSummary({ total: items.reduce((s, i: any) => s + (i.totalAmount || 0), 0), count: items.length });
        else if (reportType === "payments") { const tot = items.reduce((s, i: any) => s + (i.amount || 0), 0); const h = items.filter((i: any) => i.destination === "haji").reduce((s, i: any) => s + (i.amount || 0), 0); setSummary({ total: tot, haji: h, inHand: tot - h, count: items.length }); }
        else setSummary({ total: items.reduce((s, i: any) => s + (i.amount || 0), 0), count: items.length });
      }
    }
    setLoading(false);
  };

  const exportCSV = () => {
    const tp = reportType === "city_ledger"
      ? "ledger"
      : reportType === "customer_ledger"
      ? "customer_ledger"
      : reportType === "haji_settlement"
      ? "haji_transfers"
      : reportType;
    const p = new URLSearchParams({ type: tp });
    if (filters.date_from) p.set("date_from", filters.date_from);
    if (filters.date_to) p.set("date_to", filters.date_to);
    if (filters.city_id) p.set("city_id", filters.city_id);
    else if (user?.cityId) p.set("city_id", String(user.cityId));
    if (reportType === "customer_ledger" && filters.customer_id) p.set("customer_id", filters.customer_id);
    window.open(`/api/v1/reports/export?${p.toString()}`, "_blank");
  };

  const cols: Record<string, any[]> = {
    sales: [{ key: "saleDate", label: t("date"), render: (s: any) => formatDate(s.saleDate) }, { key: "voucherNo", label: t("voucher") }, { key: "customer", label: t("customer"), render: (s: any) => s.customer?.name }, { key: "status", label: t("status"), render: (s: any) => s.status === "marked_short" ? <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700">⚠️ Short</span> : <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">Active</span> }, { key: "totalAmount", label: t("amount"), render: (s: any) => <span className="font-medium">{s.totalAmount?.toLocaleString("en-US")}</span> }],
    payments: [{ key: "paymentDate", label: t("date"), render: (p: any) => formatDate(p.paymentDate) }, { key: "customer", label: t("customer"), render: (p: any) => p.customer?.name }, { key: "detail", label: "Particulars" }, { key: "amount", label: t("amount"), render: (p: any) => <span className="font-medium">{p.amount?.toLocaleString("en-US")}</span> }, { key: "paymentMethod", label: "Instrument" }, { key: "destination", label: "Applied To", render: (p: any) => p.destination === "haji" ? "Haji Account" : "Cash Office" }],
    expenses: [{ key: "expenseDate", label: t("date"), render: (e: any) => formatDate(e.expenseDate) }, { key: "detail", label: "Particulars" }, { key: "amount", label: t("amount"), render: (e: any) => <span className="text-red-600 font-medium">{e.amount?.toLocaleString("en-US")}</span> }],
    haji_settlement: [{ key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) }, { key: "detail", label: "Particulars" }, { key: "amount", label: t("amount"), render: (tr: any) => <span className="text-orange-600 font-medium">{tr.amount?.toLocaleString("en-US")}</span> }, { key: "transferType", label: "Transfer Category" }],
    customer_ledger: [{ key: "date", label: t("date"), render: (e: any) => formatDate(e.date) }, { key: "type", label: "Entry Type", render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "sale" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{e.type === "sale" ? "Sales Invoice" : "Receipt"}</span> }, { key: "currency", label: t("currency"), render: (e: any) => <span className="text-xs font-semibold text-gray-500">{e.currency}</span> }, { key: "detail", label: "Particulars" }, { key: "debit", label: "Debit", render: (e: any) => e.debit ? <span className="text-red-600">{e.debit.toLocaleString("en-US")}</span> : "" }, { key: "credit", label: "Credit", render: (e: any) => e.credit ? <span className="text-green-600">{e.credit.toLocaleString("en-US")}</span> : "" }, { key: "balance", label: "Closing Balance", render: (e: any) => { const b = e.balance; return <span className="font-medium">{(typeof b === "number" && !isNaN(b)) ? b.toLocaleString("en-US") : "-"}</span>; } }],
    city_ledger: [{ key: "date", label: t("date"), render: (e: any) => formatDate(e.date) }, { key: "type", label: "Entry Type", render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "sale" ? "bg-blue-50 text-blue-700" : e.type === "payment" ? "bg-green-50 text-green-700" : e.type === "expense" ? "bg-red-50 text-red-700" : "bg-orange-50 text-orange-700"}`}>{e.category || e.type}</span> }, { key: "description", label: "Particulars", className: "max-w-xs truncate" }, { key: "currency", label: t("currency"), render: (e: any) => <span className="text-xs font-semibold text-gray-500">{e.currency}</span> }, { key: "debit", label: "Debit", render: (e: any) => (e.debit && !isNaN(e.debit)) ? <span className="text-red-600">{Number(e.debit).toLocaleString("en-US")}</span> : "" }, { key: "credit", label: "Credit", render: (e: any) => (e.credit && !isNaN(e.credit)) ? <span className="text-green-600">{Number(e.credit).toLocaleString("en-US")}</span> : "" }, { key: "runningCashInHand", label: "Closing Cash Position", render: (e: any) => <span className="font-medium">{(e.runningCashInHand != null && !isNaN(e.runningCashInHand)) ? Number(e.runningCashInHand).toLocaleString("en-US") : "—"}</span> }],
    discount_history: [
      { key: "discountDate", label: t("date"), render: (d: any) => formatDate(d.discountDate) },
      { key: "customer",     label: t("customer"),    render: (d: any) => d.customer?.name },
      { key: "saleVoucherNo",label: t("sale_voucher") },
      { key: "saleDate",     label: t("sale_date"), render: (d: any) => formatDate(d.saleDate) },
      { key: "lotNumber",    label: t("lot") },
      { key: "discountAmount", label: t("discount"), render: (d: any) => <span className="font-medium text-yellow-700">{d.currency?.symbol} {d.discountAmount?.toLocaleString("en-US")}</span> },
      { key: "notes",        label: t("notes"),       render: (d: any) => d.notes || "-" },
      { key: "createdBy",    label: t("by") },
    ],
  };

  const reportLabels: Record<ReportType, string> = {
    sales: t("sales"), payments: t("payments"), expenses: t("expenses"),
    haji_settlement: t("haji_settlement"), customer_ledger: t("customer_ledger"),
    city_ledger: t("city_ledger"), discount_history: t("discount_history"),
  };

  return (
    <div>
      {/* Print-only header — hidden on screen, shown in PDF */}
      {data.length > 0 && (
        <div className="print-only mb-4 pb-3 border-b border-gray-300">
          <h1 className="text-lg font-bold text-gray-900">{reportLabels[reportType]}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {filters.date_from && filters.date_to
              ? `${filters.date_from} — ${filters.date_to}`
              : filters.date_from
              ? `From ${filters.date_from}`
              : filters.date_to
              ? `Until ${filters.date_to}`
              : "All dates"}
            {" · "}Printed {new Date().toLocaleDateString()}
          </p>
        </div>
      )}

      <PageHeader title={t("reports")} subtitle="Generate formal operational and ledger reports" />
      <div className="card mb-6 no-print"><div className="flex flex-wrap gap-3 items-end">
        <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("report_type")}</label><select value={reportType} onChange={(e) => { setReportType(e.target.value as ReportType); setData([]); setSummary(null); }} className="select-field w-auto">
          <option value="sales">{t("sales")}</option>
          <option value="payments">{t("payments")}</option>
          <option value="expenses">{t("expenses")}</option>
          <option value="haji_settlement">{t("haji_settlement")}</option>
          <option value="customer_ledger">{t("customer_ledger")}</option>
          <option value="city_ledger">{t("city_ledger")}</option>
          <option value="discount_history">{t("discount_history")}</option>
        </select></div>
        {(reportType === "customer_ledger" || reportType === "discount_history") && <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("customer")}</label><select value={filters.customer_id} onChange={(e) => setFilters((f) => ({ ...f, customer_id: e.target.value }))} className="select-field w-auto"><option value="">{t("all_customers")}</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {showCityFilter && <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("city")}</label><select value={filters.city_id} onChange={(e) => setFilters((f) => ({ ...f, city_id: e.target.value }))} className="select-field w-auto"><option value="">{t("all_cities")}</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("from")}</label><input type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} className="input-field w-auto" /></div>
        <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("to")}</label><input type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} className="input-field w-auto" /></div>
        <button onClick={runReport} disabled={loading} className="btn-primary text-sm">{loading ? t("loading") : t("generate")}</button>
        {data.length > 0 && <><button onClick={exportCSV} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm">📥 {t("csv")}</button><button onClick={() => window.print()} className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm">🖨️ {t("print")}</button></>}
      </div></div>
      {summary && <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {reportType === "city_ledger" ? <>
          {Object.entries(summary.cashInHand || {}).map(([cc, v]: [string, any]) => <StatsCard key={`cash-${cc}`} title={`Closing Cash Position (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="💰" color="green" />)}
          {Object.entries(summary.totalReceivables || {}).map(([cc, v]: [string, any]) => <StatsCard key={`rec-${cc}`} title={`${t("receivables")} (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="📋" color="blue" />)}
          {Object.entries(summary.totalHajiOwed || {}).map(([cc, v]: [string, any]) => <StatsCard key={`haji-${cc}`} title={`Liability to Haji (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="↗️" color="yellow" />)}
          {Object.entries(summary.totalSalesByCurrency || {}).map(([cc, v]: [string, any]) => <StatsCard key={`sales-${cc}`} title={`${t("total_sales")} (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="🧾" color="blue" />)}
        </>
        : reportType === "customer_ledger" ? <><StatsCard title={t("customer")} value={summary.name} icon="👤" color="blue" />{summary.balanceByCurrency && Object.keys(summary.balanceByCurrency).length > 0 ? Object.entries(summary.balanceByCurrency).map(([cc, amt]: [string, any]) => <StatsCard key={cc} title={`Closing Balance (${cc})`} value={`${cc} ${formatNumber(Math.abs(amt || 0))}`} icon={amt > 0 ? "📋" : "✅"} color={amt > 0 ? "red" : "green"} />) : <StatsCard title="Closing Balance" value={formatNumber(typeof summary.balance === "number" && !isNaN(summary.balance) ? Math.abs(summary.balance) : 0)} icon={summary.balance > 0 ? "📋" : "✅"} color={summary.balance > 0 ? "red" : "green"} />}</>
        : reportType === "discount_history"
          ? <><StatsCard title={t("discounts_given")} value={formatNumber(summary.count)} icon="🏷️" color="yellow" />{Object.entries(summary.totalByCurrency || {}).map(([cc, amt]: [string, any]) => <StatsCard key={cc} title={`${t("total")} (${cc})`} value={`${cc} ${formatNumber(amt)}`} icon="💸" color="red" />)}</>
          : <><StatsCard title="Entries" value={formatNumber(summary.count)} icon="📄" color="blue" /><StatsCard title={t("total")} value={formatNumber(summary.total)} icon="💰" color="green" />{summary.haji !== undefined && <StatsCard title="Transferred to Haji" value={formatNumber(summary.haji)} icon="↗️" color="yellow" />}{summary.inHand !== undefined && <StatsCard title="Cash Office Retention" value={formatNumber(summary.inHand)} icon="💰" color="green" />}</>}
      </div>}
      {data.length > 0 && <DataTable columns={cols[reportType] || cols.sales} data={data} loading={loading} />}
    </div>
  );
}
