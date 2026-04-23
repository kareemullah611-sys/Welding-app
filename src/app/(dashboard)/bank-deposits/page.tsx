"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, Modal, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function BankDepositsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [inHandCheques, setInHandCheques] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    transferType: "cheque_to_bank",
    bankAccountId: 0, depositDate: new Date().toISOString().split("T")[0],
    destinationBankAccountId: 0,
    slipNumber: "", cashAmount: 0, currencyId: 0, notes: "", chequePaymentIds: [] as number[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const transferTypeLabels: Record<string, string> = {
    cheque_to_bank: "Cash/Cheque → Bank",
    bank_to_cash: "Bank → Cash in Office",
    cheque_to_cash: "Cheque In Hand → Cash in Office",
    bank_to_bank: "Bank A → Bank B",
  };

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/bank-deposits", { params });
    if (r.success) {
      setDeposits(r.data as any[]);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
    }
    setLoading(false);
  }, [page, searchQuery]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery]);

  const openCreate = async () => {
    const [baRes, cityRes, chRes] = await Promise.all([
      apiCall("/api/v1/bank-accounts"),
      apiCall("/api/v1/cities"),
      apiCall("/api/v1/payments", {
        params: { all: 1, status: "active", payment_method: "cheque", destination: "our_account", cheque_status: "in_hand" },
      }),
    ]);
    if (baRes.success) setBankAccounts(baRes.data as any[]);
    if (cityRes.success && user?.cityId) {
      const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) {
        setCurrencies(city.currencies);
        setForm((f: any) => ({ ...f, currencyId: city.currencies[0].id }));
      }
    }
    if (chRes.success) setInHandCheques(chRes.data as any[]);
    setForm((f: any) => ({
      ...f,
      transferType: "cheque_to_bank",
      bankAccountId: 0,
      destinationBankAccountId: 0,
      depositDate: new Date().toISOString().split("T")[0],
      slipNumber: "",
      cashAmount: 0,
      notes: "",
      chequePaymentIds: [],
    }));
    setShowCreate(true); setError("");
  };

  const toggleCheque = (id: number) => {
    setForm((f: any) => ({
      ...f,
      chequePaymentIds: f.chequePaymentIds.includes(id)
        ? f.chequePaymentIds.filter((c: number) => c !== id)
        : [...f.chequePaymentIds, id],
    }));
  };

  const selectedCheques = inHandCheques.filter((c: any) => form.chequePaymentIds.includes(c.id));
  const chequesTotal = selectedCheques.reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);
  const transferPreviewAmount = form.transferType === "cheque_to_cash"
    ? chequesTotal
    : form.transferType === "cheque_to_bank"
    ? Number(form.cashAmount || 0) + chequesTotal
    : Number(form.cashAmount || 0);

  const handleCreate = async () => {
    if (!form.bankAccountId) { setError("Please select a bank account"); return; }
    if (!form.depositDate) { setError("Please select a deposit date"); return; }
    if (!form.currencyId) { setError("Please select a currency"); return; }
    if (form.transferType === "bank_to_cash" && !(Number(form.cashAmount || 0) > 0)) { setError("Please enter a transfer amount"); return; }
    if (form.transferType === "bank_to_bank" && !(Number(form.cashAmount || 0) > 0)) { setError("Please enter a transfer amount"); return; }
    if (form.transferType === "bank_to_bank" && !form.destinationBankAccountId) { setError("Please select destination bank account"); return; }
    if (form.transferType === "bank_to_bank" && Number(form.destinationBankAccountId) === Number(form.bankAccountId)) { setError("Source and destination bank account must be different"); return; }
    if (form.transferType === "cheque_to_cash" && form.chequePaymentIds.length === 0) { setError("Please select at least one cheque"); return; }
    if (form.transferType === "cheque_to_bank" && Number(form.cashAmount || 0) <= 0 && form.chequePaymentIds.length === 0) { setError("Please enter a cash amount or select at least one cheque"); return; }
    setSubmitting(true);
    const body = {
      ...form,
      cashAmount: form.transferType === "cheque_to_cash" ? chequesTotal : Number(form.cashAmount || 0),
    };
    const r = await apiCall("/api/v1/bank-deposits", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  return (
    <div>
      <PageHeader
        title={t("bank_deposits")}
        subtitle={`${total} deposit slips`}
        action={user?.role === "city_admin" ? (
          <button onClick={openCreate} className="btn-primary text-sm">+ New Deposit Slip</button>
        ) : undefined}
      />
      <div className="mb-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="Search slips, bank, cheque, notes (min 2 chars)"
          className="input-field h-9 w-full sm:max-w-md"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : deposits.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">🏦</p>
          <p className="text-sm">No deposit slips yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deposits.map((d: any) => {
            const chequeSum = (d.cheques || []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
            const depTotal = Number(d.cashAmount || 0) + chequeSum;
            const isExpanded = expandedId === d.id;
            return (
              <div key={d.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{d.bankAccount?.bankName || "—"}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{formatDate(d.depositDate)}{d.slipNumber ? ` · Slip #${d.slipNumber}` : ""}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{transferTypeLabels[d.transferType || "cheque_to_bank"] || "Cash/Cheque → Bank"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      {Number(d.cashAmount) > 0 && (
                        <p className="text-xs text-gray-500">Cash: <span className="font-medium">{d.currency?.symbol} {Number(d.cashAmount).toLocaleString("en-US")}</span></p>
                      )}
                      {Number(d.cashAmount) < 0 && (
                        <p className="text-xs text-gray-500">Bank Out: <span className="font-medium">{d.currency?.symbol} {Math.abs(Number(d.cashAmount)).toLocaleString("en-US")}</span></p>
                      )}
                      {d.cheques?.length > 0 && (
                        <p className="text-xs text-gray-500">{d.cheques.length} cheque{d.cheques.length !== 1 ? "s" : ""}: <span className="font-medium">{d.currency?.symbol} {chequeSum.toLocaleString("en-US")}</span></p>
                      )}
                      <p className="text-sm font-bold text-blue-700 mt-0.5">Total: {d.currency?.symbol} {depTotal.toLocaleString("en-US")}</p>
                    </div>
                    {d.cheques?.length > 0 && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : d.id)}
                        className="text-xs text-primary-600 hover:underline whitespace-nowrap"
                      >
                        {isExpanded ? "▲ Hide" : "▼ Cheques"}
                      </button>
                    )}
                  </div>
                </div>
                {d.notes && (
                  <div className="px-4 pb-2 text-xs text-gray-500">{d.notes}</div>
                )}
                {isExpanded && d.cheques?.length > 0 && (
                  <div className="border-t border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="text-xs font-semibold text-blue-700 mb-2">Cheques included:</p>
                    <div className="space-y-1.5">
                      {d.cheques.map((c: any) => (
                        <div key={c.id} className="flex justify-between items-center bg-white rounded-lg px-3 py-2 border border-blue-100 text-sm">
                          <div>
                            <span className="font-mono text-xs text-gray-600">#{c.chequeNumber || "—"}</span>
                            <span className="mx-2 text-gray-300">·</span>
                            <span className="text-gray-700">{c.customer?.name || "—"}</span>
                            {c.chequeBank && <span className="text-xs text-gray-400 ml-1">({c.chequeBank})</span>}
                          </div>
                          <span className="font-medium text-blue-700">{c.currency?.symbol} {Number(c.amount).toLocaleString("en-US")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary text-sm px-3 py-1.5">← Prev</button>
          <span className="text-sm text-gray-500 px-2 py-1.5">Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-secondary text-sm px-3 py-1.5">Next →</button>
        </div>
      )}

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Bank Deposit Slip" size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transfer Type *</label>
              <select
                value={form.transferType}
                onChange={(e) => setForm((f: any) => ({
                  ...f,
                  transferType: e.target.value,
                  chequePaymentIds: [],
                  destinationBankAccountId: 0,
                  cashAmount: 0,
                }))}
                className="select-field"
              >
                <option value="cheque_to_bank">Cash/Cheque → Bank</option>
                <option value="bank_to_cash">Bank → Cash in Office</option>
                <option value="cheque_to_cash">Cheque In Hand → Cash in Office</option>
                <option value="bank_to_bank">Bank A → Bank B</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{form.transferType === "bank_to_bank" ? "Source Bank Account *" : `${t("bank_account")} *`}</label>
              {bankAccounts.length === 0 ? (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">{t("no_bank_accounts")}</div>
              ) : (
                <select value={form.bankAccountId} onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value) }))} className="select-field">
                  <option value={0}>— Select —</option>
                  {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
              <input type="date" value={form.depositDate} onChange={e => setForm((f: any) => ({ ...f, depositDate: e.target.value }))} className="input-field" />
            </div>
          </div>

          {form.transferType === "bank_to_bank" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination Bank Account *</label>
              <select value={form.destinationBankAccountId} onChange={e => setForm((f: any) => ({ ...f, destinationBankAccountId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>— Select —</option>
                {bankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("slip_number")} <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.slipNumber} onChange={e => setForm((f: any) => ({ ...f, slipNumber: e.target.value }))} className="input-field font-mono" placeholder="e.g. DEP-001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency *</label>
              <select value={form.currencyId} onChange={e => setForm((f: any) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>— Select —</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {form.transferType === "bank_to_cash" || form.transferType === "bank_to_bank" ? "Transfer Amount *" : `${t("cash_amount")} ${form.transferType === "cheque_to_bank" ? "(0 if cheques only)" : ""}`}
            </label>
            <input
              type="number"
              min="0"
              value={form.transferType === "cheque_to_cash" ? chequesTotal || "" : form.cashAmount || ""}
              onChange={e => setForm((f: any) => ({ ...f, cashAmount: parseFloat(e.target.value) || 0 }))}
              className="input-field"
              placeholder="0"
              readOnly={form.transferType === "cheque_to_cash"}
              onWheel={e => e.currentTarget.blur()}
            />
          </div>

          {/* Cheque selection */}
          {(form.transferType === "cheque_to_bank" || form.transferType === "cheque_to_cash") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("select_cheques")} <span className="text-gray-400 font-normal">(optional)</span></label>
            {inHandCheques.length === 0 ? (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded text-sm text-gray-500">No cheques currently in hand.</div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {inHandCheques.map((ch: any) => (
                  <label key={ch.id} className={`flex items-center gap-3 px-3 py-2.5 border-b last:border-0 cursor-pointer transition-colors ${form.chequePaymentIds.includes(ch.id) ? "bg-blue-50" : "hover:bg-gray-50"}`}>
                    <input
                      type="checkbox"
                      checked={form.chequePaymentIds.includes(ch.id)}
                      onChange={() => toggleCheque(ch.id)}
                      className="w-4 h-4 text-primary-600"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs text-gray-600">#{ch.raw?.chequeNumber || "—"}</span>
                      <span className="mx-2 text-gray-300">·</span>
                      <span className="text-sm text-gray-700">{ch.person}</span>
                      {ch.raw?.chequeBank && <span className="text-xs text-gray-400 ml-1">({ch.raw.chequeBank})</span>}
                    </div>
                    <span className="font-medium text-sm text-blue-700 whitespace-nowrap">{ch.currencySymbol} {ch.amount?.toLocaleString("en-US")}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Total preview */}
          {transferPreviewAmount > 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              {form.transferType !== "cheque_to_cash" && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Cash</span>
                  <span className="font-medium">{Number(form.cashAmount || 0).toLocaleString("en-US")}</span>
                </div>
              )}
              {selectedCheques.length > 0 && (
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-600">{selectedCheques.length} cheque{selectedCheques.length !== 1 ? "s" : ""}</span>
                  <span className="font-medium">{chequesTotal.toLocaleString("en-US")}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-green-300">
                <span className="text-green-800">Transfer Total</span>
                <span className="text-green-800">{transferPreviewAmount.toLocaleString("en-US")}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")} <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
