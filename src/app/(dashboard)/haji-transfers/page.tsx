"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";
import Link from "next/link";


const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  cash_office:    { label: "Cash from Office", icon: "💵", color: "bg-green-50 text-green-700" },
  cheque:         { label: "Cheque",            icon: "🧾", color: "bg-blue-50 text-blue-700"  },
  bank_transfer:  { label: "Bank Transfer",     icon: "🏦", color: "bg-purple-50 text-purple-700" },
  // legacy
  from_in_hand:   { label: "Cash from Office", icon: "💵", color: "bg-green-50 text-green-700" },
  direct:         { label: "Bank Transfer",     icon: "🏦", color: "bg-purple-50 text-purple-700" },
};

const PAKISTAN_HAJI_TARGET = "Super Admin Account";

export default function HajiTransfersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const shouldUseSuperAdminTarget = user?.role === "city_admin" && user?.countryName === "Pakistan";
  const isAfghanistanCity = user?.role === "city_admin" && user?.countryName === "Afghanistan";
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [inHandCheques, setInHandCheques] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    lotId: 0, transferDate: new Date().toISOString().split("T")[0],
    amount: 0, currencyId: 0, detail: "", sourceType: "cash_office",
    bankAccountId: 0, chequePaymentId: 0, chequePaymentIds: [] as number[], cashAmount: 0, transferredTo: "", notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showSummary, setShowSummary] = useState(true);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");
  const [prefillHandled, setPrefillHandled] = useState(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  const toggleCheque = (id: number) => {
    setForm((f: any) => {
      const nextIds = f.chequePaymentIds.includes(id)
        ? f.chequePaymentIds.filter((v: number) => v !== id)
        : [...f.chequePaymentIds, id];
      return { ...f, chequePaymentIds: nextIds, chequePaymentId: nextIds[0] || 0 };
    });
  };

  const selectedCheques = inHandCheques.filter((c: any) => form.chequePaymentIds.includes(c.id));
  const selectedChequeTotal = selectedCheques.reduce((sum: number, cheque: any) => sum + Number(cheque.amount || 0), 0);
  const mixedSlipTotal = Number(form.cashAmount || 0) + selectedChequeTotal;

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    if (filterFrom) params.date_from = filterFrom;
    if (filterTo) params.date_to = filterTo;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/haji-transfers", { params });
    if (r.success) { setItems(r.data as any[]); setTotalPages((r.pagination as any)?.totalPages || 1); setTotal((r.pagination as any)?.total || 0); }
    setLoading(false);
  }, [page, filterFrom, filterTo, searchQuery]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    openCreate();
    window.history.replaceState({}, "", isEmbed ? "/haji-transfers?embed=1" : "/haji-transfers");
  }, [prefillHandled, searchParams, user?.role]);

  useEffect(() => {
    if (!openActionId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-action-menu-root='true']")) return;
      setOpenActionId(null);
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [openActionId]);

  // Group totals by transferredTo person
  const personTotals = items.reduce((acc: Record<string, Record<string, number>>, tr: any) => {
    const name = tr.transferredTo || "—";
    if (!acc[name]) acc[name] = {};
    const cc = tr.currency?.code || "?";
    acc[name][cc] = (acc[name][cc] || 0) + Number(tr.amount);
    return acc;
  }, {});

  const openCreate = async () => {
    const requests: Promise<any>[] = [
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/cities"),
    ];
    if (!isAfghanistanCity) {
      requests.push(
        apiCall("/api/v1/bank-accounts"),
        apiCall("/api/v1/payments", {
          params: {
            all: 1,
            status: "active",
            payment_method: "cheque",
            destination: "our_account",
            cheque_status: "in_hand",
          },
        }),
      );
    }
    const [lR, cR, baR, chR] = await Promise.all(requests);
    if (lR.success) setLots(lR.data as any[]);
    if (cR.success && user?.cityId) {
      const city = (cR.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { setCurrencies(city.currencies); setForm((f: any) => ({ ...f, currencyId: city.currencies[0].id })); }
    }
    if (!isAfghanistanCity && baR?.success) setBankAccounts(baR.data as any[]);
    else setBankAccounts([]);
    if (!isAfghanistanCity && chR?.success) setInHandCheques(chR.data as any[]);
    else setInHandCheques([]);
    setForm((f: any) => ({
      ...f, transferDate: new Date().toISOString().split("T")[0],
      amount: 0, detail: "", sourceType: "cash_office",
      bankAccountId: 0, chequePaymentId: 0, chequePaymentIds: [], cashAmount: 0, transferredTo: shouldUseSuperAdminTarget ? PAKISTAN_HAJI_TARGET : "", notes: "", lotId: 0,
    }));
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.detail) { setError(t("detail") + " required"); return; }
    if (form.sourceType === "cash_office" && !form.amount) { setError(t("amount") + " required"); return; }
    if (form.sourceType === "cheque" && form.chequePaymentIds.length === 0) { setError("Please select at least one cheque"); return; }
    if (form.sourceType === "mixed_cash_cheque" && !form.cashAmount && form.chequePaymentIds.length === 0) { setError("Enter a cash amount or select at least one cheque"); return; }
    if (form.sourceType === "bank_transfer" && !form.bankAccountId) { setError("Please select a bank account"); return; }

    setSubmitting(true);
    let body: any;
    if (form.sourceType === "mixed_cash_cheque" || form.sourceType === "cheque") {
      body = {
        sourceType: form.sourceType === "cheque" ? "mixed_cash_cheque" : form.sourceType,
        transferDate: form.transferDate,
        detail: form.detail,
        transferredTo: form.transferredTo || undefined,
        notes: form.notes || undefined,
        lotId: form.lotId || undefined,
        currencyId: form.currencyId || undefined,
        cashAmount: form.sourceType === "mixed_cash_cheque" ? Number(form.cashAmount || 0) : 0,
        chequePaymentIds: form.chequePaymentIds,
      };
    } else {
      body = {
        ...form,
        sourceType: form.sourceType,
        transferType: form.sourceType === "cash_office" ? "from_in_hand" : "direct",
      };
      if (!body.lotId) delete body.lotId;
      if (!body.currencyId) delete body.currencyId;
      if (!body.transferredTo) delete body.transferredTo;
      if (body.sourceType !== "bank_transfer") delete body.bankAccountId;
      delete body.chequePaymentIds;
      delete body.cashAmount;
      delete body.chequePaymentId;
      if (body.sourceType === "cash_office") body.amount = Number(form.amount || 0);
    }

    const r = await apiCall("/api/v1/haji-transfers", { method: "POST", body });
    if (r.success) {
      setShowCreate(false); if (isEmbed) closeEmbed(); load();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  const openEdit = (item: any) => {
    setSelected(item);
    // Map legacy transferType → sourceType
    let sourceType = item.sourceType || (
      item.transferType === "direct" ? "bank_transfer" :
      item.transferType === "from_in_hand" ? "cash_office" : "cash_office"
    );
    setForm({
      lotId: item.lotId, transferDate: item.transferDate, amount: item.amount,
      currencyId: item.currencyId || 0, detail: item.detail,
      sourceType, transferType: item.transferType || "from_in_hand",
      bankAccountId: item.bankAccountId || 0, chequePaymentId: item.chequePaymentId || 0,
      transferredTo: item.transferredTo || "", notes: item.notes || "",
    });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const body: any = {
      amount: form.amount, detail: form.detail,
      sourceType: form.sourceType,
      transferType: form.sourceType === "cash_office" ? "from_in_hand" : form.sourceType === "bank_transfer" ? "direct" : "from_in_hand",
      transferredTo: form.transferredTo || null, notes: form.notes,
    };
    if (form.sourceType === "bank_transfer" && form.bankAccountId) body.bankAccountId = form.bankAccountId;
    const r = await apiCall(`/api/v1/haji-transfers/${selected.id}`, { method: "PUT", body });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`${t("confirm_delete")} "${item.detail}"?`)) return;
    await apiCall(`/api/v1/haji-transfers/${item.id}`, { method: "DELETE" });
    load();
  };

  const getSourceType = (tr: any) => tr.sourceType || (tr.transferType === "direct" ? "bank_transfer" : "cash_office");

  if (user?.role === "super_admin" && !isEmbed) {
    return (
      <div>
        <PageHeader
          title={t("haji_transfers")}
          subtitle="Consolidated under Payments for super admin operations"
        />
        <div className="rounded-xl border border-[#e8dccd] bg-[#fbf6ef]/80 p-5">
          <p className="text-sm font-semibold text-[#3a2b1e]">Use Payments as the single settlement module</p>
          <p className="mt-1 text-sm text-[#6d5a47]">
            Super admin incoming settlements from city admins are managed in Payments. This keeps one clean workflow and avoids duplicate modules.
          </p>
          <div className="mt-4">
            <Link href="/payments" className="btn-primary text-sm">
              Open Payments
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!isEmbed && <PageHeader
        title={t("haji_transfers")}
        subtitle={`${total} ${t("records").toLowerCase()}`}
        action={user?.role === "city_admin" ? (
          <div className="flex gap-2 items-center">
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="input-field w-auto text-xs" placeholder="From" />
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="input-field w-auto text-xs" placeholder="To" />
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="input-field w-auto text-xs" />
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="input-field w-auto text-xs" />
          </div>
        )}
      />}

      {/* Person totals summary */}
      {!isEmbed && Object.keys(personTotals).length > 0 && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-blue-800">💸 Transferred To — Summary</p>
            <button onClick={() => setShowSummary(v => !v)} className="text-xs text-blue-600">{showSummary ? "Hide" : "Show"}</button>
          </div>
          {showSummary && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(personTotals).map(([name, totByCurr]) => (
                <div key={name} className="bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-sm">
                  <span className="font-semibold text-blue-800">{name}</span>
                  {Object.entries(totByCurr).map(([cc, amt]) => (
                    <span key={cc} className="ml-2 text-blue-600">{cc} {formatNumber(amt)}</span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isEmbed && <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        searchPlaceholder="Search haji transfers (min 2 chars)"
        columns={[
        { key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) },
        {
          key: "detail", label: t("detail"),
          render: (tr: any) => (
            <div>
              <span>{tr.detail}</span>
              {tr.transferredTo && <p className="text-xs text-blue-600 mt-0.5">→ {tr.transferredTo}</p>}
              {tr.recordType === "customer_payment" && <p className="text-xs text-emerald-600 mt-0.5">Customer payment sent directly to Haji</p>}
            </div>
          ),
        },
        { key: "amount", label: t("amount"), render: (tr: any) => <span className="font-medium text-orange-600">{tr.currency?.symbol || ""} {tr.amount?.toLocaleString("en-US")}</span> },
        {
          key: "sourceType", label: t("type"),
          render: (tr: any) => {
            if (tr.recordType === "customer_payment") {
              return <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-50 text-emerald-700">↗️ Customer to Haji</span>;
            }
            const st = getSourceType(tr);
            const cfg = SOURCE_CONFIG[st] || SOURCE_CONFIG.cash_office;
            return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</span>;
          },
        },
        { key: "lotNumber", label: t("lot"), render: (tr: any) => tr.lot?.lotNumber || tr.lotNumber || "-" },
        {
          key: "actions", label: "",
          render: (tr: any) => (
                <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-action-menu-root="true">
              {(user?.role === "city_admin" || user?.role === "super_admin") && tr.recordType !== "customer_payment" && (
                <>
                  <button
                    type="button"
                    onPointerDown={(event) => { event.stopPropagation(); }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuDirection("down");
                      setOpenActionId((current) => current === tr.id ? null : tr.id);
                    }}
                    className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
                  >
                    ⋯
                  </button>
                  {openActionId === tr.id && (
                    <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                      <button onClick={() => { setOpenActionId(null); openEdit(tr); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("edit")}</button>
                      <button onClick={() => { setOpenActionId(null); handleDelete(tr); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("delete")}</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ),
        },
      ]} data={items} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />}

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("record_haji_transfer")} size="md" inline={isEmbed}>
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
              <input type="date" value={form.transferDate} onChange={e => setForm((f: any) => ({ ...f, transferDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("source_of_funds")} *</label>
              {isAfghanistanCity ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  💵 Cash from Office only for Afghanistan city operations
                </div>
              ) : (
                <select
                  value={form.sourceType}
                  onChange={e => setForm((f: any) => ({
                    ...f,
                    sourceType: e.target.value,
                    chequePaymentId: 0,
                    chequePaymentIds: [],
                    bankAccountId: 0,
                    amount: e.target.value === "cheque" || e.target.value === "mixed_cash_cheque" ? 0 : f.amount,
                    cashAmount: e.target.value === "mixed_cash_cheque" ? f.cashAmount : 0,
                  }))}
                  className="select-field"
                >
                  <option value="cash_office">💵 {t("cash_from_office")}</option>
                  <option value="cheque">🧾 {t("cheque")}</option>
                  <option value="mixed_cash_cheque">💵 + 🧾 Cash + Cheques</option>
                  <option value="bank_transfer">🏦 {t("bank_transfer")}</option>
                </select>
              )}
            </div>
          </div>

          {/* Cheque selector */}
          {!isAfghanistanCity && (form.sourceType === "cheque" || form.sourceType === "mixed_cash_cheque") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("select_cheques")} {form.sourceType === "cheque" ? "*" : ""}</label>
              {inHandCheques.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">No cheques in hand. Record a cheque payment first.</div>
              ) : (
                <div className="max-h-52 overflow-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {inHandCheques.map((c: any) => {
                    const checked = form.chequePaymentIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                        <span className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCheque(c.id)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-gray-800 truncate">
                              #{c.chequeNumber || c.manualVoucherNo || c.id} · {c.customer?.name || "Walk-in Customer"}
                            </span>
                            <span className="block text-xs text-gray-500 truncate">
                              {c.chequeBank || "Bank not set"}{c.chequeDueDate ? ` · Due ${formatDate(c.chequeDueDate)}` : ""}
                            </span>
                          </span>
                        </span>
                        <span className="font-medium text-gray-700 whitespace-nowrap">
                          {c.currency?.symbol || c.currency?.code || ""} {Number(c.amount || 0).toLocaleString("en-US")}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {form.chequePaymentIds.length > 0 && (
                <div className="mt-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                  {form.chequePaymentIds.length} cheque(s) selected · Total {selectedCheques[0]?.currency?.symbol || selectedCheques[0]?.currency?.code || ""} {formatNumber(selectedChequeTotal)}
                </div>
              )}
            </div>
          )}

          {/* Bank account selector */}
          {!isAfghanistanCity && form.sourceType === "bank_transfer" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("bank_account")} *</label>
              {bankAccounts.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">{t("no_bank_accounts")}. Add one in Settings → Bank Accounts.</div>
              ) : (
                <select value={form.bankAccountId || 0} onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value) }))} className="select-field">
                  <option value={0}>— Select bank account —</option>
                  {bankAccounts.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transferred To {shouldUseSuperAdminTarget ? "" : <span className="text-gray-400 font-normal">(optional)</span>}
            </label>
            <input
              value={shouldUseSuperAdminTarget ? PAKISTAN_HAJI_TARGET : form.transferredTo}
              onChange={e => setForm((f: any) => ({ ...f, transferredTo: e.target.value }))}
              className="input-field"
              placeholder={shouldUseSuperAdminTarget ? "" : "Person or account name"}
              readOnly={shouldUseSuperAdminTarget}
            />
            {shouldUseSuperAdminTarget && (
              <p className="mt-1 text-xs text-blue-600">Pakistan city transfers are recorded against the super-admin account automatically.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.sourceType === "mixed_cash_cheque" ? "Cash Amount" : t("amount")} {form.sourceType === "cheque" ? <span className="text-gray-400 font-normal">(auto from cheque)</span> : "*"}
              </label>
              <input
                type="number"
                value={form.sourceType === "mixed_cash_cheque" ? (form.cashAmount || "") : (form.amount || "")}
                onChange={e => setForm((f: any) => form.sourceType === "mixed_cash_cheque"
                  ? ({ ...f, cashAmount: parseFloat(e.target.value) || 0 })
                  : ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                className="input-field"
                readOnly={form.sourceType === "cheque"}
                onWheel={e => e.currentTarget.blur()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label>
              <select value={form.lotId} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("auto_fifo")}</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}
              </select>
            </div>
          </div>

          {!isAfghanistanCity && form.sourceType === "mixed_cash_cheque" && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-700">
              Slip total: {selectedCheques[0]?.currency?.symbol || selectedCheques[0]?.currency?.code || ""} {formatNumber(mixedSlipTotal)}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="p-2 bg-gray-50 border rounded text-xs text-gray-600">
            {t("source_of_funds")}: <strong>{SOURCE_CONFIG[form.sourceType]?.icon} {SOURCE_CONFIG[form.sourceType]?.label || form.sourceType}</strong> (cannot change after creation)
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transferred To</label>
            <input
              value={shouldUseSuperAdminTarget ? PAKISTAN_HAJI_TARGET : form.transferredTo}
              onChange={e => setForm((f: any) => ({ ...f, transferredTo: e.target.value }))}
              className="input-field"
              placeholder="Person or account name"
              readOnly={shouldUseSuperAdminTarget}
            />
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

    </div>
  );
}
