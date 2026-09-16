"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, MobileDateInput, Modal, PageHeader, RowActionMenu, formatDate } from "@/components/ui";
import { apiCall } from "@/hooks/useApi";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { openSuperAdminTransaction } from "@/lib/superadmin-transactions";

const initialForm = () => ({ transferDate: new Date().toISOString().split("T")[0], sourceAccountId: 0, destinationAccountId: 0, fromAmount: "", exchangeRate: "", rateSource: "", reference: "", notes: "" });

export default function SuperAdminAccountTransfersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [form, setForm] = useState<any>(initialForm());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [transfers, accountResult] = await Promise.all([
      apiCall("/api/v1/super-admin-account-transfers", { params: { page, limit: DEFAULT_LIST_PAGE_SIZE } }),
      apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }),
    ]);
    if (transfers.success) {
      setRows((transfers.data as any[]) || []);
      setPagination({ totalPages: (transfers.pagination as any)?.totalPages || 1, total: (transfers.pagination as any)?.total || 0 });
    } else setError(transfers.error || "Unable to load transfers");
    if (accountResult.success) setAccounts((accountResult.data as any[]) || []);
    setLoading(false);
  }, [page]);
  useEffect(() => { load(); }, [load]);

  const source = accounts.find((item) => item.id === Number(form.sourceAccountId));
  const destination = accounts.find((item) => item.id === Number(form.destinationAccountId));
  const crossCurrency = Boolean(source && destination && source.currencyId !== destination.currencyId);
  const destinationAmount = crossCurrency && Number(form.fromAmount) > 0 && Number(form.exchangeRate) > 0 ? Math.round(Number(form.fromAmount) * Number(form.exchangeRate) * 100) / 100 : Number(form.fromAmount || 0);

  const save = async () => {
    setSubmitting(true); setError("");
    const result = await apiCall("/api/v1/super-admin-account-transfers", { method: "POST", body: { ...form, fromAmount: Number(form.fromAmount), exchangeRate: crossCurrency ? Number(form.exchangeRate) : undefined, toAmount: destinationAmount } });
    setSubmitting(false);
    if (!result.success) return setError(result.error || "Unable to record transfer");
    setShowCreate(false); setForm(initialForm()); load();
  };

  const reverse = async (row: any) => {
    const reason = window.prompt("Reason for audited reversal:");
    if (!reason?.trim()) return;
    const result = await apiCall(`/api/v1/super-admin-account-transfers/${row.id}/reverse`, { method: "POST", body: { reason } });
    if (!result.success) return setError(result.error || "Unable to reverse transfer");
    load();
  };

  const columns = useMemo(() => [
    { key: "transferDate", label: "Date", render: (row: any) => formatDate(row.transferDate) },
    { key: "source", label: "From", render: (row: any) => `${row.sourceAccount.bankName} · ${row.sourceAccount.currency.code}` },
    { key: "destination", label: "To", render: (row: any) => `${row.destinationAccount.bankName} · ${row.destinationAccount.currency.code}` },
    { key: "amount", label: "Transfer", render: (row: any) => <div><div>{row.sourceAccount.currency.code} {Number(row.fromAmount).toLocaleString("en-US")}</div>{row.transferType === "exchange" ? <div className="text-xs text-gray-500">→ {row.destinationAccount.currency.code} {Number(row.toAmount).toLocaleString("en-US")}</div> : null}</div> },
    { key: "reference", label: "Reference", render: (row: any) => row.reference || "—" },
    { key: "actions", label: "", render: (row: any) => <RowActionMenu open={openActionId === row.id} onOpenChange={(open) => setOpenActionId(open ? row.id : null)}><button className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => { setOpenActionId(null); reverse(row); }}>Reverse</button></RowActionMenu> },
  ], [openActionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div>
    <PageHeader title="Account Transfers" action={<button className="btn-primary text-sm" onClick={() => openSuperAdminTransaction({ type: "account_transfer", onSuccess: load })}>New transfer</button>} />
    {error ? <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
    <DataTable columns={columns} data={rows} loading={loading} pagination={{ page, totalPages: pagination.totalPages, total: pagination.total, onPageChange: setPage }} />
    <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Account Transfer" size="lg">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="mb-1 block text-sm font-medium">Date *</label><MobileDateInput variant="field" value={form.transferDate} onChange={(value) => setForm({ ...form, transferDate: value })} /></div>
        <div><label className="mb-1 block text-sm font-medium">Amount *</label><input className="input-field" inputMode="decimal" value={form.fromAmount} onChange={(event) => setForm({ ...form, fromAmount: event.target.value })} /></div>
        <div><label className="mb-1 block text-sm font-medium">From *</label><select className="select-field" value={form.sourceAccountId} onChange={(event) => setForm({ ...form, sourceAccountId: Number(event.target.value) })}><option value={0}>Select source</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.accountKind === "cash" ? "Cash" : "Bank"} · {item.bankName} · {item.currency?.code}</option>)}</select></div>
        <div><label className="mb-1 block text-sm font-medium">To *</label><select className="select-field" value={form.destinationAccountId} onChange={(event) => setForm({ ...form, destinationAccountId: Number(event.target.value) })}><option value={0}>Select destination</option>{accounts.filter((item) => item.id !== Number(form.sourceAccountId)).map((item) => <option key={item.id} value={item.id}>{item.accountKind === "cash" ? "Cash" : "Bank"} · {item.bankName} · {item.currency?.code}</option>)}</select></div>
        {crossCurrency ? <><div><label className="mb-1 block text-sm font-medium">Cross-currency exchange rate *</label><input className="input-field" inputMode="decimal" value={form.exchangeRate} onChange={(event) => setForm({ ...form, exchangeRate: event.target.value })} /></div><div><label className="mb-1 block text-sm font-medium">Exchange-rate source *</label><input className="input-field" value={form.rateSource} onChange={(event) => setForm({ ...form, rateSource: event.target.value })} /></div><div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm sm:col-span-2">Destination receives <strong>{destination?.currency?.code} {destinationAmount.toLocaleString("en-US")}</strong></div></> : null}
        <div><label className="mb-1 block text-sm font-medium">Reference</label><input className="input-field" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></div>
        <div><label className="mb-1 block text-sm font-medium">Notes</label><input className="input-field" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
      </div>
      <div className="mt-4 flex justify-end border-t pt-4"><button className="btn-primary text-sm" disabled={submitting} onClick={save}>{submitting ? "Saving…" : "Record transfer"}</button></div>
    </Modal>
  </div>;
}
