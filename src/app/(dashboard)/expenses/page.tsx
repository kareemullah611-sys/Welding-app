"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { getPendingQueueId } from "@/lib/queue-resolve";

const EXPENSES_FORM_CACHE_KEY = "mrf-expenses-form-cache-v1";
const EXPENSES_READ_CACHE_KEY = "mrf-expenses-read-cache-v1";

type ExpensesReadSnapshot = {
  expenses: any[];
  totalPages: number;
  total: number;
};

type ExpensesFormCache = {
  lots: any[];
  currencies: any[];
  bankAccounts: any[];
  inHandCheques: any[];
};

function applyQueuedMutationsToExpenses(baseExpenses: any[], queueItems: any[]) {
  if (!Array.isArray(baseExpenses) || !Array.isArray(queueItems) || queueItems.length === 0) return baseExpenses;
  let next = [...baseExpenses];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/expenses/")) continue;
    const match = url.match(/^\/api\/v1\/expenses\/([^/?#]+)/);
    const expenseId = match?.[1];
    if (!expenseId) continue;
    if (method === "DELETE") {
      next = next.filter((item: any) => String(item?.id || "") !== expenseId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((item: any) =>
      String(item?.id || "") === expenseId
        ? {
            ...item,
            expenseDate: patch?.expenseDate ?? item?.expenseDate,
            detail: patch?.detail ?? item?.detail,
            notes: patch?.notes ?? item?.notes,
            amount: patch?.amount ?? item?.amount,
            _pending: true,
          }
        : item
    );
  }
  return next;
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const isAfghanistanCity = user?.role === "city_admin" && user?.countryName === "Afghanistan";
  const { isOnline, enqueue, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, discardQueuedItem, syncQueue } = useOffline();
  const [expenses, setExpenses] = useState<any[]>([]);
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
    expenseDate: new Date().toISOString().split("T")[0],
    amount: 0, detail: "", notes: "", lotId: 0, currencyId: 0,
    paidFrom: "cash_office", bankAccountId: 0, chequePaymentId: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");
  const [prefillHandled, setPrefillHandled] = useState(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);
  const persistExpensesSnapshot = useCallback((nextExpenses: any[], nextTotal = total) => {
    writeOfflineReadSnapshot<ExpensesReadSnapshot>(EXPENSES_READ_CACHE_KEY, {
      expenses: nextExpenses,
      totalPages: totalPages || 1,
      total: nextTotal,
    });
  }, [total, totalPages]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const result = await apiCall("/api/v1/expenses", { params });
    if (result.success) {
      let nextExpenses = (result.data as any[]) || [];
      const pendingExpenses = queuedItems
        .filter((q) => q.pathname === "/expenses" && q.method === "POST" && q.url === "/api/v1/expenses")
        .map((q) => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(q.body || "{}");
          } catch {
            parsed = {};
          }
          return {
            id: `pending-${q.id}`,
            expenseDate: parsed?.expenseDate || new Date().toISOString().split("T")[0],
            detail: parsed?.detail || "",
            amount: Number(parsed?.amount || 0),
            notes: parsed?.notes || "",
            currency: null,
            _pending: true,
          };
        });
      nextExpenses = [...pendingExpenses, ...nextExpenses];
      nextExpenses = applyQueuedMutationsToExpenses(nextExpenses, queuedItems as any[]);
      setExpenses(nextExpenses);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
      writeOfflineReadSnapshot<ExpensesReadSnapshot>(EXPENSES_READ_CACHE_KEY, {
        expenses: nextExpenses,
        totalPages: (result.pagination as any)?.totalPages || 1,
        total: (result.pagination as any)?.total || 0,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<ExpensesReadSnapshot>(EXPENSES_READ_CACHE_KEY)?.data;
      if (snapshot?.expenses?.length) {
        const cleanedExpenses = pruneStalePendingRows(snapshot.expenses as any[], queuedItems as any[], "/expenses");
        const mergedSnapshotExpenses = applyQueuedMutationsToExpenses(cleanedExpenses, queuedItems as any[]);
        setExpenses(mergedSnapshotExpenses);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || mergedSnapshotExpenses.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, page, queuedItems, searchQuery]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    openCreate();
    window.history.replaceState({}, "", isEmbed ? "/expenses?embed=1" : "/expenses");
  }, [prefillHandled, searchParams, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload after queued entries sync
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.synced > 0) load();
  }, [lastSyncResult, load]);

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

  const openCreate = async (preset?: Record<string, any>) => {
    if (!isOnline) {
      const cached = readOfflineFormCache<ExpensesFormCache>(EXPENSES_FORM_CACHE_KEY, [
        "lots",
        "currencies",
        "bankAccounts",
        "inHandCheques",
      ]);
      if (!cached) {
        setFormError(getOfflineFormReadinessError({
          isOnline,
          currencyCount: 0,
          moduleTitle: "Expense",
        }) || "Offline setup missing");
        setShowCreate(true);
        return;
      }
      setLots(cached.lots);
      setCurrencies(cached.currencies);
      setBankAccounts(cached.bankAccounts);
      setInHandCheques(cached.inHandCheques);
      setForm((f: any) => ({
        ...f,
        expenseDate: new Date().toISOString().split("T")[0],
        amount: 0,
        detail: "",
        notes: "",
        lotId: 0,
        currencyId: cached.currencies[0]?.id || 0,
        paidFrom: "cash_office",
        bankAccountId: 0,
        chequePaymentId: 0,
        ...preset,
      }));
      setShowCreate(true);
      setFormError("");
      return;
    }

    const requests: Promise<any>[] = [
      apiCall("/api/v1/lots", { params: { limit: 100, status: "ongoing" } }),
      apiCall("/api/v1/cities"),
    ];
    if (!isAfghanistanCity) {
      requests.push(
        apiCall("/api/v1/bank-accounts"),
        apiCall("/api/v1/payments", {
          params: { all: 1, status: "active", payment_method: "cheque", destination: "our_account", cheque_status: "in_hand" },
        }),
      );
    }
    const [lotRes, cityRes, baRes, chRes] = await Promise.all(requests);
    if (lotRes.success) setLots(lotRes.data as any[]);
    if (cityRes.success && user?.cityId) {
      const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) {
        setCurrencies(city.currencies);
        setForm((f: any) => ({ ...f, currencyId: city.currencies[0].id }));
      }
    }
    if (!isAfghanistanCity && baRes?.success) setBankAccounts(baRes.data as any[]);
    else setBankAccounts([]);
    if (!isAfghanistanCity && chRes?.success) setInHandCheques(chRes.data as any[]);
    else setInHandCheques([]);
    const cachedCurrencies = cityRes.success && user?.cityId
      ? (((cityRes.data as any[]).find((c: any) => c.id === user.cityId)?.currencies) || [])
      : [];
    if (cachedCurrencies.length > 0) {
      writeOfflineFormCache<ExpensesFormCache>(EXPENSES_FORM_CACHE_KEY, {
        lots: lotRes.success ? (lotRes.data as any[]) : [],
        currencies: cachedCurrencies,
        bankAccounts: !isAfghanistanCity && baRes?.success ? (baRes.data as any[]) : [],
        inHandCheques: !isAfghanistanCity && chRes?.success ? (chRes.data as any[]) : [],
      });
    }
    setForm((f: any) => ({
      ...f, expenseDate: new Date().toISOString().split("T")[0],
      amount: 0, detail: "", notes: "", lotId: 0,
      paidFrom: "cash_office", bankAccountId: 0, chequePaymentId: 0,
      ...preset,
    }));
    setShowCreate(true); setFormError("");
  };

  const handleCreate = async () => {
    if (!form.amount || !form.detail) { setFormError(t("amount") + " " + t("and") + " " + t("detail") + " required"); return; }
    if (form.paidFrom === "bank_account" && !form.bankAccountId) { setFormError("Please select a bank account"); return; }
    if (form.paidFrom === "cheque" && !form.chequePaymentId) { setFormError("Please select a cheque"); return; }

    const resolvedCurrencyId = form.currencyId || currencies[0]?.id || 0;
    if (!resolvedCurrencyId) {
      setFormError(getOfflineFormReadinessError({
        isOnline,
        currencyCount: currencies.length,
        moduleTitle: "Expense",
      }) || "Currency setup missing");
      return;
    }

    const createBody: any = {
      ...form,
      lotId: form.lotId || null,
      currencyId: resolvedCurrencyId,
    };
    if (form.paidFrom !== "bank_account") delete createBody.bankAccountId;
    if (form.paidFrom !== "cheque") delete createBody.chequePaymentId;

    if (resolvingQueueId) {
      const updateOk = await updateQueuedItem(resolvingQueueId, { body: JSON.stringify(createBody) });
      if (!updateOk) {
        setFormError("Queued entry was not found. Please retry from Activity.");
        return;
      }
      if (isOnline) {
        await retryQueuedItem(resolvingQueueId);
        await syncQueue();
      }
      setResolvingQueueId(null);
      setShowCreate(false);
      load();
      return;
    }

    // ── Offline: queue and show optimistically ──
    if (!isOnline) {
      const queueId = await enqueue({
        url: "/api/v1/expenses",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
        pathname: "/expenses",
        auditMeta: {
          action: "create",
          entityType: "expense",
          entityLabel: "Expense (Pending)",
          entityDetail: `${form.detail} — ${Number(form.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setExpenses((prev) => {
        const next = [{
        id: `pending-${queueId}`,
        expenseDate: form.expenseDate,
        detail: form.detail,
        amount: form.amount,
        notes: form.notes,
        currency: currencies[0] ?? null,
        _pending: true,
      }, ...prev];
        persistExpensesSnapshot(next, total + 1);
        return next;
      });
      setShowCreate(false);
      return;
    }

    // ── Online: normal submit ──
    setSubmitting(true);
    const result = await apiCall("/api/v1/expenses", { method: "POST", body: createBody });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); if (isEmbed) closeEmbed(); load(); } else { setFormError(result.error || "Failed"); }
  };

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId) return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/expenses");
    if (!target) return;
    try {
      const parsed = JSON.parse(target.body || "{}");
      openCreate(parsed);
      setResolvingQueueId(queueId);
      setFormError("Resolving queued expense. Save to update and re-sync.");
      window.history.replaceState({}, "", isEmbed ? "/expenses?embed=1" : "/expenses");
    } catch {
      // ignore malformed queued payload
    }
  }, [isEmbed, queuedItems, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (e: any) => {
    setSelected(e);
    setForm({
      expenseDate: e.expenseDate, amount: e.amount, detail: e.detail,
      notes: e.notes || "", lotId: 0, currencyId: 0,
      paidFrom: e.paidFrom || "cash_office", bankAccountId: e.bankAccountId || 0, chequePaymentId: e.chequePaymentId || 0,
    });
    setShowEdit(true); setFormError("");
  };

  const handleEdit = async () => {
    const body = { amount: form.amount, detail: form.detail, notes: form.notes };
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(selected?.id);
      if (pendingQueueId) {
        const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(body) });
        if (!ok) {
          setFormError("Queued expense was not found. Please retry from Activity.");
          return;
        }
        setExpenses((prev) => {
          const next = prev.map((exp: any) =>
            exp.id === selected.id ? { ...exp, amount: form.amount, detail: form.detail, notes: form.notes } : exp
          );
          persistExpensesSnapshot(next);
          return next;
        });
        setShowEdit(false);
        return;
      }
      await enqueue({
        url: `/api/v1/expenses/${selected.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/expenses",
        auditMeta: {
          action: "edit",
          entityType: "expense",
          entityLabel: "Expense Edit (Pending)",
          entityDetail: `${form.detail} — ${Number(form.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setExpenses((prev) => {
        const next = prev.map((exp: any) =>
          exp.id === selected.id
            ? { ...exp, amount: form.amount, detail: form.detail, notes: form.notes }
            : exp
        );
        persistExpensesSnapshot(next);
        return next;
      });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/expenses/${selected.id}`, {
      method: "PUT",
      body,
    });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const handleDelete = async (e: any) => {
    if (!confirm(`${t("confirm_delete")} "${e.detail}"?`)) return;
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(e?.id);
      if (pendingQueueId) {
        await discardQueuedItem(pendingQueueId);
        setExpenses((prev) => {
          const next = prev.filter((item: any) => item.id !== e.id);
          persistExpensesSnapshot(next, Math.max(0, total - 1));
          return next;
        });
        return;
      }
      await enqueue({
        url: `/api/v1/expenses/${e.id}`,
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "",
        pathname: "/expenses",
        auditMeta: {
          action: "delete",
          entityType: "expense",
          entityLabel: "Expense Delete (Pending)",
          entityDetail: `${e.detail} — ${Number(e.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setExpenses((prev) => {
        const next = prev.filter((item: any) => item.id !== e.id);
        persistExpensesSnapshot(next, Math.max(0, total - 1));
        return next;
      });
      return;
    }
    await apiCall(`/api/v1/expenses/${e.id}`, { method: "DELETE" });
    load();
  };

  const renderPaidFrom = (e: any) => {
    if (e.paidFrom === "bank_account" && e.bankAccount) {
      return <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">🏦 {e.bankAccount.bankName}</span>;
    }
    if (e.paidFrom === "cheque") {
      return <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">🧾 Cheque in Hand</span>;
    }
    return <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">💵 {t("cash_from_office")}</span>;
  };

  return (
    <div>
      {!isEmbed && <PageHeader
        title={t("expenses")}
        subtitle={`${total} ${t("records").toLowerCase()}`}
      />}
      {!isEmbed && showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached expenses data for this device.
        </div>
      )}

      {!isEmbed && <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        searchPlaceholder="Search expenses (min 2 chars)"
        columns={[
        { key: "expenseDate", label: t("date"), render: (e: any) => formatDate(e.expenseDate) },
        { key: "detail", label: t("detail"), className: "max-w-xs" },
        { key: "amount", label: t("amount"), render: (e: any) => <span className="font-medium text-red-600">{e.currency?.symbol} {e.amount.toLocaleString("en-US")}</span> },
        { key: "lot", label: t("lot"), render: (e: any) => e.lot?.lotNumber || e.lotNumber },
        { key: "notes", label: t("notes"), render: (e: any) => e.notes || "-", className: "max-w-xs truncate" },
        { key: "source", label: t("paid_from"), render: (e: any) => renderPaidFrom(e) },
        {
          key: "actions", label: "",
          render: (e: any) => (
            <div className="relative" onClick={(evt) => evt.stopPropagation()} onMouseDown={(evt) => evt.stopPropagation()} data-action-menu-root="true">
              <button
                type="button"
                onPointerDown={(event) => { event.stopPropagation(); }}
                onClick={(event) => {
                  event.stopPropagation();
                  setActionMenuDirection("down");
                  setOpenActionId((current) => current === e.id ? null : e.id);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-gray-600 hover:bg-gray-100 sm:h-auto sm:w-auto sm:px-2 sm:py-1"
              >
                ⋯
              </button>
              {openActionId === e.id && (
                <div className={`absolute right-0 z-50 w-44 sm:w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                  <button onClick={() => { setOpenActionId(null); openEdit(e); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("edit")}</button>
                  <button onClick={() => { setOpenActionId(null); handleDelete(e); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("delete")}</button>
                </div>
              )}
            </div>
          ),
        },
      ]} data={expenses} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />}

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("record_expense")} size="md" inline={isEmbed}>
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
            <input type="date" value={form.expenseDate} onChange={e => setForm((f: any) => ({ ...f, expenseDate: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
            <input
              type="number"
              value={form.amount || ""}
              onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
              className="input-field"
              readOnly={form.paidFrom === "cheque" && !!form.chequePaymentId}
              onWheel={e => e.currentTarget.blur()}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label>
            <select value={form.lotId} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
              <option value={0}>{t("auto_fifo")}</option>
              {lots.map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

          {/* Paid From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("paid_from")}</label>
            {isAfghanistanCity ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                💵 Cash from Office only for Afghanistan city operations
              </div>
            ) : (
              <select
                value={form.paidFrom}
                onChange={e => setForm((f: any) => ({ ...f, paidFrom: e.target.value, bankAccountId: 0, chequePaymentId: 0 }))}
                className="select-field"
              >
                <option value="cash_office">💵 {t("cash_from_office")}</option>
                <option value="bank_account">🏦 {t("bank_account")}</option>
                <option value="cheque">🧾 {t("cheque")}</option>
              </select>
            )}
          </div>

          {!isAfghanistanCity && form.paidFrom === "bank_account" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("bank_account")} *</label>
              {bankAccounts.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
                  {t("no_bank_accounts")}. Add one in Settings → Bank Accounts.
                </div>
              ) : (
                <select value={form.bankAccountId} onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value) }))} className="select-field">
                  <option value={0}>— Select bank account —</option>
                  {bankAccounts.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!isAfghanistanCity && form.paidFrom === "cheque" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("cheque")} *</label>
              {inHandCheques.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
                  No cheques in hand. Record a cheque payment first.
                </div>
              ) : (
                <select
                  value={form.chequePaymentId || 0}
                  onChange={e => {
                    const id = parseInt(e.target.value);
                    const sel = inHandCheques.find((c: any) => c.id === id);
                    setForm((f: any) => ({
                      ...f,
                      chequePaymentId: id,
                      amount: sel ? Number(sel.amount) : f.amount,
                      currencyId: sel?.currency?.id || f.currencyId,
                    }));
                  }}
                  className="select-field"
                >
                  <option value={0}>— Select a cheque —</option>
                  {inHandCheques.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      #{c.chequeNumber || c.manualVoucherNo || c.id} · {c.customer?.name} · {c.currency?.symbol || c.currency?.code || ""} {Number(c.amount || 0).toLocaleString("en-US")}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record_expense")}</button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_expense")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
          {selected?.paidFrom && (
            <div className="p-2 bg-gray-50 border rounded text-xs text-gray-600">
              Paid from: <strong>{
                selected.paidFrom === "bank_account"
                  ? `🏦 ${selected.bankAccount?.bankName || "Bank"}`
                  : selected.paidFrom === "cheque"
                    ? "🧾 Cheque in Hand"
                    : "💵 Cash from Office"
              }</strong> (cannot change after creation)
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
