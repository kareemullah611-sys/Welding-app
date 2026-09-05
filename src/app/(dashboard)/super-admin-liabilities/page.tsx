"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, MobileDateInput, Modal, PageHeader, RowActionMenu, formatDate } from "@/components/ui";
import { apiCall } from "@/hooks/useApi";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";

const today = () => new Date().toISOString().split("T")[0];
const emptyEntry = () => ({ entryType: "loan_received", entryDate: today(), currencyId: 0, amount: "", exchangeRateToPkr: "", rateSource: "", source: "", counterAccountId: 0, reference: "", remarks: "" });

export default function SuperAdminLiabilitiesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [options, setOptions] = useState<any>({ currencies: [], superAdminAccounts: [], intermediaries: [], cities: [], counterAccounts: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [selected, setSelected] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEntry, setShowEntry] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [accountForm, setAccountForm] = useState({ name: "", partyType: "lender", phone: "", address: "", notes: "" });
  const [entryForm, setEntryForm] = useState<any>(emptyEntry());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall("/api/v1/super-admin-liabilities", { params: { page, limit: DEFAULT_LIST_PAGE_SIZE } });
    if (result.success) {
      setRows((result.data as any[]) || []);
      setPagination({ totalPages: (result.pagination as any)?.totalPages || 1, total: (result.pagination as any)?.total || 0 });
    } else setError(result.error || "Unable to load liability accounts");
    setLoading(false);
  }, [page]);

  const loadOptions = useCallback(async () => {
    const result = await apiCall("/api/v1/super-admin-liabilities/options");
    if (result.success) setOptions(result.data || options);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadOptions(); }, [loadOptions]);

  const createAccount = async () => {
    setSubmitting(true); setError("");
    const result = await apiCall("/api/v1/super-admin-liabilities", { method: "POST", body: accountForm });
    setSubmitting(false);
    if (!result.success) return setError(result.error || "Unable to create account");
    setShowCreate(false);
    setAccountForm({ name: "", partyType: "lender", phone: "", address: "", notes: "" });
    load();
  };

  const openEntry = (row: any, type: string) => {
    const firstCurrency = options.currencies?.[0]?.id || 0;
    setSelected(row);
    setEntryForm({ ...emptyEntry(), entryType: type, currencyId: firstCurrency });
    setError("");
    setShowEntry(true);
  };

  const sourcePayload = () => {
    const [sourceType, rawId] = String(entryForm.source || "").split(":");
    const id = Number(rawId || 0);
    if (sourceType === "super_admin_bank") return { sourceType, superAdminBankAccountId: id };
    if (sourceType === "super_admin_cash") return { sourceType, superAdminCashAccountId: id };
    if (sourceType === "intermediary") return { sourceType, intermediaryId: id };
    if (sourceType === "city_bank") {
      const city = options.cities.find((item: any) => item.bankAccounts.some((account: any) => account.id === id));
      return { sourceType, bankAccountId: id, cityId: city?.id || 0 };
    }
    if (sourceType === "city_cash") return { sourceType, cityId: id };
    return {};
  };

  const saveEntry = async () => {
    if (!selected) return;
    setSubmitting(true); setError("");
    const result = await apiCall(`/api/v1/super-admin-liabilities/${selected.id}/entries`, {
      method: "POST",
      body: {
        ...entryForm,
        currencyId: Number(entryForm.currencyId),
        amount: Number(String(entryForm.amount).replaceAll(",", "")),
        exchangeRateToPkr: Number(String(entryForm.exchangeRateToPkr).replaceAll(",", "")),
        counterAccountId: Number(entryForm.counterAccountId || 0),
        ...(entryForm.entryType === "liability_incurred" ? {} : sourcePayload()),
      },
    });
    setSubmitting(false);
    if (!result.success) return setError(result.error || "Unable to record entry");
    setShowEntry(false);
    load();
    if (showLedger) await openLedger(selected);
  };

  const openLedger = async (row: any) => {
    setSelected(row); setShowLedger(true); setLedger(null);
    const result = await apiCall(`/api/v1/super-admin-liabilities/${row.id}/entries`);
    if (result.success) setLedger(result.data);
    else setError(result.error || "Unable to load ledger");
  };

  const reverseEntry = async (entry: any) => {
    const reason = window.prompt("Reason for audited reversal:");
    if (!reason?.trim()) return;
    const result = await apiCall(`/api/v1/super-admin-liability-entries/${entry.id}/reverse`, { method: "POST", body: { reason } });
    if (!result.success) return setError(result.error || "Unable to reverse entry");
    await openLedger(selected);
    load();
  };

  const selectedCurrency = options.currencies.find((item: any) => item.id === Number(entryForm.currencyId));
  const isPkr = selectedCurrency?.code === "PKR";
  const allowedCitySources = selected?.partyType === "creditor";
  const sourceOptions = useMemo(() => [
    ...options.superAdminAccounts.map((account: any) => ({ value: `${account.accountKind === "cash" ? "super_admin_cash" : "super_admin_bank"}:${account.id}`, label: `${account.accountKind === "cash" ? "Cash" : "Bank"} · ${account.bankName} · ${account.currency.code}` })),
    ...options.intermediaries.map((item: any) => ({ value: `intermediary:${item.id}`, label: `Intermediary · ${item.name}` })),
    ...(allowedCitySources ? options.cities.flatMap((city: any) => [
      { value: `city_cash:${city.id}`, label: `City cash · ${city.name}` },
      ...city.bankAccounts.map((account: any) => ({ value: `city_bank:${account.id}`, label: `City bank · ${city.name} · ${account.bankName}` })),
    ]) : []),
  ], [allowedCitySources, options]);

  const columns = [
    { key: "name", label: "Lender / creditor", render: (row: any) => <button className="font-medium text-primary-700 hover:underline" onClick={() => openLedger(row)}>{row.name}<span className="ml-2 text-xs font-normal uppercase text-gray-400">{row.partyType}</span></button> },
    { key: "balances", label: "Outstanding principal", render: (row: any) => <div>{Object.entries(row.balancesByCurrency || {}).map(([code, value]: any) => <div key={code} className={Number(value) < 0 ? "text-amber-700" : "text-gray-800"}>{code} {Number(value).toLocaleString("en-US")}</div>)}</div> },
    { key: "balancePkr", label: "PKR carrying value", render: (row: any) => `PKR ${Number(row.balancePkr || 0).toLocaleString("en-US")}` },
    { key: "actions", label: "", render: (row: any) => <RowActionMenu open={openActionId === row.id} onOpenChange={(open) => setOpenActionId(open ? row.id : null)}>
      {row.partyType === "lender" ? <button className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => { setOpenActionId(null); openEntry(row, "loan_received"); }}>Loan received</button> : <button className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50" onClick={() => { setOpenActionId(null); openEntry(row, "liability_incurred"); }}>Record liability</button>}
      <button className="w-full px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50" onClick={() => { setOpenActionId(null); openEntry(row, "payment"); }}>Record payment</button>
      <button className="w-full px-3 py-2 text-left text-sm text-primary-700 hover:bg-primary-50" onClick={() => { setOpenActionId(null); openLedger(row); }}>View ledger</button>
    </RowActionMenu> },
  ];

  return <div>
    <PageHeader title="Lenders & Other Payables" action={<button className="btn-primary text-sm" onClick={() => { setError(""); setShowCreate(true); }}>New account</button>} />
    {error ? <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
    <DataTable columns={columns} data={rows} loading={loading} pagination={{ page, totalPages: pagination.totalPages, total: pagination.total, onPageChange: setPage }} />

    <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New lender or creditor" size="md">
      <div className="space-y-3">
        <div><label className="mb-1 block text-sm font-medium">Type *</label><select className="select-field" value={accountForm.partyType} onChange={(event) => setAccountForm({ ...accountForm, partyType: event.target.value })}><option value="lender">Lender</option><option value="creditor">Other payable / creditor</option></select></div>
        <div><label className="mb-1 block text-sm font-medium">Name *</label><input className="input-field" value={accountForm.name} onChange={(event) => setAccountForm({ ...accountForm, name: event.target.value })} /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">Phone</label><input className="input-field" value={accountForm.phone} onChange={(event) => setAccountForm({ ...accountForm, phone: event.target.value })} /></div><div><label className="mb-1 block text-sm font-medium">Address</label><input className="input-field" value={accountForm.address} onChange={(event) => setAccountForm({ ...accountForm, address: event.target.value })} /></div></div>
        <div><label className="mb-1 block text-sm font-medium">Notes</label><textarea className="input-field" value={accountForm.notes} onChange={(event) => setAccountForm({ ...accountForm, notes: event.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end border-t pt-4"><button className="btn-primary text-sm" disabled={submitting} onClick={createAccount}>{submitting ? "Saving…" : "Create account"}</button></div>
    </Modal>

    <Modal open={showEntry} onClose={() => setShowEntry(false)} title={`${entryForm.entryType === "payment" ? "Record payment" : entryForm.entryType === "loan_received" ? "Loan received" : "Record liability"} — ${selected?.name || ""}`} size="lg">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="mb-1 block text-sm font-medium">Date *</label><MobileDateInput variant="field" value={entryForm.entryDate} onChange={(value) => setEntryForm({ ...entryForm, entryDate: value })} /></div>
        <div><label className="mb-1 block text-sm font-medium">Currency *</label><select className="select-field" value={entryForm.currencyId} onChange={(event) => setEntryForm({ ...entryForm, currencyId: Number(event.target.value) })}><option value={0}>Select currency</option>{options.currencies.map((item: any) => <option key={item.id} value={item.id}>{item.code}</option>)}</select></div>
        <div><label className="mb-1 block text-sm font-medium">Amount *</label><input className="input-field" inputMode="decimal" value={entryForm.amount} onChange={(event) => setEntryForm({ ...entryForm, amount: event.target.value })} /></div>
        {!isPkr ? <><div><label className="mb-1 block text-sm font-medium">Rate to PKR *</label><input className="input-field" inputMode="decimal" value={entryForm.exchangeRateToPkr} onChange={(event) => setEntryForm({ ...entryForm, exchangeRateToPkr: event.target.value })} /></div><div><label className="mb-1 block text-sm font-medium">Exchange-rate source *</label><input className="input-field" value={entryForm.rateSource} onChange={(event) => setEntryForm({ ...entryForm, rateSource: event.target.value })} /></div></> : null}
        {entryForm.entryType === "liability_incurred" ? <div><label className="mb-1 block text-sm font-medium">Counterpart account *</label><select className="select-field" value={entryForm.counterAccountId} onChange={(event) => setEntryForm({ ...entryForm, counterAccountId: Number(event.target.value) })}><option value={0}>Select account</option>{options.counterAccounts.map((item: any) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div> : <div><label className="mb-1 block text-sm font-medium">{entryForm.entryType === "loan_received" ? "Received into" : "Paid from"} *</label><select className="select-field" value={entryForm.source} onChange={(event) => setEntryForm({ ...entryForm, source: event.target.value })}><option value="">Select source</option>{sourceOptions.map((item: any) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>}
        <div><label className="mb-1 block text-sm font-medium">Reference</label><input className="input-field" value={entryForm.reference} onChange={(event) => setEntryForm({ ...entryForm, reference: event.target.value })} /></div>
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-medium">Remarks</label><textarea className="input-field" value={entryForm.remarks} onChange={(event) => setEntryForm({ ...entryForm, remarks: event.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end border-t pt-4"><button className="btn-primary text-sm" disabled={submitting} onClick={saveEntry}>{submitting ? "Saving…" : "Save entry"}</button></div>
    </Modal>

    <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Principal ledger — ${selected?.name || ""}`} size="xl">
      <div className="mb-3 flex flex-wrap gap-2">{Object.entries(ledger?.balancesByCurrency || {}).map(([code, value]: any) => <div key={code} className="rounded-lg border bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Outstanding </span><strong>{code} {Number(value).toLocaleString("en-US")}</strong></div>)}<div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm"><span className="text-gray-500">Carrying value </span><strong>PKR {Number(ledger?.balancePkr || 0).toLocaleString("en-US")}</strong></div></div>
      <div className="overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">PKR carrying effect</th><th className="px-3 py-2">Realized FX</th><th className="px-3 py-2"></th></tr></thead><tbody>{(ledger?.entries || []).map((entry: any) => <tr key={entry.id} className="border-t"><td className="px-3 py-2">{formatDate(entry.entryDate)}</td><td className="px-3 py-2">{String(entry.entryType).replaceAll("_", " ")}</td><td className="px-3 py-2">{entry.currency.code} {Number(entry.amount).toLocaleString("en-US")}</td><td className="px-3 py-2">PKR {Number(entry.pkrLiabilityEffect).toLocaleString("en-US")}</td><td className={Number(entry.realizedFxPkr) < 0 ? "px-3 py-2 text-red-700" : "px-3 py-2 text-emerald-700"}>{entry.realizedFxPkr ? `PKR ${Number(entry.realizedFxPkr).toLocaleString("en-US")}` : "—"}</td><td className="px-3 py-2 text-right">{!entry.reversedAt && entry.entryType !== "reversal" ? <button className="text-xs text-red-700 hover:underline" onClick={() => reverseEntry(entry)}>Reverse</button> : null}</td></tr>)}</tbody></table></div>
    </Modal>
  </div>;
}
