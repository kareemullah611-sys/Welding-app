"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, DataTable, Modal, RowActionMenu, formatDate, MobileDateInput } from "@/components/ui";
import { LedgerExportButtons } from "@/components/LedgerExportButtons";
import { GlassButton } from "@/components/ui/GlassButton";
import { apiCall } from "@/hooks/useApi";
import { useLang } from "@/lib/lang";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { formatLedgerMoneyAmount } from "@/lib/city-money-format";
import { Play } from "lucide-react";

const LEDGER_FIELD_LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]";

function balanceTone(balance: number) {
  if (balance > 0) return "border-red-200 bg-red-50 text-red-900";
  if (balance < 0) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-gray-200 bg-white text-gray-600";
}

function ledgerSymbol(entry: any) {
  return String(entry?.currencySymbol || entry?.currency || "").trim();
}

export default function LiabilitiesPage() {
  const { t } = useLang();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showCharge, setShowCharge] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const today = new Date().toISOString().split("T")[0];
  const [entryForm, setEntryForm] = useState<any>({ entryDate: today, amount: "", detail: "", note: "", lotId: 0, currencyId: 0, paymentSource: "cash_office", bankAccountId: 0, chequePaymentId: 0, referenceNo: "" });
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [cheques, setCheques] = useState<any[]>([]);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    if (searchQuery.trim().length >= 2) params.q = searchQuery.trim();
    const result = await apiCall("/api/v1/liabilities", { params });
    if (result.success) {
      setRows((result.data as any[]) || []);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
    }
    setLoading(false);
  }, [page, searchQuery]);

  const loadHelpers = useCallback(async () => {
    const [openingsR, banksR, chequesR] = await Promise.all([
      apiCall("/api/v1/openings"),
      apiCall("/api/v1/bank-accounts"),
      apiCall("/api/v1/payments", { params: { all: 1, status: "active", payment_method: "cheque", destination: "our_account", cheque_status: "in_hand" } }),
    ]);
    if (openingsR.success) {
      setCurrencies((openingsR.data as any)?.currencies || []);
      setLots((openingsR.data as any)?.ongoingLots || []);
    }
    if (banksR.success) setBankAccounts((banksR.data as any[]) || []);
    if (chequesR.success) setCheques((chequesR.data as any[]) || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery]);

  const resetEntryForm = (type: "charge" | "payment") => {
    setEntryForm({
      entryDate: today,
      amount: "",
      detail: "",
      note: "",
      lotId: type === "charge" ? lots[0]?.id || 0 : 0,
      currencyId: currencies[0]?.id || 0,
      paymentSource: "cash_office",
      bankAccountId: 0,
      chequePaymentId: 0,
      referenceNo: "",
    });
    setError("");
  };

  const openCreate = () => { setForm({ name: "", phone: "", notes: "" }); setError(""); setShowCreate(true); };
  const openEdit = (row: any) => { setSelected(row); setForm({ name: row.name || "", phone: row.phone || "", notes: row.notes || "" }); setError(""); setShowEdit(true); };
  const openCharge = async (row: any) => { setSelected(row); await loadHelpers(); resetEntryForm("charge"); setShowCharge(true); };
  const openPayment = async (row: any) => { setSelected(row); await loadHelpers(); resetEntryForm("payment"); setShowPayment(true); };

  const saveAccount = async (mode: "create" | "edit") => {
    if (!form.name.trim()) { setError("Liability name is required"); return; }
    setSubmitting(true);
    const result = await apiCall(mode === "create" ? "/api/v1/liabilities" : `/api/v1/liabilities/${selected.id}`, {
      method: mode === "create" ? "POST" : "PUT",
      body: { ...form, name: form.name.trim() },
    });
    setSubmitting(false);
    if (result.success) {
      setShowCreate(false);
      setShowEdit(false);
      load();
    } else setError(result.error || "Failed");
  };

  const saveEntry = async (entryType: "charge" | "payment") => {
    if (!selected) return;
    setSubmitting(true);
    const body: any = {
      entryType,
      entryDate: entryForm.entryDate,
      amount: Number(entryForm.amount || 0),
      currencyId: Number(entryForm.currencyId || 0),
      detail: entryForm.detail,
      note: entryForm.note,
      referenceNo: entryForm.referenceNo,
    };
    if (entryType === "charge") body.lotId = Number(entryForm.lotId || 0);
    if (entryType === "payment") {
      body.paymentSource = entryForm.paymentSource;
      if (entryForm.paymentSource === "bank_account") body.bankAccountId = Number(entryForm.bankAccountId || 0);
      if (entryForm.paymentSource === "cheque") body.chequePaymentId = Number(entryForm.chequePaymentId || 0);
    }
    const result = await apiCall(`/api/v1/liabilities/${selected.id}/entries`, { method: "POST", body });
    setSubmitting(false);
    if (result.success) {
      setShowCharge(false);
      setShowPayment(false);
      load();
      if (showLedger) loadLedger(selected);
    } else setError(result.error || "Failed");
  };

  const loadLedger = async (row: any, dates?: { from?: string; to?: string }) => {
    setLedgerLoading(true);
    const params: any = {};
    if (dates?.from) params.date_from = dates.from;
    if (dates?.to) params.date_to = dates.to;
    const result = await apiCall(`/api/v1/liabilities/${row.id}`, { params });
    if (result.success) setLedgerData(result.data);
    setLedgerLoading(false);
  };

  const openLedger = async (row: any) => {
    setSelected(row);
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerSearchQuery("");
    setShowLedger(true);
    await loadLedger(row);
  };

  const deactivate = async (row: any) => {
    if (!confirm(`${row.name}: deactivate liability?`)) return;
    await apiCall(`/api/v1/liabilities/${row.id}`, { method: "DELETE" });
    load();
  };

  const columns = useMemo(() => [
    {
      key: "name",
      label: t("name"),
      render: (row: any) => (
        <button onClick={() => openLedger(row)} className="font-medium text-primary-600 hover:underline">{row.name}</button>
      ),
    },
    { key: "phone", label: t("phone"), render: (row: any) => row.phone || "-" },
    {
      key: "balance",
      label: t("balance"),
      render: (row: any) => (
        <div className="space-y-0.5">
          {Object.entries(row.balanceByCurrency || {}).length
            ? Object.entries(row.balanceByCurrency).map(([code, amount]: [string, any]) => (
              <div key={code} className={`font-medium text-sm ${Number(amount) > 0 ? "text-red-600" : Number(amount) < 0 ? "text-green-600" : "text-gray-400"}`}>
                {Number(amount) !== 0 ? `${code} ${Math.abs(Number(amount)).toLocaleString("en-US")}` : `${code} ${t("settled")}`}
              </div>
            ))
            : <span>-</span>}
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (row: any) => (
        <RowActionMenu open={openActionId === row.id} onOpenChange={(open) => setOpenActionId(open ? row.id : null)}>
          <button onClick={() => { setOpenActionId(null); openCharge(row); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">Add charge</button>
          <button onClick={() => { setOpenActionId(null); openPayment(row); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-emerald-700 hover:bg-emerald-50 sm:py-2 sm:text-xs">Record payment</button>
          <button onClick={() => { setOpenActionId(null); openEdit(row); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("edit")}</button>
          {row.isActive ? <button onClick={() => { setOpenActionId(null); deactivate(row); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("deactivate")}</button> : null}
        </RowActionMenu>
      ),
    },
  ], [openActionId, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountFields = (
    <div className="space-y-3">
      <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" /></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("phone")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" /></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Liabilities" action={<button onClick={openCreate} className="btn-primary text-sm">New Liability</button>} />
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
      <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        columns={columns}
        data={rows}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Liability" size="md">
        {accountFields}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => saveAccount("create")} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving…" : t("create")}</button></div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit: ${selected?.name || ""}`} size="md">
        {accountFields}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => saveAccount("edit")} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving…" : t("save")}</button></div>
      </Modal>

      <Modal open={showCharge} onClose={() => setShowCharge(false)} title={`Add charge — ${selected?.name || ""}`} size="md">
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><MobileDateInput variant="field" value={entryForm.entryDate} onChange={(value) => setEntryForm((f: any) => ({ ...f, entryDate: value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label><input value={entryForm.detail} onChange={(e) => setEntryForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" min="0.01" value={entryForm.amount} onChange={(e) => setEntryForm((f: any) => ({ ...f, amount: e.target.value }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Lot *</label><select value={entryForm.lotId} onChange={(e) => setEntryForm((f: any) => ({ ...f, lotId: Number(e.target.value) }))} className="select-field"><option value={0}>Select lot</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label><select value={entryForm.currencyId} onChange={(e) => setEntryForm((f: any) => ({ ...f, currencyId: Number(e.target.value) }))} className="select-field">{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Note</label><input value={entryForm.note} onChange={(e) => setEntryForm((f: any) => ({ ...f, note: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => saveEntry("charge")} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving…" : "Save charge"}</button></div>
      </Modal>

      <Modal open={showPayment} onClose={() => setShowPayment(false)} title={`Record payment — ${selected?.name || ""}`} size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><MobileDateInput variant="field" value={entryForm.entryDate} onChange={(value) => setEntryForm((f: any) => ({ ...f, entryDate: value }))} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">From *</label><select value={entryForm.paymentSource} onChange={(e) => setEntryForm((f: any) => ({ ...f, paymentSource: e.target.value, bankAccountId: 0, chequePaymentId: 0 }))} className="select-field"><option value="cash_office">Cash</option><option value="cheque">Cheque</option><option value="bank_account">Bank Account</option></select></div>
          </div>
          {entryForm.paymentSource === "bank_account" && <div><label className="block text-sm font-medium text-gray-700 mb-1">Bank Account *</label><select value={entryForm.bankAccountId} onChange={(e) => setEntryForm((f: any) => ({ ...f, bankAccountId: Number(e.target.value) }))} className="select-field"><option value={0}>Select bank account</option>{bankAccounts.filter((a) => a.isActive).map((account) => <option key={account.id} value={account.id}>{account.bankName}{account.accountNumber ? ` (${account.accountNumber})` : ""}</option>)}</select></div>}
          {entryForm.paymentSource === "cheque" && <div><label className="block text-sm font-medium text-gray-700 mb-1">Cheque *</label><select value={entryForm.chequePaymentId} onChange={(e) => setEntryForm((f: any) => ({ ...f, chequePaymentId: Number(e.target.value) }))} className="select-field"><option value={0}>Select cheque</option>{cheques.map((cheque) => <option key={cheque.id} value={cheque.id}>{cheque.manualVoucherNo || cheque.chequeNumber || `Cheque #${cheque.id}`} · {cheque.currency?.code || ""} {Number(cheque.amount || 0).toLocaleString("en-US")}</option>)}</select></div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" min="0.01" value={entryForm.amount} onChange={(e) => setEntryForm((f: any) => ({ ...f, amount: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Ref. No.</label><input value={entryForm.referenceNo} onChange={(e) => setEntryForm((f: any) => ({ ...f, referenceNo: e.target.value }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label><select value={entryForm.currencyId} onChange={(e) => setEntryForm((f: any) => ({ ...f, currencyId: Number(e.target.value) }))} className="select-field">{currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}</select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label><input value={entryForm.detail} onChange={(e) => setEntryForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={entryForm.note} onChange={(e) => setEntryForm((f: any) => ({ ...f, note: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => saveEntry("payment")} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving…" : "Save payment"}</button></div>
      </Modal>

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Liability ledger — ${selected?.name || ""}`} size="lg">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d4d4d8] bg-[#f4f4f5]/90 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {ledgerData?.balanceByCurrency && Object.entries(ledgerData.balanceByCurrency).map(([code, amount]: [string, any]) => (
                <div key={code} className={`inline-flex items-baseline gap-2 rounded-lg border px-3 py-1.5 ${balanceTone(Number(amount || 0))}`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{t("balance")}</span>
                  <span className="text-sm font-semibold tabular-nums">{Number(amount) === 0 ? t("settled") : formatLedgerMoneyAmount(Math.abs(Number(amount)), code, code)}</span>
                </div>
              ))}
            </div>
            <LedgerExportButtons type="customer_ledger" customerId={selected?.id} disabled />
          </div>
          <div className="rounded-xl border border-[#ececee] bg-white px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-2">
              <div className="min-w-0 flex-1"><label className={LEDGER_FIELD_LABEL}>Search</label><input value={ledgerSearchQuery} onChange={(e) => setLedgerSearchQuery(e.target.value)} placeholder="Search entries…" className="input-field h-9 w-full text-sm" /></div>
              <div className="shrink-0"><label className={LEDGER_FIELD_LABEL}>{t("from")}</label><MobileDateInput variant="filter" value={ledgerDateFrom} onChange={setLedgerDateFrom} className="w-full sm:w-[9rem]" /></div>
              <div className="shrink-0"><label className={LEDGER_FIELD_LABEL}>{t("to")}</label><MobileDateInput variant="filter" value={ledgerDateTo} onChange={setLedgerDateTo} className="w-full sm:w-[9rem]" /></div>
              <GlassButton type="button" onClick={() => selected && loadLedger(selected, { from: ledgerDateFrom || undefined, to: ledgerDateTo || undefined })} disabled={ledgerLoading || !selected} className="h-9 shrink-0 px-4 text-sm md:self-end"><Play className="h-4 w-4" strokeWidth={2} />{ledgerLoading ? t("loading") : t("generate")}</GlassButton>
            </div>
          </div>
          {ledgerLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" /></div> : (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup><col className="w-[88px]" /><col /><col className="w-[88px]" /><col className="w-[88px]" /><col className="w-[96px]" /></colgroup>
                  <thead><tr className="bg-[#f4f4f5] text-[11px] uppercase tracking-wider text-gray-500"><th className="px-3 py-2 text-left font-semibold">{t("date")}</th><th className="px-3 py-2 text-left font-semibold">{t("detail")}</th><th className="px-3 py-2 text-right font-semibold">{t("debit")}</th><th className="px-3 py-2 text-right font-semibold">{t("credit")}</th><th className="px-3 py-2 text-right font-semibold">{t("balance")}</th></tr></thead>
                  <tbody>
                    {((ledgerData?.ledger || []) as any[]).filter((entry) => {
                      const needle = ledgerSearchQuery.trim().toLowerCase();
                      if (needle.length < 2) return true;
                      return [entry.date, entry.type, entry.detail, entry.referenceNo, entry.currency, entry.lotNumber].some((value) => String(value ?? "").toLowerCase().includes(needle));
                    }).map((entry, index) => {
                      const symbol = ledgerSymbol(entry);
                      return (
                        <tr key={index} className="border-t border-[#e4e4e7] transition-colors hover:bg-[#fafafa]">
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{formatDate(entry.date)}</td>
                          <td className="truncate px-3 py-2 text-gray-800" title={String(entry.detail || "")}>{entry.detail}{entry.lotNumber && entry.lotNumber !== "-" ? ` · Lot ${entry.lotNumber}` : ""}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-700">{entry.debit > 0 ? formatLedgerMoneyAmount(entry.debit, symbol, entry.currency) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{entry.credit > 0 ? formatLedgerMoneyAmount(entry.credit, symbol, entry.currency) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{formatLedgerMoneyAmount(entry.balance, symbol, entry.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
