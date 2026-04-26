"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, StatsCard, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

type ReportType = "sales" | "payments" | "expenses" | "haji_settlement" | "customer_ledger" | "city_ledger" | "discount_history";
const REPORTS_READ_CACHE_KEY = "mrf-reports-read-cache-v1";

type ReportsReadSnapshot = {
  customers: any[];
  cities: any[];
  reportsByType: Partial<Record<ReportType, { data: any[]; summary: any; filters: Record<string, string> }>>;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const stripLegacyReportUrl = (value: unknown) =>
  String(value ?? "").replace(/https?:\/\/welding-app-jhhc\.onrender\.com\/reports/gi, "").trim();

export default function ReportsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline } = useOffline();
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [filters, setFilters] = useState({ date_from: "", date_to: "", customer_id: "", city_id: "" });
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [reportMode, setReportMode] = useState<"quick" | "advanced">("quick");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<ReportsReadSnapshot>(REPORTS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<ReportsReadSnapshot>) => {
    const existing = readSnapshot()?.data || { customers: [], cities: [], reportsByType: {} };
    writeOfflineReadSnapshot<ReportsReadSnapshot>(REPORTS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      reportsByType: { ...(existing.reportsByType || {}), ...(partial.reportsByType || {}) },
    });
  }, [readSnapshot]);

  const applyOfflineSnapshotReport = (type: ReportType) => {
    const snapshot = readSnapshot()?.data;
    const cached = snapshot?.reportsByType?.[type];
    if (!cached) return false;
    setData(cached.data || []);
    setSummary(cached.summary || null);
    setShowOfflineSnapshot(true);
    return true;
  };

  const loadFilters = useCallback(async () => {
    const [custRes, cityRes] = await Promise.all([apiCall("/api/v1/customers", { params: { limit: 200 } }), apiCall("/api/v1/cities")]);
    if (custRes.success) {
      setCustomers(custRes.data as any[]);
      mergeSnapshot({ customers: custRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.customers?.length) {
        setCustomers(snapshot.customers);
        setShowOfflineSnapshot(true);
      }
    }
    if (cityRes.success) {
      setCities(cityRes.data as any[]);
      mergeSnapshot({ cities: cityRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.cities?.length) {
        setCities(snapshot.cities);
        setShowOfflineSnapshot(true);
      }
    }
  }, [isOnline, mergeSnapshot, readSnapshot]);

  useEffect(() => {
    if (
      reportType === "customer_ledger" ||
      reportType === "city_ledger" ||
      reportType === "discount_history" ||
      user?.role === "super_admin"
    ) {
      loadFilters();
    }
  }, [loadFilters, reportType, user?.role]);

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
        mergeSnapshot({
          reportsByType: {
            discount_history: {
              data: items,
              summary: { count: items.length, totalByCurrency: pag?.totalByCurrency || {} },
              filters: { ...filters },
            },
          },
        });
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport("discount_history");
      }
    } else if (reportType === "city_ledger") {
      const cid = filters.city_id || (user?.role === "city_admin" ? String(user.cityId) : "");
      if (!cid) { alert("Select a city"); setLoading(false); return; }
      const result = await apiCall("/api/v1/city-ledger", { params: { city_id: cid, date_from: filters.date_from, date_to: filters.date_to } });
      if (result.success) {
        const d = result.data as any;
        setData(d.entries || []);
        setSummary(d.summary);
        mergeSnapshot({
          reportsByType: {
            city_ledger: {
              data: d.entries || [],
              summary: d.summary || null,
              filters: { ...filters },
            },
          },
        });
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport("city_ledger");
      }
    } else if (reportType === "customer_ledger") {
      if (!filters.customer_id) { alert("Select a customer"); setLoading(false); return; }
      const result = await apiCall(`/api/v1/customers/${filters.customer_id}`, {
        params: {
          ...(filters.date_from ? { date_from: filters.date_from } : {}),
          ...(filters.date_to ? { date_to: filters.date_to } : {}),
        },
      });
      if (result.success) {
        const d = result.data as any;
        const nextSummary = { balance: d.balance, balanceByCurrency: d.balanceByCurrency, name: d.name, isActive: d.isActive, countryCode: d.countryCode || null };
        setData(d.ledger || []);
        setSummary(nextSummary);
        mergeSnapshot({
          reportsByType: {
            customer_ledger: {
              data: d.ledger || [],
              summary: nextSummary,
              filters: { ...filters },
            },
          },
        });
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport("customer_ledger");
      }
    } else {
      const urls: Record<string, string> = { sales: "/api/v1/sales", payments: "/api/v1/payments", expenses: "/api/v1/expenses", haji_settlement: "/api/v1/haji-transfers", discount_history: "/api/v1/discounts" };
      const result = await apiCall(urls[reportType], { params });
      if (result.success) { const items = result.data as any[]; setData(items);
        let nextSummary: any = null;
        if (reportType === "sales") nextSummary = { total: items.reduce((s, i: any) => s + (i.totalAmount || 0), 0), count: items.length };
        else if (reportType === "payments") { const tot = items.reduce((s, i: any) => s + (i.amount || 0), 0); const h = items.filter((i: any) => i.destination === "haji").reduce((s, i: any) => s + (i.amount || 0), 0); nextSummary = { total: tot, haji: h, inHand: tot - h, count: items.length }; }
        else nextSummary = { total: items.reduce((s, i: any) => s + (i.amount || 0), 0), count: items.length };
        setSummary(nextSummary);
        mergeSnapshot({
          reportsByType: {
            [reportType]: {
              data: items,
              summary: nextSummary,
              filters: { ...filters },
            },
          },
        });
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport(reportType);
      }
    }
    setLoading(false);
  };

  const exportXlsx = () => {
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
    p.set("format", "xlsx");
    window.open(`/api/v1/reports/export?${p.toString()}`, "_blank");
  };

  const formatReportCell = (type: ReportType, row: any, key: string) => {
    if (type === "sales") {
      if (key === "saleDate") return formatDate(row.saleDate);
      if (key === "customer") return row.customer?.name || "";
      if (key === "status") return row.status === "marked_short" ? "Short" : "Active";
      if (key === "totalAmount") return Number(row.totalAmount || 0).toLocaleString("en-US");
    }
    if (type === "payments") {
      if (key === "paymentDate") return formatDate(row.paymentDate);
      if (key === "customer") return row.customer?.name || "";
      if (key === "amount") return Number(row.amount || 0).toLocaleString("en-US");
      if (key === "destination") return row.destination === "haji" ? "Haji Account" : "Cash Office";
    }
    if (type === "expenses") {
      if (key === "expenseDate") return formatDate(row.expenseDate);
      if (key === "amount") return Number(row.amount || 0).toLocaleString("en-US");
    }
    if (type === "haji_settlement") {
      if (key === "transferDate") return formatDate(row.transferDate);
      if (key === "amount") return Number(row.amount || 0).toLocaleString("en-US");
    }
    if (type === "customer_ledger") {
      if (key === "date") return formatDate(row.date);
      if (key === "type") return row.type === "sale" ? "Sales" : "Receipt";
      if (key === "debit") return row.debit ? Number(row.debit).toLocaleString("en-US") : "";
      if (key === "credit") return row.credit ? Number(row.credit).toLocaleString("en-US") : "";
      if (key === "balance") return typeof row.balance === "number" && !isNaN(row.balance) ? Number(row.balance).toLocaleString("en-US") : "-";
    }
    if (type === "city_ledger") {
      if (key === "date") return formatDate(row.date);
      if (key === "type") return row.category || row.type || "";
      if (key === "debit") return row.debit ? Number(row.debit).toLocaleString("en-US") : "";
      if (key === "credit") return row.credit ? Number(row.credit).toLocaleString("en-US") : "";
      if (key === "runningCashInHand") return row.runningCashInHand != null && !isNaN(row.runningCashInHand) ? Number(row.runningCashInHand).toLocaleString("en-US") : "—";
    }
    if (type === "discount_history") {
      if (key === "discountDate") return formatDate(row.discountDate);
      if (key === "customer") return row.customer?.name || "";
      if (key === "saleDate") return formatDate(row.saleDate);
      if (key === "discountAmount") return `${row.currency?.symbol || ""} ${Number(row.discountAmount || 0).toLocaleString("en-US")}`.trim();
      if (key === "notes") return row.notes || "-";
    }
    return row?.[key] ?? "";
  };

  const exportPDF = () => {
    if (!data.length) return;
    const headers = activeColumns.map((col: any) => ({ key: String(col.key), label: String(col.label) }));
    const rowsHtml = data.map((row: any, index: number) => `
      <tr class="${index % 2 === 1 ? "alt-row" : ""}">
        ${headers.map((header) => {
          const val = stripLegacyReportUrl(formatReportCell(reportType, row, header.key));
          const cls = header.key === "credit"
            ? "credit-cell"
            : header.key === "debit"
            ? "debit-cell"
            : header.key === "type"
            ? "entry-cell"
            : "";
          return `<td class="${cls}">${escapeHtml(val)}</td>`;
        }).join("")}
      </tr>
    `).join("");
    const reportTitle = reportLabels[reportType];
    const reportRange = filters.date_from && filters.date_to
      ? `${filters.date_from} — ${filters.date_to}`
      : filters.date_from
      ? `From ${filters.date_from}`
      : filters.date_to
      ? `Until ${filters.date_to}`
      : "All dates";
    const html = `
      <html>
        <head>
          <title>${escapeHtml(reportTitle)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #222; padding: 24px; }
            h1 { margin: 0; font-size: 20px; }
            .meta { margin-top: 6px; color: #666; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; }
            th, td { border: 1px solid #e5e7eb; padding: 7px; text-align: left; font-size: 12px; vertical-align: top; }
            th { background: #f8fafc; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; color: #64748b; }
            .alt-row td { background: #f8fafc; }
            .credit-cell { color: #166534; font-weight: 700; text-align: right; }
            .debit-cell { color: #991b1b; font-weight: 700; text-align: right; }
            .entry-cell { color: #1e3a8a; font-weight: 600; }
            @page { margin: 12mm; size: A4 landscape; }
          </style>
        </head>
        <body>
          <h1>MRF Hardware</h1>
          <div class="meta">${escapeHtml(reportTitle)} · ${escapeHtml(reportRange)} · Generated ${escapeHtml(new Date().toLocaleString())}</div>
          ${reportType === "customer_ledger" && summary?.name ? `<div class="meta">Customer: ${escapeHtml(summary.name)}</div>` : ""}
          <table>
            <thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 2000);
    }, 200);
  };

  const cols: Record<string, any[]> = {
    sales: [{ key: "saleDate", label: t("date"), render: (s: any) => formatDate(s.saleDate) }, { key: "voucherNo", label: t("voucher") }, { key: "customer", label: t("customer"), render: (s: any) => s.customer?.name }, { key: "status", label: t("status"), render: (s: any) => s.status === "marked_short" ? <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-800 border border-yellow-200">Short</span> : <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-800 border border-green-200">Active</span> }, { key: "totalAmount", label: t("amount"), render: (s: any) => <span className="font-semibold text-slate-800">{s.totalAmount?.toLocaleString("en-US")}</span> }],
    payments: [{ key: "paymentDate", label: t("date"), render: (p: any) => formatDate(p.paymentDate) }, { key: "customer", label: t("customer"), render: (p: any) => p.customer?.name }, { key: "detail", label: "Particulars", render: (p: any) => stripLegacyReportUrl(p.detail || "-") }, { key: "amount", label: t("amount"), render: (p: any) => <span className="font-semibold text-[#166534]">{p.amount?.toLocaleString("en-US")}</span> }, { key: "paymentMethod", label: "Instrument" }, { key: "destination", label: "Applied To", render: (p: any) => p.destination === "haji" ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">Haji</span> : <span className="text-xs px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">Cash Office</span> }],
    expenses: [{ key: "expenseDate", label: t("date"), render: (e: any) => formatDate(e.expenseDate) }, { key: "detail", label: "Particulars", render: (e: any) => stripLegacyReportUrl(e.detail || "-") }, { key: "amount", label: t("amount"), render: (e: any) => <span className="font-semibold text-[#991b1b]">{e.amount?.toLocaleString("en-US")}</span> }],
    haji_settlement: [{ key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) }, { key: "detail", label: "Particulars", render: (tr: any) => stripLegacyReportUrl(tr.detail || "-") }, { key: "amount", label: t("amount"), render: (tr: any) => <span className="font-semibold text-[#b45309]">{tr.amount?.toLocaleString("en-US")}</span> }, { key: "transferType", label: "Transfer Category" }],
    customer_ledger: [{ key: "date", label: t("date"), render: (e: any) => formatDate(e.date) }, { key: "type", label: "Entry Type", render: (e: any) => <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${e.type === "sale" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-green-200 bg-green-50 text-green-900"}`}>{e.type === "sale" ? "Sales" : "Receipt"}</span> }, { key: "detail", label: "Particulars", render: (e: any) => stripLegacyReportUrl(e.detail || "-") }, { key: "perCartonPrice", label: "Per Crt Price", className: "w-[112px] whitespace-nowrap", render: (e: any) => <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">{e.perCartonPrice || "-"}</span> }, { key: "currency", label: t("currency"), render: (e: any) => <span className="text-xs font-semibold text-gray-500">{e.currency}</span> }, { key: "debit", label: "Debit", render: (e: any) => e.debit ? <span className="text-[#991b1b] font-semibold">{e.debit.toLocaleString("en-US")}</span> : "" }, { key: "credit", label: "Credit", render: (e: any) => e.credit ? <span className="text-[#166534] font-semibold">{e.credit.toLocaleString("en-US")}</span> : "" }, { key: "balance", label: "Closing Balance", render: (e: any) => { const b = e.balance; return <span className="font-semibold text-slate-800">{(typeof b === "number" && !isNaN(b)) ? b.toLocaleString("en-US") : "-"}</span>; } }],
    city_ledger: [{ key: "date", label: t("date"), render: (e: any) => formatDate(e.date) }, { key: "type", label: "Entry Type", render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded border ${e.type === "sale" ? "bg-blue-50 text-blue-900 border-blue-200" : e.type === "payment" ? "bg-green-50 text-green-900 border-green-200" : e.type === "expense" ? "bg-red-50 text-red-900 border-red-200" : "bg-amber-50 text-amber-900 border-amber-200"}`}>{e.category || e.type}</span> }, { key: "description", label: "Particulars", className: "max-w-xs truncate", render: (e: any) => stripLegacyReportUrl(e.description || "-") }, { key: "currency", label: t("currency"), render: (e: any) => <span className="text-xs font-semibold text-gray-500">{e.currency}</span> }, { key: "debit", label: "Debit", render: (e: any) => (e.debit && !isNaN(e.debit)) ? <span className="text-[#991b1b] font-semibold">{Number(e.debit).toLocaleString("en-US")}</span> : "" }, { key: "credit", label: "Credit", render: (e: any) => (e.credit && !isNaN(e.credit)) ? <span className="text-[#166534] font-semibold">{Number(e.credit).toLocaleString("en-US")}</span> : "" }, { key: "runningCashInHand", label: "Closing Cash Position", render: (e: any) => <span className="font-medium text-slate-800">{(e.runningCashInHand != null && !isNaN(e.runningCashInHand)) ? Number(e.runningCashInHand).toLocaleString("en-US") : "—"}</span> }],
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
  const isPakistanCustomerLedger = reportType === "customer_ledger" && String(summary?.countryCode || "").toUpperCase() === "PK";
  const activeColumns = (cols[reportType] || cols.sales).filter((col) => !(reportType === "customer_ledger" && isPakistanCustomerLedger && col.key === "currency"));

  return (
    <div>
      {/* Print-only header — hidden on screen, shown in PDF */}
      {data.length > 0 && (
        <div className="print-only mb-4 pb-3 border-b border-gray-300">
          <h1 className="text-lg font-bold text-gray-900">MRF Hardware</h1>
          <p className="text-sm font-semibold text-gray-700">{reportLabels[reportType]}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {filters.date_from && filters.date_to
              ? `${filters.date_from} — ${filters.date_to}`
              : filters.date_from
              ? `From ${filters.date_from}`
              : filters.date_to
              ? `Until ${filters.date_to}`
              : "All dates"}
            {reportType === "customer_ledger" && summary?.name ? ` · Customer: ${summary.name}` : ""}
            {" · "}Generated {new Date().toLocaleString()}
          </p>
        </div>
      )}

      <PageHeader title={t("reports")} subtitle="Generate formal operational and ledger reports" />
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached report output for this device.
        </div>
      )}
      <div className="card mb-6 no-print">
        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={() => setReportMode("quick")} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${reportMode === "quick" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"}`}>Quick Reports</button>
          <button onClick={() => setReportMode("advanced")} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${reportMode === "advanced" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"}`}>Advanced Reports</button>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(reportMode === "quick"
            ? (["sales", "payments", "expenses", "customer_ledger"] as ReportType[])
            : (["haji_settlement", "city_ledger", "discount_history"] as ReportType[])
          ).map((type) => (
            <button
              key={type}
              onClick={() => { setReportType(type); setData([]); setSummary(null); }}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                reportType === type ? "border-primary-500 bg-primary-50" : "border-gray-200 bg-white hover:border-primary-300"
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">{reportLabels[type]}</div>
              <div className="mt-1 text-xs text-gray-500">
                {type === "sales" && "Daily sale history and totals"}
                {type === "payments" && "Receipts and Haji split"}
                {type === "expenses" && "Cost and office spending"}
                {type === "customer_ledger" && "Single customer statement"}
                {type === "haji_settlement" && "Transfers and Haji settlement trail"}
                {type === "city_ledger" && "Full city cash and ledger view"}
                {type === "discount_history" && "Discount audit history"}
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
        {(reportType === "customer_ledger" || reportType === "discount_history") && <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("customer")}</label><select value={filters.customer_id} onChange={(e) => setFilters((f) => ({ ...f, customer_id: e.target.value }))} className="select-field w-auto"><option value="">{t("all_customers")}</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {showCityFilter && <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("city")}</label><select value={filters.city_id} onChange={(e) => setFilters((f) => ({ ...f, city_id: e.target.value }))} className="select-field w-auto"><option value="">{t("all_cities")}</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("from")}</label><input type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} className="input-field w-auto" /></div>
        <div><label className="block text-xs font-medium text-gray-500 mb-1">{t("to")}</label><input type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} className="input-field w-auto" /></div>
        <button onClick={runReport} disabled={loading} className="btn-primary text-sm">{loading ? t("loading") : t("generate")}</button>
        {data.length > 0 && <><button onClick={exportXlsx} className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Export XLSX</button><button onClick={exportPDF} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium">Export PDF</button></>}
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
      {reportType === "customer_ledger" && summary?.name && data.length > 0 && (
        <div className="mb-3 rounded-xl border border-[#e5dccf] bg-[#f9f4ec] px-4 py-2.5 text-sm text-[#4b3b2b]">
          <span className="font-semibold">Customer:</span> {summary.name}
        </div>
      )}
      {data.length > 0 && (
        <DataTable
          columns={activeColumns}
          data={data}
          loading={loading}
          stripedRows
        />
      )}
    </div>
  );
}
