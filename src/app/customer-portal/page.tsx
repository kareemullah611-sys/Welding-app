"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function formatAmount(symbol: string, amount: number) {
  return `${symbol || ""} ${Math.abs(Number(amount || 0)).toLocaleString("en-US")}`;
}

export default function CustomerPortalPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState("");
  const [type, setType] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const loadLedger = async () => {
    setLedgerLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (type !== "all") params.set("ledger_type", type);
    if (fromDate) params.set("date_from", fromDate);
    if (toDate) params.set("date_to", toDate);
    const res = await fetch(`/api/v1/customer-portal/ledger?${params.toString()}`, { credentials: "include", cache: "no-store" });
    const data = await res.json().catch(() => null);
    setLedgerLoading(false);
    if (res.status === 401) {
      router.replace("/customer-portal/login");
      return;
    }
    if (data?.success) {
      setLedgerData(data.data);
      return;
    }
    setError(data?.error?.message || "Unable to load ledger");
  };

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/customer-portal/me", { credentials: "include", cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!data?.success || !data.data) {
        router.replace("/customer-portal/login");
        return;
      }
      setCustomer(data.data);
      setLoading(false);
      await loadLedger();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const balances = useMemo(() => Object.entries(ledgerData?.balanceByCurrency || {}), [ledgerData]);

  const logout = async () => {
    await fetch("/api/v1/customer-portal/logout", { method: "POST", credentials: "include" }).catch(() => null);
    router.replace("/customer-portal/login");
  };

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Loading portal…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Customer Portal</p>
            <h1 className="text-xl font-bold">{customer?.name}</h1>
            <p className="text-sm text-slate-500">{customer?.cityName} · {customer?.countryName}</p>
          </div>
          <button onClick={logout} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            Logout
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances.length > 0 ? balances.map(([code, value]) => {
            const amount = Number(value || 0);
            return (
              <div key={code} className={`rounded-2xl border bg-white p-4 shadow-sm ${amount > 0 ? "border-red-100" : amount < 0 ? "border-emerald-100" : "border-slate-200"}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{code} Balance</p>
                <p className={`mt-2 text-2xl font-bold ${amount > 0 ? "text-red-700" : amount < 0 ? "text-emerald-700" : "text-slate-600"}`}>
                  {amount.toLocaleString("en-US")}
                </p>
              </div>
            );
          }) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Balance</p>
              <p className="mt-2 text-2xl font-bold text-slate-500">Settled</p>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_9rem_9rem_9rem_auto]">
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="all">All</option>
              <option value="sale">Sales</option>
              <option value="payment">Payments</option>
              <option value="opening">Opening</option>
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            <button onClick={() => { setFromDate(""); setToDate(""); setType("all"); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold">Reset</button>
            <button onClick={loadLedger} className="col-span-2 rounded-xl bg-[#6B0F1A] px-4 py-2 text-sm font-bold text-white md:col-span-1">
              {ledgerLoading ? "Loading…" : "Generate"}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Detail</th>
                  <th className="px-4 py-3">Ref</th>
                  <th className="px-4 py-3 text-right">Debit</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(ledgerData?.ledger || []).map((entry: any, index: number) => (
                  <tr key={`${entry.type}-${entry.voucherNo}-${entry.date}-${index}`}>
                    <td className="whitespace-nowrap px-4 py-3">{entry.date}</td>
                    <td className="px-4 py-3 capitalize">{entry.type}</td>
                    <td className="min-w-[14rem] px-4 py-3">{entry.detail}{entry.perCartonPrice && entry.perCartonPrice !== "-" ? ` ${entry.perCartonPrice}` : ""}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{entry.voucherNo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-red-700">{entry.debit ? formatAmount(entry.currencySymbol, entry.debit) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-emerald-700">{entry.credit ? formatAmount(entry.currencySymbol, entry.credit) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">{entry.currencySymbol} {Number(entry.balance || 0).toLocaleString("en-US")}</td>
                  </tr>
                ))}
                {(!ledgerData?.ledger || ledgerData.ledger.length === 0) && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No ledger entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
