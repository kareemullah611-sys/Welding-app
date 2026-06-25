"use client";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, StatusBadge } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

const TYPE_VALUES = ["all", "customers", "sales", "payments", "lots", "products", "haji_transfers", "expenses"];
const SEARCH_READ_CACHE_KEY = "mrf-search-read-cache-v1";

type SearchReadSnapshot = {
  cities: any[];
  results: any;
  query: string;
  type: string;
  cityId?: number;
};

export default function SearchPage() {
  const { user } = useAuth();
  const { isOnline } = useOffline();
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [cityId, setCityId] = useState<number | undefined>(undefined);
  const [cities, setCities] = useState<any[]>([]);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const TYPES = [
    { value: "all", label: t("all") },
    { value: "customers", label: t("customers") },
    { value: "sales", label: t("sales") },
    { value: "payments", label: t("payments") },
    { value: "lots", label: t("lots") },
    { value: "products", label: t("products") },
    { value: "haji_transfers", label: t("haji_transfers") },
    { value: "expenses", label: t("expenses") },
  ];

  useEffect(() => {
    if (user?.role === "super_admin") {
      apiCall("/api/v1/cities").then(r => {
        if (r.success) {
          setCities(r.data as any[]);
          const existing = readOfflineReadSnapshot<SearchReadSnapshot>(SEARCH_READ_CACHE_KEY)?.data;
          writeOfflineReadSnapshot<SearchReadSnapshot>(SEARCH_READ_CACHE_KEY, {
            cities: r.data as any[],
            results: existing?.results || null,
            query: existing?.query || "",
            type: existing?.type || "all",
            cityId: existing?.cityId,
          });
          setShowOfflineSnapshot(false);
        } else if (!isOnline) {
          const snapshot = readOfflineReadSnapshot<SearchReadSnapshot>(SEARCH_READ_CACHE_KEY)?.data;
          if (snapshot?.cities?.length) {
            setCities(snapshot.cities);
            setShowOfflineSnapshot(true);
          }
        }
      });
    }
  }, [isOnline, user]);

  useEffect(() => {
    if (isOnline) return;
    const snapshot = readOfflineReadSnapshot<SearchReadSnapshot>(SEARCH_READ_CACHE_KEY)?.data;
    if (!snapshot) return;
    if (snapshot.query) setQuery(snapshot.query);
    if (snapshot.type) setType(snapshot.type);
    if (snapshot.cityId) setCityId(snapshot.cityId);
    if (snapshot.results) setResults(snapshot.results);
    setShowOfflineSnapshot(true);
  }, [isOnline]);

  const doSearch = async () => {
    if (query.length < 2) return;
    setLoading(true);
    const params: any = { q: query, type };
    if (cityId) params.city_id = cityId;
    const result = await apiCall("/api/v1/search", { params });
    if (result.success) {
      setResults(result.data);
      writeOfflineReadSnapshot<SearchReadSnapshot>(SEARCH_READ_CACHE_KEY, {
        cities,
        results: result.data,
        query,
        type,
        cityId,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<SearchReadSnapshot>(SEARCH_READ_CACHE_KEY)?.data;
      if (snapshot?.results) {
        setResults(snapshot.results);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") doSearch(); };

  const totalResults = results ? Object.values(results).reduce((sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 0) : 0;

  return (
    <div>
      <PageHeader title={t("search")} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[10rem] flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">{t("search")}</label>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Customer name, voucher no, detail..." className="input-field" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t("category")}</label>
            <select value={type} onChange={e => setType(e.target.value)} className="select-field w-auto">
              {TYPES.map(ty => <option key={ty.value} value={ty.value}>{ty.label}</option>)}
            </select>
          </div>
          {user?.role === "super_admin" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("city")}</label>
              <select value={cityId || ""} onChange={e => setCityId(e.target.value ? parseInt(e.target.value) : undefined)} className="select-field w-auto">
                <option value="">{t("all_cities")}</option>
                {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={doSearch} disabled={loading || query.length < 2} className="btn-primary text-sm">
            {loading ? t("searching") : `🔍 ${t("search")}`}
          </button>
        </div>
      </div>

      {results && (
        <div className="mb-4 text-sm text-gray-500">{totalResults} {t("records").toLowerCase()} found</div>
      )}

      {results?.customers?.length > 0 && (
        <ResultSection title={`👥 ${t("customers")}`} count={results.customers.length}>
          <DataTable searchable={false} columns={[
            { key: "name", label: t("name"), render: (c: any) => <span className="font-medium">{c.name}</span> },
            { key: "city", label: t("city") },
            { key: "phone", label: t("phone"), render: (c: any) => c.phone || "-" },
          ]} data={results.customers} loading={false} />
        </ResultSection>
      )}

      {results?.sales?.length > 0 && (
        <ResultSection title={`🧾 ${t("sales")}`} count={results.sales.length}>
          <DataTable searchable={false} columns={[
            { key: "voucherNo", label: t("voucher"), render: (s: any) => <span className="font-medium">{s.voucherNo}</span> },
            { key: "customer", label: t("customer") },
            { key: "amount", label: t("amount"), render: (s: any) => `${s.currency} ${s.amount.toLocaleString("en-US")}` },
            { key: "date", label: t("date") },
            { key: "status", label: t("status"), render: (s: any) => <StatusBadge status={s.status} /> },
          ]} data={results.sales} loading={false} />
        </ResultSection>
      )}

      {results?.payments?.length > 0 && (
        <ResultSection title={`💰 ${t("payments")}`} count={results.payments.length}>
          <DataTable searchable={false} columns={[
            { key: "customer", label: t("customer") },
            { key: "detail", label: t("detail") },
            { key: "amount", label: t("amount"), render: (p: any) => `${p.currency} ${p.amount.toLocaleString("en-US")}` },
            { key: "date", label: t("date") },
            { key: "status", label: t("status"), render: (p: any) => <StatusBadge status={p.status} /> },
          ]} data={results.payments} loading={false} />
        </ResultSection>
      )}

      {results?.haji_transfers?.length > 0 && (
        <ResultSection title={`↗️ ${t("haji_transfers")}`} count={results.haji_transfers.length}>
          <DataTable searchable={false} columns={[
            { key: "detail", label: t("detail") },
            { key: "amount", label: t("amount"), render: (h: any) => `${h.currency} ${h.amount.toLocaleString("en-US")}` },
            { key: "date", label: t("date") },
            { key: "city", label: t("city") },
            { key: "lotNumber", label: t("lot") },
            { key: "transferType", label: t("type") },
          ]} data={results.haji_transfers} loading={false} />
        </ResultSection>
      )}

      {results?.expenses?.length > 0 && (
        <ResultSection title={`💸 ${t("expenses")}`} count={results.expenses.length}>
          <DataTable searchable={false} columns={[
            { key: "detail", label: t("detail") },
            { key: "amount", label: t("amount"), render: (e: any) => `${e.currency} ${e.amount.toLocaleString("en-US")}` },
            { key: "date", label: t("date") },
            { key: "city", label: t("city") },
            { key: "lotNumber", label: t("lot") },
          ]} data={results.expenses} loading={false} />
        </ResultSection>
      )}

      {results?.lots?.length > 0 && (
        <ResultSection title={`📦 ${t("lots")}`} count={results.lots.length}>
          <DataTable searchable={false} columns={[
            { key: "lotNumber", label: t("lot_num"), render: (l: any) => <span className="font-medium">{l.lotNumber}</span> },
            { key: "country", label: t("country") },
            { key: "date", label: t("date") },
            { key: "status", label: t("status"), render: (l: any) => <StatusBadge status={l.status} /> },
          ]} data={results.lots} loading={false} />
        </ResultSection>
      )}

      {results?.products?.length > 0 && (
        <ResultSection title={`📋 ${t("products")}`} count={results.products.length}>
          <DataTable searchable={false} columns={[
            { key: "name", label: t("name"), render: (p: any) => <span className="font-medium">{p.name}</span> },
            { key: "isActive", label: t("active"), render: (p: any) => p.isActive ? "✅" : "❌" },
          ]} data={results.products} loading={false} />
        </ResultSection>
      )}

      {results && totalResults === 0 && (
        <div className="text-center py-12 text-gray-400">{t("no_results_found")} &ldquo;{query}&rdquo;</div>
      )}
    </div>
  );
}

function ResultSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <h3 className="text-sm font-semibold text-gray-600 mb-3">{title} <span className="text-xs text-gray-400">({count})</span></h3>
      {children}
    </div>
  );
}
