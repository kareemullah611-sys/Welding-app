"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { GlassButton } from "@/components/ui/GlassButton";

type TBRow = {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  family: string;
  familyLabel: string;
  currencyCode: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
};

type TBGroup = {
  family: string;
  familyLabel: string;
  accountType: string;
  sortOrder: number;
  rows: TBRow[];
  totals: Record<string, { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number; closingDebit: number; closingCredit: number }>;
};

type TBSection = {
  accountType: string;
  label: string;
  sortOrder: number;
  groups: TBGroup[];
};

type Reconciliation = {
  currency: string;
  openingDiff: number;
  periodDiff: number;
  closingDiff: number;
  balanced: boolean;
};

type TBData = {
  sections: TBSection[];
  currencyTotals: Record<string, { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number; closingDebit: number; closingCredit: number }>;
  reconciliation: Reconciliation[];
  allBalanced: boolean;
  reconciliationMeaningful: boolean;
  filters: { dateFrom: string; dateTo: string; cityId: string | number; currency: string; accountType: string; search: string };
};

function n(v: number): string {
  if (v == null || isNaN(v)) return "0";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function TrialBalancePage() {
  const { user } = useAuth();
  const { t } = useLang();
  const router = useRouter();

  const [data, setData] = useState<TBData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cityId, setCityId] = useState("");
  const [currency, setCurrency] = useState("");
  const [accountType, setAccountType] = useState("");
  const [search, setSearch] = useState("");
  const [cities, setCities] = useState<any[]>([]);
  const [financialYears, setFinancialYears] = useState<any[]>([]);
  const [financialYearLabel, setFinancialYearLabel] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user?.role !== "super_admin") return;
    Promise.all([
      apiCall("/api/v1/cities"),
      apiCall("/api/v1/financial-years"),
    ]).then(([citiesRes, fyRes]) => {
      if (citiesRes.success) setCities((citiesRes.data as any[]) || []);
      if (fyRes.success) {
        const years = (fyRes.data as any[]) || [];
        setFinancialYears(years);
        const selected = years.find((y: any) => y.status === "open") || years[0];
        if (selected) {
          setDateFrom(String(selected.startDate).slice(0, 10));
          setDateTo(String(selected.endDate).slice(0, 10));
          setFinancialYearLabel(selected.name || "");
        }
      }
    });
  }, [user]);

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    const params: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
    if (cityId) params.city_id = cityId;
    if (currency) params.currency = currency;
    if (accountType) params.account_type = accountType;
    if (search) params.q = search;
    const r = await apiCall("/api/v1/trial-balance", { params });
    if (r.success) setData(r.data as TBData);
    setLoading(false);
  }, [dateFrom, dateTo, cityId, currency, accountType, search]);

  useEffect(() => { load(); }, [load]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Expand all groups before printing, then trigger print
  const handlePrint = useCallback(() => {
    if (!data) return;
    const allKeys = new Set<string>();
    for (const section of data.sections) {
      for (const group of section.groups) {
        allKeys.add(`${section.accountType}:${group.family}`);
      }
    }
    setExpandedGroups(allKeys);
    setTimeout(() => window.print(), 100);
  }, [data]);

  const allCurrencyCodes = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.currencyTotals).sort();
  }, [data]);

  const handleExportXlsx = useCallback(() => {
    if (!data) return;
    const params: Record<string, string> = { date_from: dateFrom, date_to: dateTo, type: "trial_balance", format: "xlsx" };
    if (cityId) params.city_id = cityId;
    if (currency) params.currency = currency;
    if (accountType) params.account_type = accountType;
    if (search) params.q = search;
    window.open(`/api/v1/trial-balance/export?${new URLSearchParams(params)}`, "_blank");
  }, [data, dateFrom, dateTo, cityId, currency, accountType, search]);

  const handleRowClick = (row: TBRow) => {
    const params = new URLSearchParams({
      account_id: String(row.accountId),
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (cityId) params.set("city_id", cityId);
    if (currency) params.set("currency", row.currencyCode);
    router.push(`/accounts/ledger?${params.toString()}`);
  };

  if (user && user.role !== "super_admin") {
    return (
      <div>
        <PageHeader title="Trial Balance" />
        <div className="card py-12 text-center text-gray-400">Super Admin Only</div>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        @media print {
          /* Hide sidebar, filters, and interactive controls */
          nav, .sidebar, [data-sidebar],
          .card:first-of-type form,
          .card:first-of-type .flex { display: none !important; }
          /* Hide buttons row */
          .no-print { display: none !important; }
          /* Ensure all groups are expanded in print */
          table { break-inside: auto; }
          tr { break-inside: avoid; }
          /* Professional header */
          @page { margin: 1.5cm; }
          body { font-size: 10pt; }
        }
      `}</style>
      <div className="print-only hidden print:block mb-4 text-center border-b pb-2">
        <h1 className="text-xl font-bold">Trial Balance</h1>
        <div className="text-xs text-gray-500">
          Period: {data?.filters?.dateFrom || ""} to {data?.filters?.dateTo || ""}
          {data?.filters?.cityId && data.filters.cityId !== "all" ? ` | City: ${data.filters.cityId}` : ""}
          {data?.filters?.currency && data.filters.currency !== "all" ? ` | Currency: ${data.filters.currency}` : ""}
        </div>
      </div>
      <PageHeader title="Trial Balance" />
      {financialYearLabel && (
        <div className="mb-3 text-xs text-gray-500 no-print">
          Prefilled from {financialYearLabel}. Dates remain editable.
        </div>
      )}

      <div className="card mb-4 no-print">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From Date</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field w-auto text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To Date</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field w-auto text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">City</label>
            <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="select-field w-auto text-sm">
              <option value="">All Cities</option>
              {cities.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="select-field w-auto text-sm">
              <option value="">All Currencies</option>
              {["PKR", "USD", "AFN", "CNY", "AED"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Account Type</label>
            <select value={accountType} onChange={(e) => setAccountType(e.target.value)} className="select-field w-auto text-sm">
              <option value="">All Types</option>
              {["asset", "liability", "equity", "revenue", "cogs", "expense"].map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts..." className="input-field text-sm" />
          </div>
          <div className="flex gap-2">
            <GlassButton variant="primary" onClick={load} disabled={loading || !dateFrom || !dateTo}>
              {loading ? "Loading..." : "Apply"}
            </GlassButton>
            <GlassButton variant="secondary" onClick={() => { setCityId(""); setCurrency(""); setAccountType(""); setSearch(""); }}>
              Reset
            </GlassButton>
          </div>
        </div>
      </div>

      {data && data.reconciliation.length > 0 && (
        <div className="mb-4">
          {!data.reconciliationMeaningful && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Reconciliation shown for reference only. D/C imbalance is expected when a subset of accounts is filtered.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.reconciliation.map((r) => {
              const isFilteredSubset = !data.reconciliationMeaningful;
              const showBalanced = isFilteredSubset ? true : r.balanced;
              return (
                <div key={r.currency} className={`card ${showBalanced ? "border-green-200" : "border-red-300"}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm">{r.currency}</span>
                    {isFilteredSubset ? (
                      <span className="text-gray-400 text-xs font-medium">Filtered subset</span>
                    ) : r.balanced ? (
                      <span className="text-green-700 text-xs font-medium">Balanced ✓</span>
                    ) : (
                      <span className="text-red-700 text-xs font-medium">Integrity Issue — Difference: Rs {n(Math.abs(r.closingDiff))}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-gray-400">Opening Diff</div>
                      <div className={isFilteredSubset || Math.abs(r.openingDiff) < 0.01 ? "text-gray-600" : "text-red-700"}>{n(r.openingDiff)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Period Diff</div>
                      <div className={isFilteredSubset || Math.abs(r.periodDiff) < 0.01 ? "text-gray-600" : "text-red-700"}>{n(r.periodDiff)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Closing Diff</div>
                      <div className={isFilteredSubset || Math.abs(r.closingDiff) < 0.01 ? "text-gray-600" : "text-red-700"}>{n(r.closingDiff)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && data.sections.length > 0 && (
        <div className="mb-4 flex gap-2 no-print">
          <GlassButton variant="xlsx" onClick={handleExportXlsx}>Export XLSX</GlassButton>
          <GlassButton variant="pdf" onClick={handlePrint}>Print / PDF</GlassButton>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading...</div>
      ) : data && data.sections.length > 0 ? (
        <div className="space-y-4">
          {data.sections.map((section) => (
            <div key={section.accountType}>
              <h2 className="text-lg font-bold text-gray-800 mb-2">{section.label}</h2>
              {section.groups.map((group) => {
                const groupKey = `${section.accountType}:${group.family}`;
                const isExpanded = expandedGroups.has(groupKey) || expandedGroups.size === 0;
                return (
                  <div key={groupKey} className="card mb-3">
                    <button
                      className="w-full flex justify-between items-center py-1 text-left"
                      onClick={() => toggleGroup(groupKey)}
                    >
                      <span className="text-sm font-semibold text-gray-700">{group.familyLabel}</span>
                      <div className="flex items-center gap-3">
                        {Object.entries(group.totals).map(([curr, totals]) => (
                          <span key={curr} className="text-xs text-gray-500">
                            {curr}: Dr {n(totals.closingDebit)} / Cr {n(totals.closingCredit)}
                          </span>
                        ))}
                        <span className="text-gray-400 text-xs">{isExpanded ? "▼" : "▶"}</span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm mt-2">
                          <thead>
                            <tr className="border-b text-xs text-gray-500">
                              <th className="text-left py-1 pr-2">Account</th>
                              <th className="text-left py-1 pr-2">Currency</th>
                              <th className="text-right py-1 px-2">Opening Dr</th>
                              <th className="text-right py-1 px-2">Opening Cr</th>
                              <th className="text-right py-1 px-2">Period Dr</th>
                              <th className="text-right py-1 px-2">Period Cr</th>
                              <th className="text-right py-1 px-2">Closing Dr</th>
                              <th className="text-right py-1 pl-2">Closing Cr</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.rows.map((row) => (
                              <tr
                                key={`${row.accountId}:${row.currencyCode}`}
                                className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                                onClick={() => handleRowClick(row)}
                              >
                                <td className="py-1.5 pr-2">
                                  <span className="text-gray-800 font-medium">{row.accountName}</span>
                                  <span className="text-gray-400 text-xs ml-1">({row.accountCode})</span>
                                </td>
                                <td className="py-1.5 pr-2 text-gray-600">{row.currencyCode}</td>
                                <td className="py-1.5 px-2 text-right">{row.openingDebit > 0 ? n(row.openingDebit) : ""}</td>
                                <td className="py-1.5 px-2 text-right">{row.openingCredit > 0 ? n(row.openingCredit) : ""}</td>
                                <td className="py-1.5 px-2 text-right">{row.periodDebit > 0 ? n(row.periodDebit) : ""}</td>
                                <td className="py-1.5 px-2 text-right">{row.periodCredit > 0 ? n(row.periodCredit) : ""}</td>
                                <td className="py-1.5 px-2 text-right font-medium">{row.closingDebit > 0 ? n(row.closingDebit) : ""}</td>
                                <td className="py-1.5 pl-2 text-right font-medium">{row.closingCredit > 0 ? n(row.closingCredit) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div className="card">
            <h2 className="text-lg font-bold text-gray-800 mb-3">Grand Totals</h2>
            {Object.entries(data.currencyTotals).map(([curr, totals]) => (
              <div key={curr} className="mb-3">
                <h3 className="text-sm font-semibold text-gray-600 mb-1">{curr}</h3>
                <div className="grid grid-cols-6 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-gray-400">Opening Dr</div>
                    <div className="font-medium">{n(totals.openingDebit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Opening Cr</div>
                    <div className="font-medium">{n(totals.openingCredit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Period Dr</div>
                    <div className="font-medium">{n(totals.periodDebit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Period Cr</div>
                    <div className="font-medium">{n(totals.periodCredit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Closing Dr</div>
                    <div className="font-medium">{n(totals.closingDebit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Closing Cr</div>
                    <div className="font-medium">{n(totals.closingCredit)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="py-12 text-center text-gray-400">No journal entries found for the selected period.</div>
      ) : null}
    </div>
  );
}
