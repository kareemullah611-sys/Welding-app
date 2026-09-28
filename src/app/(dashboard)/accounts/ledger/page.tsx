"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader } from "@/components/ui";
import { GlassButton } from "@/components/ui/GlassButton";

type LedgerEntry = {
  id: number;
  transactionId: string;
  lineNumber: number;
  debit: number;
  credit: number;
  currencyCode: string;
  exchangeRate: number | null;
  description: string;
  entityType: string | null;
  entityId: number | null;
  lotId: number | null;
  cityId: number | null;
  entryDate: string;
  balance: number;
  sourcePath: string | null;
};

type LedgerMeta = {
  account: { id: number; code: string; name: string; type: string };
  openingDebit: number;
  openingCredit: number;
  openingBalance: number;
  closingBalance: number;
  filters: { dateFrom: string; dateTo: string; cityId: string | number; currency: string };
};

type LedgerData = {
  data: LedgerEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  meta: LedgerMeta;
};

function n(v: number): string {
  if (v == null || isNaN(v)) return "0";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function AccountLedgerPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const accountId = searchParams.get("account_id");
  const initialDateFrom = searchParams.get("date_from") || "";
  const initialDateTo = searchParams.get("date_to") || "";
  const initialCityId = searchParams.get("city_id") || "";
  const initialCurrency = searchParams.get("currency") || "";

  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [cityId, setCityId] = useState(initialCityId);
  const [currency, setCurrency] = useState(initialCurrency);
  const [cities, setCities] = useState<any[]>([]);

  useEffect(() => {
    if (user?.role !== "super_admin") return;
    apiCall("/api/v1/cities").then((r) => {
      if (r.success) setCities((r.data as any[]) || []);
    });
  }, [user]);

  const load = useCallback(async (pageNum: number) => {
    if (!accountId) return;
    setLoading(true);
    const params: Record<string, string> = { account_id: accountId, page: String(pageNum) };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (cityId) params.city_id = cityId;
    if (currency) params.currency = currency;
    const r = await apiCall("/api/v1/account-ledger", { params });
    if (r.success) setData(r.data as LedgerData);
    setLoading(false);
  }, [accountId, dateFrom, dateTo, cityId, currency]);

  useEffect(() => { load(page); }, [load, page]);

  const openingBalance = data?.meta?.openingBalance ?? 0;

  if (user && user.role !== "super_admin") {
    return (
      <div>
        <PageHeader title="Account Ledger" />
        <div className="card py-12 text-center text-gray-400">Super Admin Only</div>
      </div>
    );
  }

  if (!accountId) {
    return (
      <div>
        <PageHeader title="Account Ledger" />
        <div className="card py-12 text-center text-gray-400">No account selected.</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={data?.meta?.account ? `${data.meta.account.name} (${data.meta.account.code})` : "Account Ledger"} />

      <div className="card mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From Date</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="input-field w-auto text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To Date</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="input-field w-auto text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">City</label>
            <select value={cityId} onChange={(e) => { setCityId(e.target.value); setPage(1); }} className="select-field w-auto text-sm">
              <option value="">All Cities</option>
              {cities.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Currency</label>
            <select value={currency} onChange={(e) => { setCurrency(e.target.value); setPage(1); }} className="select-field w-auto text-sm">
              <option value="">All</option>
              {["PKR", "USD", "AFN", "CNY", "AED"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <GlassButton variant="primary" onClick={() => { setPage(1); load(1); }} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </GlassButton>
          <GlassButton variant="secondary" onClick={() => router.back()}>Back to Trial Balance</GlassButton>
        </div>
      </div>

      {data && (
        <div className="card mb-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-400">Opening Balance</div>
              <div className={`font-medium ${openingBalance >= 0 ? "text-gray-800" : "text-red-600"}`}>
                {openingBalance >= 0 ? `Dr ${n(openingBalance)}` : `Cr ${n(Math.abs(openingBalance))}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Period Entries</div>
              <div className="font-medium">{data.pagination.total}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Closing Balance</div>
              <div className={`font-medium ${data.meta.closingBalance >= 0 ? "text-gray-800" : "text-red-600"}`}>
                {data.meta.closingBalance >= 0 ? `Dr ${n(data.meta.closingBalance)}` : `Cr ${n(Math.abs(data.meta.closingBalance))}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading...</div>
      ) : data && data.data.length > 0 ? (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500">
                  <th className="text-left py-2 pr-2">Date</th>
                  <th className="text-left py-2 pr-2">Transaction</th>
                  <th className="text-left py-2 pr-2">Description</th>
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-left py-2 pr-2">Currency</th>
                  <th className="text-right py-2 px-2">Debit</th>
                  <th className="text-right py-2 px-2">Credit</th>
                  <th className="text-right py-2 pl-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <td colSpan={5} className="py-2 pr-2 text-gray-500 font-medium">Opening Balance</td>
                  <td className="py-2 px-2 text-right">{openingBalance >= 0 ? n(openingBalance) : ""}</td>
                  <td className="py-2 px-2 text-right">{openingBalance < 0 ? n(Math.abs(openingBalance)) : ""}</td>
                  <td className="py-2 pl-2 text-right font-medium">{openingBalance >= 0 ? `Dr ${n(openingBalance)}` : `Cr ${n(Math.abs(openingBalance))}`}</td>
                </tr>
                {data.data.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-2 text-gray-600">{entry.entryDate}</td>
                    <td className="py-1.5 pr-2 text-gray-600 font-mono text-xs">{entry.transactionId}</td>
                    <td className="py-1.5 pr-2 text-gray-800">{entry.description}</td>
                    <td className="py-1.5 pr-2 text-xs">
                      {entry.sourcePath ? (
                        <Link href={entry.sourcePath} className="text-primary-600 hover:underline">
                          {entry.entityType || "-"}
                        </Link>
                      ) : (
                        <span className="text-gray-500">{entry.entityType || "-"}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-gray-600">{entry.currencyCode}</td>
                    <td className="py-1.5 px-2 text-right">{entry.debit > 0 ? n(entry.debit) : ""}</td>
                    <td className="py-1.5 px-2 text-right">{entry.credit > 0 ? n(entry.credit) : ""}</td>
                    <td className={`py-1.5 pl-2 text-right font-medium ${entry.balance >= 0 ? "text-gray-800" : "text-red-600"}`}>
                      {entry.balance >= 0 ? `Dr ${n(entry.balance)}` : `Cr ${n(Math.abs(entry.balance))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <GlassButton variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Previous
              </GlassButton>
              <span className="text-sm text-gray-500 py-1">
                Page {page} of {data.pagination.totalPages}
              </span>
              <GlassButton variant="secondary" onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))} disabled={page >= data.pagination.totalPages}>
                Next
              </GlassButton>
            </div>
          )}
        </>
      ) : data ? (
        <div className="py-12 text-center text-gray-400">No entries found for this account in the selected period.</div>
      ) : null}
    </div>
  );
}
