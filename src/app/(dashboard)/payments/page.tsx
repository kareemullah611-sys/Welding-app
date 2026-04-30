"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatusBadge, formatDate } from "@/components/ui";
import CustomerSearch from "@/components/CustomerSearch";
import { useLang } from "@/lib/lang";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { useSearchParams } from "next/navigation";


const TYPE_CONFIG: Record<string, { label: string; color: string; amountColor: string }> = {
  payment:      { label: "Payment",    color: "bg-blue-50 text-blue-700",   amountColor: "text-green-700" },
  expense:      { label: "Expense",    color: "bg-red-50 text-red-700",     amountColor: "text-red-600" },
  haji_transfer:{ label: "Haji",       color: "bg-orange-50 text-orange-700", amountColor: "text-orange-600" },
  withdrawal:   { label: "Withdrawal", color: "bg-purple-50 text-purple-700", amountColor: "text-purple-600" },
};

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] || { label: type, color: "bg-gray-50 text-gray-700" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${cfg.color}`}>{cfg.label}</span>;
}

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash", hint: "Quick office receipt" },
  { value: "bank_transfer", label: "Bank Transfer", hint: "Money received in bank" },
  { value: "cheque", label: "Cheque", hint: "Track cheque status" },
  { value: "online", label: "Online", hint: "Digital transfer or wallet" },
];

const DESTINATION_OPTIONS = [
  { value: "our_account", label: "Keep in Office", hint: "Treat as company/office receipt" },
  { value: "haji", label: "Send to Haji", hint: "Counts toward Haji settlement" },
];

const PAYMENTS_FORM_CACHE_KEY = "mrf-payments-form-cache-v1";
const PAYMENTS_READ_CACHE_KEY = "mrf-payments-read-cache-v1";

type PaymentsReadSnapshot = {
  items: any[];
  totalPages: number;
  total: number;
};

type PaymentsFormCache = {
  lots: any[];
  currencies: any[];
  cityBankAccounts: any[];
  superAdminBankAccounts: any[];
};

function formatInputDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentMonthDateRange() {
  const today = new Date();
  return {
    from: formatInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: formatInputDate(today),
  };
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const { isOnline, enqueue, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, discardQueuedItem, syncQueue } = useOffline();
  const canCreateRecords = user?.role === "city_admin";
  const isAfghanistanCity = user?.countryName === "Afghanistan";
  const isSuperAdmin = user?.role === "super_admin";

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const defaultDateRange = getCurrentMonthDateRange();
  const [fromDate, setFromDate] = useState(defaultDateRange.from);
  const [toDate, setToDate] = useState(defaultDateRange.to);
  const [searchQuery, setSearchQuery] = useState("");

  // Type filter for the list
  const [typeFilter, setTypeFilter] = useState("all");
  // Which type is being created/edited
  const [createType, setCreateType] = useState("payment");

  // Modal visibility
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const [selected, setSelected] = useState<any>(null);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [cityBankAccounts, setCityBankAccounts] = useState<any[]>([]);
  const [superAdminBankAccounts, setSuperAdminBankAccounts] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  // Hard delete
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [hardDeleteSubmitting, setHardDeleteSubmitting] = useState(false);

  // Bounce cheque
  const [showBounce, setShowBounce] = useState(false);
  const [bounceTarget, setBounceTarget] = useState<any>(null);
  const [bounceSubmitting, setBounceSubmitting] = useState(false);

  // Voucher duplicate warning
  const [voucherWarning, setVoucherWarning] = useState<{ matches: any[] } | null>(null);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");

  // ── Batch payment queue ──────────────────────────────────────────────────
  const [paymentQueue, setPaymentQueue] = useState<Array<{ tempId: string; customerName: string; voucherNo: string; amount: number; currencySymbol: string; detail: string; date: string; body: any }>>([]);
  const [savingQueue, setSavingQueue] = useState(false);
  const [queueSaved, setQueueSaved] = useState(false);
  const prefillHandledRef = useRef(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  const getActionKey = useCallback((item: any) => `${item.type}-${item.id}`, []);
  const persistPaymentsSnapshot = useCallback((nextItems: any[], nextTotal = total) => {
    writeOfflineReadSnapshot<PaymentsReadSnapshot>(PAYMENTS_READ_CACHE_KEY, {
      items: nextItems,
      totalPages: totalPages || 1,
      total: nextTotal,
    });
  }, [total, totalPages]);

  const getPendingQueueId = useCallback((id: any) => {
    const str = String(id || "");
    if (!str.startsWith("pending-")) return null;
    return str.replace("pending-", "");
  }, []);

  const load = useCallback(async () => {
    if (isEmbed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: any = { page, limit: 20 };
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    if (isSuperAdmin) {
      params.type = "payment";
      params.destination = "haji";
    } else if (typeFilter !== "all") {
      params.type = typeFilter;
    }
    const r = await apiCall("/api/v1/finance/combined", { params });
    if (r.success) {
      let nextItems = (r.data as any[]) || [];
      const pendingEntries = queuedItems
        .filter((q) => q.pathname === "/payments" && q.method === "POST")
        .map((q) => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(q.body || "{}");
          } catch {
            parsed = {};
          }
          const type = q.url === "/api/v1/expenses"
            ? "expense"
            : q.url === "/api/v1/haji-transfers"
              ? "haji_transfer"
              : q.url === "/api/v1/personal-withdrawals"
                ? "withdrawal"
                : "payment";
          return {
            id: `pending-${q.id}`,
            type,
            date: parsed?.paymentDate || parsed?.expenseDate || parsed?.withdrawalDate || parsed?.date || new Date().toISOString(),
            person: parsed?.customerName || parsed?.withdrawnBy || null,
            detail: parsed?.detail || "",
            amount: Number(parsed?.amount || 0),
            status: "active",
            _pending: true,
            raw: parsed,
          };
        })
        .filter((entry) => !isSuperAdmin || entry.type === "payment");
      nextItems = [...pendingEntries, ...nextItems];
      setItems(nextItems);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
      writeOfflineReadSnapshot<PaymentsReadSnapshot>(PAYMENTS_READ_CACHE_KEY, {
        items: nextItems,
        totalPages: (r.pagination as any)?.totalPages || 1,
        total: (r.pagination as any)?.total || 0,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<PaymentsReadSnapshot>(PAYMENTS_READ_CACHE_KEY)?.data;
      if (snapshot?.items?.length) {
        const cleanedItems = pruneStalePendingRows(snapshot.items as any[], queuedItems as any[], "/payments");
        setItems(cleanedItems);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || cleanedItems.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [fromDate, isEmbed, isOnline, isSuperAdmin, page, queuedItems, searchQuery, toDate, typeFilter]);

  const refreshToLatestPayments = useCallback(() => {
    if (page !== 1 || typeFilter !== "all") {
      if (page !== 1) setPage(1);
      if (typeFilter !== "all") setTypeFilter("all");
      return;
    }
    load();
  }, [load, page, typeFilter]);

  useEffect(() => { setPage(1); }, [typeFilter]);
  useEffect(() => { setPage(1); }, [fromDate, toDate]);
  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => { load(); }, [load]);

  // Reload from server after queued entries sync
  // Intentional one-time quickform prefill effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isEmbed) return;
    if (lastSyncResult && lastSyncResult.synced > 0) load();
  }, [isEmbed, lastSyncResult, load]);

  const setDatePreset = (preset: "today" | "last7" | "month" | "all") => {
    const today = new Date();
    if (preset === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
    if (preset === "today") {
      const value = formatInputDate(today);
      setFromDate(value);
      setToDate(value);
      return;
    }
    if (preset === "last7") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      setFromDate(formatInputDate(from));
      setToDate(formatInputDate(today));
      return;
    }
    const range = getCurrentMonthDateRange();
    setFromDate(range.from);
    setToDate(range.to);
  };

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

  const loadHelpers = async () => {
    if (!isOnline) {
      const cached = readOfflineFormCache<PaymentsFormCache>(PAYMENTS_FORM_CACHE_KEY, [
        "lots",
        "currencies",
        "cityBankAccounts",
        "superAdminBankAccounts",
      ]);
      if (!cached) {
        return { loadedCurrencies: [] as any[] };
      }
      setLots(cached.lots);
      setCurrencies(cached.currencies);
      setCityBankAccounts(cached.cityBankAccounts);
      setSuperAdminBankAccounts(cached.superAdminBankAccounts);
      return { loadedCurrencies: cached.currencies };
    }

    const [lR, ciR, cityBanksR, superAdminBanksR] = await Promise.all([
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/cities"),
      apiCall("/api/v1/bank-accounts"),
      apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }),
    ]);
    if (lR.success) setLots(lR.data as any[]);
    if (cityBanksR.success) setCityBankAccounts(cityBanksR.data as any[]);
    if (superAdminBanksR.success) setSuperAdminBankAccounts(superAdminBanksR.data as any[]);
    let loadedCurrencies: any[] = [];
    if (ciR.success && user?.cityId) {
      const city = (ciR.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { loadedCurrencies = city.currencies; setCurrencies(city.currencies); }
    }
    if (loadedCurrencies.length > 0) {
      writeOfflineFormCache<PaymentsFormCache>(PAYMENTS_FORM_CACHE_KEY, {
        lots: lR.success ? (lR.data as any[]) : [],
        currencies: loadedCurrencies,
        cityBankAccounts: cityBanksR.success ? (cityBanksR.data as any[]) : [],
        superAdminBankAccounts: superAdminBanksR.success ? (superAdminBanksR.data as any[]) : [],
      });
    }
    return { loadedCurrencies };
  };

  const openCreate = async (type: string, preset?: Record<string, any>) => {
    setCreateType(type);
    setResolvingQueueId(null);
    const { loadedCurrencies } = await loadHelpers();
    const offlineReadinessError = getOfflineFormReadinessError({
      isOnline,
      currencyCount: loadedCurrencies.length,
      moduleTitle: "Payment",
    });
    if (offlineReadinessError) {
      setError(offlineReadinessError);
      setShowCreate(true);
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    if (type === "payment") {
      setForm({
        customerId: 0,
        customerName: "",
        paymentDate: today,
        amount: 0,
        detail: "",
        currencyId: loadedCurrencies[0]?.id || 0,
        paymentMethod: "cash",
        destination: "our_account",
        notes: "",
        chequeNumber: "",
        chequeBank: "",
        chequeDueDate: "",
        bankAccountId: 0,
        superAdminBankAccountId: 0,
        ...preset,
      });
    } else if (type === "expense") {
      setForm({ expenseDate: today, amount: 0, detail: "", notes: "" });
    } else if (type === "haji_transfer") {
      setForm({ transferDate: today, amount: 0, detail: "", transferType: "from_in_hand", notes: "" });
    } else {
      setForm({ withdrawalDate: today, amount: 0, detail: "", notes: "" });
    }
    setPaymentQueue([]);
    setQueueSaved(false);
    setShowCreate(true); setError("");
  };

  useEffect(() => {
    if (prefillHandledRef.current || !canCreateRecords) return;
    const create = searchParams.get("create");
    const customerId = parseInt(searchParams.get("customer_id") || "0");
    if (create !== "payment" && !customerId) return;
    prefillHandledRef.current = true;
    const customerName = searchParams.get("customer_name") || "";
    openCreate("payment", {
      customerId: Number.isFinite(customerId) ? customerId : 0,
      customerName,
      detail: searchParams.get("detail") || "",
    });
    window.history.replaceState({}, "", isEmbed ? "/payments?embed=1" : "/payments");
  }, [canCreateRecords, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId || !canCreateRecords) return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/payments");
    if (!target) return;
    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(target.body || "{}");
    } catch {
      return;
    }
    const endpoint = target.url;
    const nextType =
      endpoint.includes("/api/v1/expenses")
        ? "expense"
        : endpoint.includes("/api/v1/haji-transfers")
          ? "haji_transfer"
          : endpoint.includes("/api/v1/personal-withdrawals")
            ? "withdrawal"
            : "payment";
    openCreate(nextType, parsedBody);
    setResolvingQueueId(queueId);
    setError("Resolving queued entry. Save to update and re-sync.");
    window.history.replaceState({}, "", isEmbed ? "/payments?embed=1" : "/payments");
  }, [canCreateRecords, isEmbed, queuedItems, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (forceVoucher = false) => {
    setSubmitting(true); setError("");
    const resolvedCurrencyId = form.currencyId || currencies[0]?.id || 0;
    if (!resolvedCurrencyId) {
      setError(getOfflineFormReadinessError({
        isOnline,
        currencyCount: currencies.length,
        moduleTitle: "Payment",
      }) || "Currency setup missing");
      setSubmitting(false);
      return;
    }
    let endpoint = "", body: any = {};
    if (createType === "payment") {
      if (!form.customerId || !(form.amount > 0) || !form.detail) { setError(t("customer") + ", " + t("amount") + " (must be > 0), " + t("detail") + " required"); setSubmitting(false); return; }
      if (!forceVoucher && form.manualVoucherNo?.trim()) {
        const check = await apiCall(`/api/v1/payments/check-voucher?voucher_no=${encodeURIComponent(form.manualVoucherNo.trim())}`);
        if (check.success && (check.data as any).isDuplicate) {
          setVoucherWarning({ matches: (check.data as any).matches });
          setSubmitting(false); return;
        }
      }
      endpoint = "/api/v1/payments";
      body = { ...form, currencyId: resolvedCurrencyId };
    } else if (createType === "expense") {
      if (!(form.amount > 0) || !form.detail) { setError(t("amount") + " (must be > 0) and " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/expenses";
      body = { ...form, currencyId: resolvedCurrencyId };
    } else if (createType === "haji_transfer") {
      if (!(form.amount > 0) || !form.detail) { setError(t("amount") + " (must be > 0) and " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/haji-transfers";
      body = { ...form, currencyId: resolvedCurrencyId };
    } else {
      if (!(form.amount > 0) || !form.detail) { setError(t("amount") + " (must be > 0) and " + t("detail") + " required"); setSubmitting(false); return; }
      endpoint = "/api/v1/personal-withdrawals";
      body = { ...form, currencyId: resolvedCurrencyId };
    }
    // ── Offline: queue and optimistically add to list ──
    if (resolvingQueueId) {
      const updateOk = await updateQueuedItem(resolvingQueueId, {
        body: JSON.stringify(body),
      });
      if (!updateOk) {
        setError("Queued entry was not found. Please retry from Activity.");
        setSubmitting(false);
        return;
      }
      if (isOnline) {
        await retryQueuedItem(resolvingQueueId);
        await syncQueue();
      }
      setShowCreate(false);
      setResolvingQueueId(null);
      setSubmitting(false);
      load();
      return;
    }

    if (!isOnline) {
      const entityType = createType === "payment" ? "payment" : createType;
      const queueId = await enqueue({
        url: endpoint,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/payments",
        auditMeta: {
          action: "create",
          entityType,
          entityLabel: `${createType.replace("_", " ")} (Pending)`,
          entityDetail: `${(body as any).customerName || (body as any).detail || "Entry"} — ${Number((body as any).amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => {
        const next = [{
        id: `pending-${queueId}`,
        type: createType,
        paymentDate: (body as any).paymentDate || new Date().toISOString().split("T")[0],
        amount: (body as any).amount || 0,
        detail: (body as any).detail || "",
        status: "active",
        _pending: true,
      }, ...prev];
        persistPaymentsSnapshot(next, total + 1);
        return next;
      });
      setShowCreate(false);
      setResolvingQueueId(null);
      setSubmitting(false);
      return;
    }

    // ── Online: normal submit ──
    const r = await apiCall(endpoint, { method: "POST", body });
    if (r.success) {
      setShowCreate(false);
      setResolvingQueueId(null);
      if (isEmbed) closeEmbed();
      refreshToLatestPayments();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  // ── Add current form to batch queue (payment only) ──────────────────────
  const addToQueue = async () => {
    setError("");
    if (!form.customerId || !(form.amount > 0) || !form.detail) {
      setError(t("customer") + ", amount (must be > 0), detail required");
      return;
    }
    // Voucher duplicate check
    if (form.manualVoucherNo?.trim()) {
      const check = await apiCall(`/api/v1/payments/check-voucher?voucher_no=${encodeURIComponent(form.manualVoucherNo.trim())}`);
      if (check.success && (check.data as any).isDuplicate) {
        setVoucherWarning({ matches: (check.data as any).matches });
        return;
      }
    }
    const selectedCur = currencies.find((c: any) => c.id === form.currencyId);
    const body = { ...form, currencyId: form.currencyId || currencies[0]?.id };
    setPaymentQueue(prev => [...prev, {
      tempId: `q-${Date.now()}-${Math.random()}`,
      customerName: form.customerName || "Customer",
      voucherNo: form.manualVoucherNo?.trim() || "",
      amount: form.amount,
      currencySymbol: selectedCur?.symbol ?? "",
      detail: form.detail,
      date: form.paymentDate,
      body,
    }]);
    // Reset form for next entry, keep modal open
    const today = new Date().toISOString().split("T")[0];
    setForm({ customerId: 0, customerName: "", paymentDate: today, amount: 0, detail: "", currencyId: currencies[0]?.id || 0, paymentMethod: "cash", destination: "our_account", notes: "", chequeNumber: "", chequeBank: "", chequeDueDate: "", bankAccountId: 0, superAdminBankAccountId: 0 });
    setQueueSaved(false);
  };

  // ── Save all queued payments ─────────────────────────────────────────────
  const saveQueue = async () => {
    if (paymentQueue.length === 0) return;
    setSavingQueue(true);
    const failed: typeof paymentQueue = [];
    for (const item of paymentQueue) {
      const result = await apiCall("/api/v1/payments", { method: "POST", body: item.body });
      if (!result.success) failed.push(item);
    }
    setSavingQueue(false);
    setPaymentQueue(failed);
    if (failed.length === 0) {
      setQueueSaved(true);
      setShowCreate(false);
      if (isEmbed) closeEmbed();
      setTimeout(() => setQueueSaved(false), 3000);
    } else {
      setError(`${failed.length} queued payment(s) failed. Please review and save again.`);
    }
    refreshToLatestPayments();
  };

  const openEdit = async (item: any) => {
    setCreateType(item.type);
    setSelected(item);
    await loadHelpers();
    const raw = item.raw;
    if (item.type === "payment") {
      setForm({ amount: raw.amount, detail: raw.detail, notes: raw.notes || "" });
    } else if (item.type === "haji_transfer") {
      setForm({ amount: raw.amount, detail: raw.detail, transferType: raw.transferType || "from_in_hand", notes: raw.notes || "" });
    } else {
      setForm({ amount: raw.amount, detail: raw.detail, notes: raw.notes || "" });
    }
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    const id = selected.id;
    const endpoint = createType === "payment" ? `/api/v1/payments/${id}` : createType === "expense" ? `/api/v1/expenses/${id}` : createType === "haji_transfer" ? `/api/v1/haji-transfers/${id}` : `/api/v1/personal-withdrawals/${id}`;
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(id);
      if (pendingQueueId) {
        const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(form) });
        if (!ok) {
          setError("Queued entry was not found. Please retry from Activity.");
          return;
        }
        setItems((prev) => {
          const next = prev.map((item: any) =>
            item.id === id
              ? {
                  ...item,
                  amount: form.amount ?? item.amount,
                  detail: form.detail ?? item.detail,
                  _pending: true,
                  raw: { ...(item.raw || {}), ...form },
                }
              : item
          );
          persistPaymentsSnapshot(next);
          return next;
        });
        setShowEdit(false);
        return;
      }
      await enqueue({
        url: endpoint,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        pathname: "/payments",
        auditMeta: {
          action: "edit",
          entityType: createType,
          entityLabel: `${createType.replace("_", " ")} edit (Pending)`,
          entityDetail: `${form.detail || selected?.detail || "Entry"} — ${Number(form.amount || selected?.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => {
        const next = prev.map((item: any) =>
          item.id === id
            ? {
                ...item,
                amount: form.amount ?? item.amount,
                detail: form.detail ?? item.detail,
                _pending: true,
                raw: { ...(item.raw || {}), ...form },
              }
            : item
        );
        persistPaymentsSnapshot(next);
        return next;
      });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const r = await apiCall(endpoint, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openHardDelete = (item: any) => { setHardDeleteTarget(item); setHardDeletePassword(""); setHardDeleteError(""); setShowHardDelete(true); };
  const handleHardDelete = async () => {
    if (!hardDeletePassword.trim()) { setHardDeleteError(t("password_required")); return; }
    if (getPendingQueueId(hardDeleteTarget?.id)) {
      setHardDeleteError("Pending payment is not synced yet. Use Cancel to remove it locally.");
      return;
    }
    setHardDeleteSubmitting(true);
    const result = await apiCall(`/api/v1/payments/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setHardDeleteSubmitting(false);
    if (result.success) { setShowHardDelete(false); load(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  const handleDelete = async (item: any) => {
    const typeLabel = TYPE_CONFIG[item.type]?.label || item.type;
    const reason = window.prompt(`Cancel / Delete reason (${typeLabel}):`);
    if (reason === null) return;
    if (!reason.trim()) { alert(t("reason_required")); return; }
    const endpoint = item.type === "payment" ? `/api/v1/payments/${item.id}/cancel` : item.type === "expense" ? `/api/v1/expenses/${item.id}` : item.type === "haji_transfer" ? `/api/v1/haji-transfers/${item.id}` : `/api/v1/personal-withdrawals/${item.id}`;
    const method = item.type === "payment" ? "PUT" : "DELETE";
    const body = item.type === "payment" ? { reason: reason.trim() } : undefined;
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(item?.id);
      if (pendingQueueId) {
        await discardQueuedItem(pendingQueueId);
        setItems((prev) => {
          const next = prev.filter((row: any) => row.id !== item.id);
          persistPaymentsSnapshot(next);
          return next;
        });
        return;
      }
      await enqueue({
        url: endpoint,
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "",
        pathname: "/payments",
        auditMeta: {
          action: item.type === "payment" ? "cancel" : "delete",
          entityType: item.type,
          entityLabel: `${typeLabel} ${item.type === "payment" ? "cancel" : "delete"} (Pending)`,
          entityDetail: `${item.detail || item.person || typeLabel} — ${Number(item.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => {
        const next = prev
          .map((row: any) =>
            row.id === item.id
              ? item.type === "payment"
                ? {
                    ...row,
                    status: "cancelled",
                    _pending: true,
                    raw: { ...(row.raw || {}), cancellationReason: reason.trim() },
                  }
                : null
              : row
          )
          .filter(Boolean) as any[];
        persistPaymentsSnapshot(next);
        return next;
      });
      return;
    }
    await apiCall(endpoint, { method, body });
    load();
  };

  const handleApproveWithdrawal = async (item: any) => {
    if (!window.confirm("Approve this withdrawal? This will create a Haji Transfer.")) return;
    if (!isOnline) {
      if (getPendingQueueId(item?.id)) {
        alert("Sync this pending withdrawal first, then approve it.");
        return;
      }
      await enqueue({
        url: `/api/v1/personal-withdrawals/${item.id}/approve`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
        pathname: "/payments",
        auditMeta: {
          action: "approve",
          entityType: "withdrawal",
          entityLabel: "Withdrawal approval (Pending)",
          entityDetail: `${item.person || item.detail || "Withdrawal"} — ${Number(item.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => {
        const next = prev.map((row: any) =>
          row.id === item.id
            ? { ...row, status: "approved", _pending: true, raw: { ...(row.raw || {}), status: "approved" } }
            : row
        );
        persistPaymentsSnapshot(next);
        return next;
      });
      return;
    }
    await apiCall(`/api/v1/personal-withdrawals/${item.id}/approve`, { method: "POST" });
    load();
  };

  const handleBounce = async () => {
    if (!bounceTarget) return;
    if (!isOnline) {
      if (getPendingQueueId(bounceTarget?.id)) {
        setError("Sync this pending payment first, then mark cheque as bounced.");
        return;
      }
      await enqueue({
        url: `/api/v1/payments/${bounceTarget.id}`,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bounce_cheque" }),
        pathname: "/payments",
        auditMeta: {
          action: "bounce",
          entityType: "payment",
          entityLabel: "Cheque bounce (Pending)",
          entityDetail: `${bounceTarget.detail || "Payment"} — ${Number(bounceTarget.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => {
        const next = prev.map((row: any) =>
          row.id === bounceTarget.id
            ? { ...row, _pending: true, raw: { ...(row.raw || {}), chequeStatus: "bounced" } }
            : row
        );
        persistPaymentsSnapshot(next);
        return next;
      });
      setShowBounce(false);
      setBounceTarget(null);
      return;
    }
    setBounceSubmitting(true);
    const r = await apiCall(`/api/v1/payments/${bounceTarget.id}`, { method: "PATCH", body: { action: "bounce_cheque" } });
    setBounceSubmitting(false);
    if (r.success) { setShowBounce(false); setBounceTarget(null); load(); }
    else { setError(r.error || "Failed to mark cheque as bounced"); }
  };

  const handleToggleHajiAudit = async (item: any, confirmed: boolean) => {
    if (!isOnline) {
      if (getPendingQueueId(item?.id)) {
        setError("Sync this pending payment first, then update haji audit confirmation.");
        return;
      }
      await enqueue({
        url: `/api/v1/payments/${item.id}`,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_haji_audit", confirmed }),
        pathname: "/payments",
        auditMeta: {
          action: "audit_toggle",
          entityType: "payment",
          entityLabel: "Haji audit toggle (Pending)",
          entityDetail: `${item.detail || "Payment"} — ${confirmed ? "confirmed" : "unconfirmed"}`,
        },
      });
      setItems((prev) => {
        const next = prev.map((row: any) =>
          row.id === item.id
            ? {
                ...row,
                _pending: true,
                raw: {
                  ...(row.raw || {}),
                  hajiAudit: { ...(row.raw?.hajiAudit || {}), confirmed },
                },
              }
            : row
        );
        persistPaymentsSnapshot(next);
        return next;
      });
      return;
    }
    const r = await apiCall(`/api/v1/payments/${item.id}`, {
      method: "PATCH",
      body: { action: "set_haji_audit", confirmed },
    });
    if (r.success) load();
    else setError(r.error || "Failed to update audit confirmation");
  };

  const columns = [
    {
      key: "date", label: t("date"),
      render: (item: any) => <span className="whitespace-nowrap text-sm">{formatDate(item.date)}</span>,
    },
    ...(!isSuperAdmin ? [{
      key: "type", label: "Type",
      render: (item: any) => <TypeBadge type={item.type} />,
    }] : []),
    {
      key: "person", label: "Name",
      render: (item: any) => item.person ? (
        <div>
          <span className="text-sm text-gray-700">{item.person}</span>
          {user?.role === "super_admin" && item.cityName && (
            <p className="text-xs text-indigo-500 mt-0.5">{item.cityName}</p>
          )}
        </div>
      ) : <span className="text-gray-300">—</span>,
    },
    {
      key: "detail", label: t("detail"),
      render: (item: any) => (
        <div>
          <span className="text-sm">{item.detail}</span>
          {item.type === "haji_transfer" && item.raw?.lotNumber && <p className="text-xs text-gray-400 mt-0.5">Lot {item.raw.lotNumber}</p>}
          {item.type === "expense" && item.raw?.lotNumber && <p className="text-xs text-gray-400 mt-0.5">Lot {item.raw.lotNumber}</p>}
        </div>
      ),
    },
    {
      key: "ref", label: "Ref No.",
      render: (item: any) => item.raw?.manualVoucherNo ? (
        <span className="font-mono text-xs text-gray-600">{item.raw.manualVoucherNo}</span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
    },
    {
      key: "amount", label: t("amount"),
      render: (item: any) => {
        const cfg = TYPE_CONFIG[item.type];
        return (
          <div>
            <span className={`font-semibold text-sm ${cfg?.amountColor || "text-gray-700"}`}>
              {item.currencySymbol} {item.amount?.toLocaleString("en-US")}
            </span>
            {item.type === "payment" && item.raw?.currencyCode === "AFN" && item.raw?.usdEquivalent && (
              <p className="text-xs text-gray-400 mt-0.5">≈ ${Number(item.raw.usdEquivalent).toLocaleString("en-US")}</p>
            )}
          </div>
        );
      },
    },
    {
      key: "status", label: t("status"),
      render: (item: any) => {
        if (item.type === "payment") {
          const chequeStatusColors: Record<string, string> = {
            in_hand: "bg-yellow-50 text-yellow-700",
            deposited_to_bank: "bg-blue-50 text-blue-700",
            sent_to_haji: "bg-green-50 text-green-700",
            bounced: "bg-red-50 text-red-700",
          };
          const chequeStatusLabels: Record<string, string> = {
            in_hand: t("in_hand_status"),
            deposited_to_bank: t("deposited_to_bank"),
            sent_to_haji: t("sent_to_haji_status"),
            bounced: t("bounced"),
          };
          return (
            <div>
              <StatusBadge status={item.status} />
              {item.status === "cancelled" && item.raw?.cancellationReason && (
                <p className="text-xs text-gray-400 mt-0.5 max-w-[120px] truncate" title={item.raw.cancellationReason}>{item.raw.cancellationReason}</p>
              )}
          {item.raw?.chequeStatus && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${chequeStatusColors[item.raw.chequeStatus] || "bg-gray-50 text-gray-700"}`}>
                  🧾 {chequeStatusLabels[item.raw.chequeStatus] || item.raw.chequeStatus}
                </span>
              )}
              {item.raw?.hajiAudit?.confirmed && (
                <span className="text-xs px-1.5 py-0.5 rounded font-medium mt-1 inline-block bg-emerald-50 text-emerald-700">
                  ✓ Haji audit confirmed
                </span>
              )}
            </div>
          );
        }
        if (item.type === "withdrawal") return (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${item.status === "approved" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}`}>
            {item.status}
          </span>
        );
        return <span className="text-gray-300">—</span>;
      },
    },
    ...(user?.role === "super_admin" ? [{
      key: "sa_check", label: "SA Check",
      render: (item: any) => (
        item.type === "payment" && item.status === "active" && item.raw?.destination === "haji" && ["cash", "bank_transfer", "online"].includes(item.raw?.paymentMethod) ? (
          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={!!item.raw?.hajiAudit?.confirmed}
              onChange={(e) => handleToggleHajiAudit(item, e.target.checked)}
              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            Confirm
          </label>
        ) : <span className="text-gray-300">—</span>
      ),
    }] : []),
    {
      key: "runningBalance",
      label: "Running Balance",
      render: (item: any) => (
        <span className="text-sm font-medium text-gray-700">
          {item.currencyCode} {Number(item.runningBalance || 0).toLocaleString("en-US")}
        </span>
      ),
    },
    {
      key: "actions", label: "",
      render: (item: any) => {
        return (
          <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-action-menu-root="true">
            <button
              type="button"
              onPointerDown={(event) => { event.stopPropagation(); }}
              onClick={(event) => {
                event.stopPropagation();
                setActionMenuDirection("down");
                const actionKey = getActionKey(item);
                setOpenActionId((current) => current === actionKey ? null : actionKey);
              }}
              aria-label="Open actions"
              className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
            >
              ⋯
            </button>
            {openActionId === getActionKey(item) && (
              <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                <button onClick={() => { setOpenActionId(null); openEdit(item); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("edit")}</button>
                {item.type === "payment" && item.status === "active" && (
                  <button onClick={() => { setOpenActionId(null); handleDelete(item); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("cancel")}</button>
                )}
                {item.type !== "payment" && (
                  <button onClick={() => { setOpenActionId(null); handleDelete(item); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("delete")}</button>
                )}
                {item.type === "payment" && user?.role === "super_admin" && !getPendingQueueId(item?.id) && (
                  <button onClick={() => { setOpenActionId(null); openHardDelete(item); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-800 hover:bg-red-50">{t("hard_delete")}</button>
                )}
                {item.type === "withdrawal" && item.status === "pending" && user?.role === "super_admin" && (
                  <button onClick={() => { setOpenActionId(null); handleApproveWithdrawal(item); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-green-700 hover:bg-green-50">Approve</button>
                )}
                {item.type === "payment" && item.status === "active" && item.raw?.paymentMethod === "cheque" && item.raw?.chequeStatus === "in_hand" && (
                  <button onClick={() => { setOpenActionId(null); setBounceTarget(item); setShowBounce(true); setError(""); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-amber-700 hover:bg-amber-50">{t("mark_bounced")}</button>
                )}
              </div>
            )}
          </div>
        );
      },
    },
  ];

  const createTitle =
    createType === "payment" ? t("new_payment_title") :
    createType === "expense" ? t("new_expense_title") :
    createType === "haji_transfer" ? t("new_haji_title") :
    t("new_withdrawal_title");

  const selectedMethod = PAYMENT_METHOD_OPTIONS.find((option) => option.value === form.paymentMethod);
  const selectedDestination = DESTINATION_OPTIONS.find((option) => option.value === form.destination);
  const needsBankAccountSelection = createType === "payment" && ["bank_transfer", "online"].includes(form.paymentMethod);
  const showCityBankAccountSelect = needsBankAccountSelection && form.destination === "our_account";
  const showSuperAdminBankAccountSelect = needsBankAccountSelection && form.destination === "haji";

  return (
    <div>
      {!isEmbed && <PageHeader
        title={isSuperAdmin ? "Payments" : t("payments")}
        subtitle={isSuperAdmin ? `City settlements received by super admin · ${total} ${t("records").toLowerCase()}` : `${total} ${t("records").toLowerCase()}`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all columns (min 2 chars)..."
              className="input-field min-w-[220px] text-xs"
            />
            {/* Type filter */}
            {!isSuperAdmin && (
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="select-field text-sm py-1.5 pr-8"
              >
                <option value="all">All Types</option>
                <option value="payment">Payments</option>
                <option value="expense">Expenses</option>
                <option value="haji_transfer">Haji Transfers</option>
                <option value="withdrawal">Withdrawals</option>
              </select>
            )}
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="input-field w-auto text-xs"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="input-field w-auto text-xs"
            />
            <button type="button" onClick={() => setDatePreset("today")} className="btn-secondary text-xs">Today</button>
            <button type="button" onClick={() => setDatePreset("last7")} className="btn-secondary text-xs">7D</button>
            <button type="button" onClick={() => setDatePreset("month")} className="btn-secondary text-xs">Month</button>
            <button type="button" onClick={() => setDatePreset("all")} className="btn-secondary text-xs">All</button>

          </div>
        }
      />}
      {!isEmbed && showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached payments data for this device.
        </div>
      )}

      {!isEmbed && queueSaved && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          ✓ All payments saved successfully!
        </div>
      )}

      {!isEmbed && <DataTable
        searchable={false}
        columns={columns}
        data={items}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />}

      {/* ── CREATE MODAL ───────────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={createTitle} size="md" inline={isEmbed}>
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {/* ── DATE — always first ── */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
            <input type="date"
              value={form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || ""}
              onChange={e => {
                const d = e.target.value;
                setForm((f: any) => ({ ...f, paymentDate: d, expenseDate: d, transferDate: d, withdrawalDate: d }));
              }}
              className="input-field"
              autoFocus
            />
          </div>

          {createType === "payment" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("customer")} *</label>
              <CustomerSearch
                value={form.customerId || 0}
                onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
                placeholder={t("search_customer")}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field"
              onKeyDown={e => { if (e.key === "Enter") { if (createType === "payment") addToQueue(); else handleCreate(); } }} />
          </div>

          {currencies.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
              <select value={form.currencyId || 0} onChange={e => setForm((f: any) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} ({c.symbol})</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
            <input type="number" min="0.01" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field"
              onKeyDown={e => { if (e.key === "Enter") { if (createType === "payment") addToQueue(); else handleCreate(); } }}
              onWheel={e => e.currentTarget.blur()} />
          </div>

          {createType === "payment" && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">How was the payment received?</label>
                {!isAfghanistanCity ? (
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setForm((f: any) => ({ ...f, paymentMethod: option.value, bankAccountId: 0, superAdminBankAccountId: 0 }))}
                        className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                          form.paymentMethod === option.value
                            ? "border-primary-500 bg-white shadow-sm"
                            : "border-gray-200 bg-white hover:border-primary-300"
                        }`}
                      >
                        <div className="text-sm font-semibold text-gray-900">{option.label}</div>
                        <div className="mt-1 text-xs text-gray-500">{option.hint}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
                    <div className="font-semibold text-gray-900">Cash</div>
                    <div className="mt-1 text-xs text-gray-500">Afghanistan city operations are cash-only.</div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Where should this payment go?</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DESTINATION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setForm((f: any) => ({ ...f, destination: option.value, bankAccountId: 0, superAdminBankAccountId: 0 }))}
                      className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                        form.destination === option.value
                          ? "border-primary-500 bg-white shadow-sm"
                          : "border-gray-200 bg-white hover:border-primary-300"
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-900">{option.label}</div>
                      <div className="mt-1 text-xs text-gray-500">{option.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                Method: <strong>{isAfghanistanCity ? "Cash" : selectedMethod?.label || "Cash"}</strong>
                {" · "}
                Destination: <strong>{selectedDestination?.label || "Send to Haji"}</strong>
              </div>

              {showCityBankAccountSelect && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City Bank Account *</label>
                  <select
                    value={form.bankAccountId || 0}
                    onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value), superAdminBankAccountId: 0 }))}
                    className="select-field"
                  >
                    <option value={0}>Select city bank account…</option>
                    {cityBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">This payment will be treated as received into your city bank account.</p>
                </div>
              )}

              {showSuperAdminBankAccountSelect && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Super Admin Bank Account *</label>
                  <select
                    value={form.superAdminBankAccountId || 0}
                    onChange={e => setForm((f: any) => ({ ...f, superAdminBankAccountId: parseInt(e.target.value), bankAccountId: 0 }))}
                    className="select-field"
                  >
                    <option value={0}>Select super admin bank account…</option>
                    {superAdminBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">This payment will be marked as sent directly to the selected super admin bank account.</p>
                </div>
              )}
            </div>
          )}

          {createType === "payment" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.paymentMethod === "cheque" ? "Cheque Number" : "Voucher / Reference Number"} <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                value={form.manualVoucherNo || ""}
                onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))}
                className="input-field"
                placeholder={form.paymentMethod === "cheque" ? "e.g. 001234" : "e.g. REF-1024"}
                onKeyDown={e => e.key === "Enter" && addToQueue()}
              />
              <p className="mt-1 text-xs text-gray-500">
                {form.paymentMethod === "cheque"
                  ? "Use the cheque number here. You do not need to enter it twice."
                  : "Helpful for voucher matching, transfer reference, or manual receipt tracking."}
              </p>
            </div>
          )}

          {createType === "payment" && form.paymentMethod === "cheque" && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
                <p className="font-semibold">Cheque details</p>
                <p className="mt-1 text-xs text-blue-700">Only fill the bank and due date. The cheque number is already captured above.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("drawn_on_bank")}</label>
                  <input value={form.chequeBank || ""} onChange={e => setForm((f: any) => ({ ...f, chequeBank: e.target.value }))} className="input-field" placeholder="e.g. HBL" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("due_date")}</label>
                <input type="date" value={form.chequeDueDate || ""} onChange={e => setForm((f: any) => ({ ...f, chequeDueDate: e.target.value }))} className="input-field" />
              </div>
            </div>
          )}

          {createType === "haji_transfer" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label>
              <select value={form.transferType} onChange={e => setForm((f: any) => ({ ...f, transferType: e.target.value }))} className="select-field">
                <option value="from_in_hand">{t("from_in_hand")}</option>
                <option value="direct">{t("direct_transfer")}</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

        </div>
        {/* ── Batch queue (payment only) ── */}
        {createType === "payment" && paymentQueue.length > 0 && (
          <div className="mt-4 border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Queued ({paymentQueue.length})</p>
            {/* Header row */}
            <div className="grid grid-cols-[70px_1fr_80px_70px_24px] gap-1 px-3 py-1">
              <span className="text-[9px] font-bold text-gray-400 uppercase">Date</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase">Name</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase">Voucher</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase text-right">Amount</span>
              <span />
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {paymentQueue.map((q, i) => (
                <div key={q.tempId} className="grid grid-cols-[70px_1fr_80px_70px_24px] gap-1 items-center bg-blue-50 rounded-lg px-3 py-2">
                  <span className="text-[10px] text-blue-600 font-medium whitespace-nowrap">{q.date}</span>
                  <span className="text-xs font-semibold text-blue-900 truncate">{q.customerName}</span>
                  <span className="text-[10px] text-blue-500 truncate">{q.voucherNo || "—"}</span>
                  <span className="text-xs font-bold text-blue-800 text-right whitespace-nowrap">{q.currencySymbol} {q.amount.toLocaleString("en-US")}</span>
                  <button onClick={() => setPaymentQueue(prev => prev.filter(p => p.tempId !== q.tempId))}
                    className="text-blue-300 hover:text-red-400 transition-colors text-center">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t">
          {createType === "payment" ? (
            <>
              <button onClick={addToQueue} disabled={submitting}
                className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
                + Add to Queue
              </button>
              {paymentQueue.length > 0 && (
                <button onClick={saveQueue} disabled={savingQueue}
                  className="btn-primary text-sm flex items-center gap-1.5">
                  {savingQueue ? "Saving…" : `✓ Confirm & Save (${paymentQueue.length})`}
                </button>
              )}
            </>
          ) : (
            <button onClick={() => handleCreate()} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
          )}
        </div>
      </Modal>

      {/* ── EDIT MODAL ──────────────────────────────────────────────────────── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
          {createType === "haji_transfer" && (
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label><select value={form.transferType || "from_in_hand"} onChange={e => setForm((f: any) => ({ ...f, transferType: e.target.value }))} className="select-field"><option value="from_in_hand">{t("from_in_hand")}</option><option value="direct">{t("direct_transfer")}</option></select></div>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* ── VOUCHER DUPLICATE WARNING ────────────────────────────────────────── */}
      <Modal open={!!voucherWarning} onClose={() => setVoucherWarning(null)} title="⚠️ Duplicate Voucher Number" size="md">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-semibold mb-1">This voucher number already exists in your city.</p>
            <p>Please review the existing record(s) below. Are you sure this is a different payment?</p>
          </div>
          <div className="space-y-2">
            {voucherWarning?.matches.map((m: any) => (
              <div key={m.id} className="border border-gray-200 rounded-lg p-3 text-sm bg-gray-50">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-gray-900">{m.customerName}</p>
                    <p className="text-gray-500">{m.detail}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{formatDate(m.paymentDate)} · {m.paymentMethod}</p>
                  </div>
                  <span className="font-bold text-green-700">{m.currencySymbol} {m.amount?.toLocaleString("en-US")}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setVoucherWarning(null)} className="btn-secondary text-sm">Cancel — go back</button>
            <button onClick={() => { setVoucherWarning(null); handleCreate(true); }} className="btn-danger text-sm">Save Anyway</button>
          </div>
        </div>
      </Modal>

      {/* ── HARD DELETE 2FA ──────────────────────────────────────────────────── */}
      <Modal open={showHardDelete} onClose={() => setShowHardDelete(false)} title={`⚠️ ${t("permanently_delete")}`} size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">{t("cannot_undo")}</p>
            <p>{t("permanent_delete_warning")}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("enter_password_confirm")}</label>
            <input type="password" value={hardDeletePassword} onChange={e => setHardDeletePassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleHardDelete()} className="input-field" placeholder={t("admin_password_placeholder")} autoFocus />
          </div>
          {hardDeleteError && <p className="text-sm text-red-600">{hardDeleteError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setShowHardDelete(false)} className="btn-secondary text-sm">{t("cancel")}</button>
            <button onClick={handleHardDelete} disabled={hardDeleteSubmitting} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {hardDeleteSubmitting ? t("deleting") : t("permanently_delete")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── BOUNCE CHEQUE MODAL ──────────────────────────────────────────────── */}
      <Modal open={showBounce} onClose={() => { setShowBounce(false); setBounceTarget(null); }} title="⚠️ Mark Cheque as Bounced" size="sm">
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-semibold mb-1">This will mark the cheque as bounced.</p>
            <p>This action cannot be undone. The cheque status will be updated to &quot;Bounced&quot;.</p>
          </div>
          {bounceTarget && (
            <div className="border border-gray-200 rounded-lg p-3 text-sm bg-gray-50">
              <p className="font-medium text-gray-900">{bounceTarget.person || "—"}</p>
              <p className="text-gray-500 mt-0.5">{bounceTarget.detail}</p>
              <p className="font-bold text-red-600 mt-1">{bounceTarget.currencySymbol} {bounceTarget.amount?.toLocaleString("en-US")}</p>
              {bounceTarget.raw?.chequeNumber && <p className="text-gray-400 text-xs mt-0.5">Cheque #{bounceTarget.raw.chequeNumber}</p>}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => { setShowBounce(false); setBounceTarget(null); }} className="btn-secondary text-sm">{t("cancel")}</button>
            <button onClick={handleBounce} disabled={bounceSubmitting} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {bounceSubmitting ? "..." : t("mark_bounced")}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
