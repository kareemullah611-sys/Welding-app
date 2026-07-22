"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, StatsCard, EmptyState, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { openLedgerExport } from "@/lib/ledger-export";
import { GlassButton } from "@/components/ui/GlassButton";
import { CalendarRange, FileSpreadsheet, Printer, Play } from "lucide-react";

type ReportType = "haji_settlement" | "city_ledger" | "discount_history";
type DatePreset = "month" | "last7" | "all" | "custom";

const REPORTS_READ_CACHE_KEY = "mrf-reports-read-cache-v1";

type ReportsReadSnapshot = {
  customers: any[];
  cities: any[];
  reportsByType: Partial<Record<ReportType, { data: any[]; summary: any; filters: Record<string, string> }>>;
};

function formatInputDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function getCurrentMonthDateRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: formatInputDate(from), to: formatInputDate(today) };
}

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
  const { isOnline, queuedItems } = useOffline();
  const [reportType, setReportType] = useState<ReportType>("city_ledger");
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    customer_id: "",
    city_id: "",
  });
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [formError, setFormError] = useState("");
  const [customers, setCustomers] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [tableSearch, setTableSearch] = useState("");

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
    setReportGenerated(true);
    setShowOfflineSnapshot(true);
    return true;
  };

  const parseQueuedBody = (body: string) => {
    try { return JSON.parse(body || "{}"); } catch { return {}; }
  };

  const getPendingHajiRows = useCallback(() => {
    const rows: any[] = [];
    for (const q of queuedItems as any[]) {
      if (String(q?.method || "").toUpperCase() !== "POST") continue;
      if (q.url !== "/api/v1/haji-transfers") continue;
      const parsed = parseQueuedBody(String(q?.body || "{}"));
      rows.push({
        id: `pending-${q.id}`,
        transferDate: parsed?.transferDate || parsed?.date || new Date().toISOString().slice(0, 10),
        detail: parsed?.detail || "Pending offline haji transfer",
        amount: Number(parsed?.amount || 0),
        transferType: parsed?.transferType || "from_in_hand",
        _pending: true,
      });
    }
    return rows;
  }, [queuedItems]);

  const loadFilters = useCallback(async () => {
    const [custRes, cityRes] = await Promise.all([
      apiCall("/api/v1/customers", { params: { limit: 200 } }),
      apiCall("/api/v1/cities"),
    ]);
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
    loadFilters();
  }, [loadFilters]);

  const showCityFilter = user?.role === "super_admin";
  const reportLabels: Record<ReportType, string> = {
    haji_settlement: t("haji_settlement"),
    city_ledger: t("city_ledger"),
    discount_history: t("discount_history"),
  };

  const dateRangeLabel = useMemo(() => {
    if (filters.date_from && filters.date_to) return `${filters.date_from} — ${filters.date_to}`;
    if (filters.date_from) return `From ${filters.date_from}`;
    if (filters.date_to) return `Until ${filters.date_to}`;
    return "All dates";
  }, [filters.date_from, filters.date_to]);

  const selectedCityName = useMemo(() => {
    const cid = filters.city_id || (user?.role === "city_admin" ? String(user.cityId ?? "") : "");
    if (!cid) return null;
    return cities.find((c) => String(c.id) === String(cid))?.name || null;
  }, [cities, filters.city_id, user?.cityId, user?.role]);

  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === "custom") return;
    const today = new Date();
    if (preset === "all") {
      setFilters((f) => ({ ...f, date_from: "", date_to: "" }));
      return;
    }
    if (preset === "last7") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      setFilters((f) => ({ ...f, date_from: formatInputDate(from), date_to: formatInputDate(today) }));
      return;
    }
    const range = getCurrentMonthDateRange();
    setFilters((f) => ({ ...f, date_from: range.from, date_to: range.to }));
  };

  const selectReportType = (type: ReportType) => {
    setReportType(type);
    setData([]);
    setSummary(null);
    setReportGenerated(false);
    setFormError("");
    setTableSearch("");
  };

  const runReport = async () => {
    setLoading(true);
    setFormError("");
    if (!customers.length) await loadFilters();

    if (reportType === "discount_history") {
      const p: Record<string, string> = {};
      if (filters.date_from) p.date_from = filters.date_from;
      if (filters.date_to) p.date_to = filters.date_to;
      if (filters.city_id) p.city_id = filters.city_id;
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
        setReportGenerated(true);
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport("discount_history");
      } else {
        setFormError("Could not load discount history. Please try again.");
      }
    } else if (reportType === "city_ledger") {
      const cid = filters.city_id || (user?.role === "city_admin" ? String(user.cityId) : "");
      if (!cid) {
        setFormError("Select a city before generating the city ledger report.");
        setLoading(false);
        return;
      }
      const result = await apiCall("/api/v1/city-ledger", {
        params: { city_id: cid, date_from: filters.date_from, date_to: filters.date_to },
      });
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
        setReportGenerated(true);
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport("city_ledger");
      } else {
        setFormError("Could not load city ledger. Please try again.");
      }
    } else {
      const params: Record<string, string | number> = { limit: 200, status: "active" };
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.city_id) params.city_id = filters.city_id;
      const result = await apiCall("/api/v1/haji-transfers", { params });
      if (result.success) {
        const items = result.data as any[];
        const nextItems = [...getPendingHajiRows(), ...items];
        setData(nextItems);
        const nextSummary = {
          total: nextItems.reduce((s, i: any) => s + (i.amount || 0), 0),
          count: nextItems.length,
        };
        setSummary(nextSummary);
        mergeSnapshot({
          reportsByType: {
            haji_settlement: {
              data: nextItems,
              summary: nextSummary,
              filters: { ...filters },
            },
          },
        });
        setReportGenerated(true);
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        applyOfflineSnapshotReport("haji_settlement");
      } else {
        setFormError("Could not load Haji settlement report. Please try again.");
      }
    }
    setLoading(false);
  };

  const exportXlsx = () => {
    const exportType = reportType === "city_ledger" ? "ledger" : "haji_transfers";
    openLedgerExport({
      type: exportType,
      dateFrom: filters.date_from || undefined,
      dateTo: filters.date_to || undefined,
      cityId: filters.city_id || user?.cityId || undefined,
      query: tableSearch.trim().length >= 2 ? tableSearch.trim() : undefined,
    });
  };

  const formatReportCell = (type: ReportType, row: any, key: string) => {
    if (type === "haji_settlement") {
      if (key === "transferDate") return formatDate(row.transferDate);
      if (key === "amount") return Number(row.amount || 0).toLocaleString("en-US");
    }
    if (type === "city_ledger") {
      if (key === "date") return formatDate(row.date);
      if (key === "type") return row.category || row.type || "";
      if (key === "debit") return row.debit ? Number(row.debit).toLocaleString("en-US") : "";
      if (key === "credit") return row.credit ? Number(row.credit).toLocaleString("en-US") : "";
      if (key === "runningCashInHand") {
        return row.runningCashInHand != null && !isNaN(row.runningCashInHand)
          ? Number(row.runningCashInHand).toLocaleString("en-US")
          : "—";
      }
    }
    if (type === "discount_history") {
      if (key === "discountDate") return formatDate(row.discountDate);
      if (key === "customer") return row.customer?.name || "";
      if (key === "saleDate") return formatDate(row.saleDate);
      if (key === "discountAmount") {
        return `${row.currency?.symbol || ""} ${Number(row.discountAmount || 0).toLocaleString("en-US")}`.trim();
      }
      if (key === "notes") return row.notes || "-";
    }
    return row?.[key] ?? "";
  };

  const cols: Record<ReportType, any[]> = {
    haji_settlement: [
      { key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) },
      { key: "detail", label: "Particulars", render: (tr: any) => stripLegacyReportUrl(tr.detail || "-") },
      { key: "amount", label: t("amount"), render: (tr: any) => <span className="font-semibold tabular-nums text-amber-700">{tr.amount?.toLocaleString("en-US")}</span> },
      { key: "transferType", label: "Transfer Category" },
    ],
    city_ledger: [
      { key: "date", label: t("date"), render: (e: any) => formatDate(e.date) },
      {
        key: "type",
        label: "Entry Type",
        render: (e: any) => (
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            e.type === "sale" ? "border-blue-200 bg-blue-50 text-blue-900"
            : e.type === "payment" ? "border-green-200 bg-green-50 text-green-900"
            : e.type === "expense" ? "border-red-200 bg-red-50 text-red-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
          }`}>
            {e.category || e.type}
          </span>
        ),
      },
      { key: "description", label: "Particulars", className: "max-w-xs truncate", render: (e: any) => stripLegacyReportUrl(e.description || "-") },
      { key: "currency", label: t("currency"), render: (e: any) => <span className="text-xs font-semibold text-gray-500">{e.currency}</span> },
      { key: "debit", label: "Debit", render: (e: any) => (e.debit && !isNaN(e.debit)) ? <span className="font-semibold tabular-nums text-rose-700">{Number(e.debit).toLocaleString("en-US")}</span> : "" },
      { key: "credit", label: "Credit", render: (e: any) => (e.credit && !isNaN(e.credit)) ? <span className="font-semibold tabular-nums text-emerald-700">{Number(e.credit).toLocaleString("en-US")}</span> : "" },
      { key: "runningCashInHand", label: "Closing Cash Position", render: (e: any) => <span className="font-medium tabular-nums text-slate-800">{(e.runningCashInHand != null && !isNaN(e.runningCashInHand)) ? Number(e.runningCashInHand).toLocaleString("en-US") : "—"}</span> },
    ],
    discount_history: [
      { key: "discountDate", label: t("date"), render: (d: any) => formatDate(d.discountDate) },
      { key: "customer", label: t("customer"), render: (d: any) => d.customer?.name },
      { key: "saleVoucherNo", label: t("sale_voucher") },
      { key: "saleDate", label: t("sale_date"), render: (d: any) => formatDate(d.saleDate) },
      { key: "lotNumber", label: t("lot") },
      { key: "discountAmount", label: t("discount"), render: (d: any) => <span className="font-medium tabular-nums text-amber-700">{d.currency?.symbol} {d.discountAmount?.toLocaleString("en-US")}</span> },
      { key: "notes", label: t("notes"), render: (d: any) => d.notes || "-" },
      { key: "createdBy", label: t("by") },
    ],
  };

  const activeColumns = cols[reportType];
  const reportSearchColumnKeys: Record<ReportType, string[]> = {
    haji_settlement: ["detail"],
    city_ledger: ["description"],
    discount_history: ["customer", "saleVoucherNo", "lotNumber", "notes"],
  };
  const supportsXlsxExport = reportType === "city_ledger" || reportType === "haji_settlement";

  const filteredExportRows = useMemo(() => {
    const needle = tableSearch.trim().toLowerCase();
    if (needle.length < 2) return data;
    const keys = reportSearchColumnKeys[reportType];
    return data.filter((row) =>
      keys.some((key) =>
        stripLegacyReportUrl(formatReportCell(reportType, row, key))
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [data, reportType, tableSearch]);

  const exportPDF = () => {
    if (!filteredExportRows.length) return;
    const headers = activeColumns.map((col: any) => ({ key: String(col.key), label: String(col.label) }));
    const rowsHtml = filteredExportRows.map((row: any, index: number) => `
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
          <div class="meta">${escapeHtml(reportTitle)} · ${escapeHtml(dateRangeLabel)}${tableSearch.trim() ? ` · Search: ${escapeHtml(tableSearch.trim())}` : ""} · Generated ${escapeHtml(new Date().toLocaleString())}</div>
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

  return (
    <div className="space-y-6">
      {data.length > 0 && (
        <div className="print-only mb-4 border-b border-gray-300 pb-3">
          <h1 className="text-lg font-bold text-gray-900">MRF Hardware</h1>
          <p className="text-sm font-semibold text-gray-700">{reportLabels[reportType]}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {dateRangeLabel} · Generated {new Date().toLocaleString()}
          </p>
        </div>
      )}

      <PageHeader
        title={t("reports")}
        subtitle="Cross-module analytical reports for city treasury, Haji settlement, and discount audit."
      />

      {showOfflineSnapshot && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Offline snapshot — showing the last cached report output for this device.
        </div>
      )}

      <section className="card no-print overflow-hidden p-0">
        <div className="border-b border-[#ececee] bg-[#fafafa] px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#3f3f46]">
            <CalendarRange className="h-4 w-4 text-[#8B1A1A]" strokeWidth={1.75} />
            Parameters
          </div>
          <p className="mt-1 text-xs text-[#71717a]">
            Choose a report, set scope, then generate. Table search is included in exports.
          </p>
        </div>

        <div className="space-y-4 px-5 py-5">
          {formError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#71717a]">Report type</label>
              <select
                value={reportType}
                onChange={(e) => selectReportType(e.target.value as ReportType)}
                className="select-field w-full"
              >
                <option value="city_ledger">{reportLabels.city_ledger}</option>
                <option value="haji_settlement">{reportLabels.haji_settlement}</option>
                <option value="discount_history">{reportLabels.discount_history}</option>
              </select>
            </div>
            {showCityFilter && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#71717a]">{t("city")}</label>
                <select
                  value={filters.city_id}
                  onChange={(e) => setFilters((f) => ({ ...f, city_id: e.target.value }))}
                  className="select-field w-full"
                >
                  <option value="">{t("all_cities")}</option>
                  {cities.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {reportType === "discount_history" && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#71717a]">{t("customer")}</label>
                <select
                  value={filters.customer_id}
                  onChange={(e) => setFilters((f) => ({ ...f, customer_id: e.target.value }))}
                  className="select-field w-full"
                >
                  <option value="">{t("all_customers")}</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#71717a]">Period</label>
              <select
                value={datePreset}
                onChange={(e) => applyDatePreset(e.target.value as DatePreset)}
                className="select-field w-full"
              >
                <option value="month">This month</option>
                <option value="last7">Last 7 days</option>
                <option value="all">All dates</option>
                <option value="custom">Custom range</option>
              </select>
            </div>

            {datePreset === "custom" && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#71717a]">{t("from")}</label>
                  <input
                    type="date"
                    value={filters.date_from}
                    onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#71717a]">{t("to")}</label>
                  <input
                    type="date"
                    value={filters.date_to}
                    onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
                    className="input-field w-full"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#ececee] pt-4">
            <GlassButton
              type="button"
              onClick={runReport}
              disabled={loading}
              className="px-5 py-2.5"
            >
              <Play className="h-4 w-4" strokeWidth={2} />
              {loading ? t("loading") : t("generate")}
            </GlassButton>
            <p className="text-xs text-[#71717a]">
              {dateRangeLabel}
              {selectedCityName ? ` · ${selectedCityName}` : ""}
            </p>
          </div>
        </div>
      </section>

      {!reportGenerated && !loading && (
        <div className="card flex min-h-[220px] items-center justify-center py-12 no-print">
          <EmptyState message="Choose a report, set parameters, and click Generate to view results." />
        </div>
      )}

      {reportGenerated && summary && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 no-print">
          {reportType === "city_ledger" ? (
            <>
              {Object.entries(summary.cashInHand || {}).map(([cc, v]: [string, any]) => (
                <StatsCard key={`cash-${cc}`} title={`Closing Cash (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="💰" color="green" />
              ))}
              {Object.entries(summary.totalReceivables || {}).map(([cc, v]: [string, any]) => (
                <StatsCard key={`rec-${cc}`} title={`${t("receivables")} (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="📋" color="blue" />
              ))}
              {Object.entries(summary.totalHajiOwed || {}).map(([cc, v]: [string, any]) => (
                <StatsCard key={`haji-${cc}`} title={`Haji liability (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="↗️" color="yellow" />
              ))}
              {Object.entries(summary.totalSalesByCurrency || {}).map(([cc, v]: [string, any]) => (
                <StatsCard key={`sales-${cc}`} title={`${t("total_sales")} (${cc})`} value={`${cc} ${formatNumber(v)}`} icon="🧾" color="blue" />
              ))}
            </>
          ) : reportType === "discount_history" ? (
            <>
              <StatsCard title={t("discounts_given")} value={formatNumber(summary.count)} icon="🏷️" color="yellow" />
              {Object.entries(summary.totalByCurrency || {}).map(([cc, amt]: [string, any]) => (
                <StatsCard key={cc} title={`${t("total")} (${cc})`} value={`${cc} ${formatNumber(amt)}`} icon="💸" color="red" />
              ))}
            </>
          ) : (
            <>
              <StatsCard title="Entries" value={formatNumber(summary.count)} icon="📄" color="blue" />
              <StatsCard title={t("total")} value={formatNumber(summary.total)} icon="💰" color="green" />
            </>
          )}
        </section>
      )}

      {reportGenerated && (
        <section className="card module-page no-print p-0">
          <div className="flex flex-col gap-3 border-b border-[#ececee] bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#18181b]">{reportLabels[reportType]}</h2>
              <p className="mt-0.5 text-xs text-[#71717a]">
                {dateRangeLabel}
                {selectedCityName ? ` · ${selectedCityName}` : ""}
                {tableSearch.trim() ? ` · Search: ${tableSearch.trim()}` : ""}
                {" · "}
                {filteredExportRows.length.toLocaleString("en-US")} {filteredExportRows.length === 1 ? "row" : "rows"}
              </p>
            </div>
            {filteredExportRows.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {supportsXlsxExport && (
                  <GlassButton
                    type="button"
                    variant="xlsx"
                    onClick={exportXlsx}
                    disabled={!isOnline}
                    title={!isOnline ? "Export requires an internet connection" : undefined}
                    className="px-4 py-2"
                  >
                    <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
                    Export XLSX
                  </GlassButton>
                )}
                <GlassButton
                  type="button"
                  variant="pdf"
                  onClick={exportPDF}
                  className="px-4 py-2"
                >
                  <Printer className="h-4 w-4" strokeWidth={1.75} />
                  Print / PDF
                </GlassButton>
              </div>
            )}
          </div>

          <div className="p-1 sm:p-2">
            <DataTable
              columns={activeColumns}
              data={data}
              loading={loading}
              stripedRows
              searchValue={tableSearch}
              onSearchChange={setTableSearch}
              emptyMessage="No entries matched the selected filters."
              searchColumnKeys={reportSearchColumnKeys[reportType]}
              searchPlaceholder={
                reportType === "city_ledger"
                  ? "Search particulars…"
                  : reportType === "discount_history"
                  ? "Customer, voucher, lot, notes…"
                  : "Search…"
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}
