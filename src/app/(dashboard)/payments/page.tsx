"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatusBadge, ModalStatusNotice, formatDate, RowActionMenu, MobileDateInput, FormattedNumberInput } from "@/components/ui";
import CustomerFieldWithNew from "@/components/CustomerFieldWithNew";
import WithdraweeFieldWithNew from "@/components/WithdraweeFieldWithNew";
import { useLang } from "@/lib/lang";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { useSearchParams } from "next/navigation";
import { getEmbedFromLocation, getEmbedQuickformPath, shouldSimplifyCityModals } from "@/lib/quickform-embed";
import { formatCityAmount, formatCurrencySelectLabel } from "@/lib/city-money-format";
import { buildSettlementTargetValue, parseSettlementTargetValue } from "@/lib/haji-settlement-target";
import { buildCityHajiTransferDetail, formatSuperAdminBankLabel } from "@/lib/haji-transfer-detail";
import { buildPaymentCancellationReversalRow } from "@/lib/treasury-ledger";
import { formatPaymentModuleDetail, buildPaymentSubmitPayload, validatePakistanPaymentForm, formatSuperAdminPaymentDetail, formatPakistanCityPaymentDetail, getPakistanPaymentAccountSelectValue, parsePakistanPaymentAccountSelectValue, buildPakistanPaymentAccountOptions, sanitizePaymentSubmitPayload, formatAfghanistanCityPaymentDetail } from "@/lib/payment-module-detail";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { LedgerExportButtons } from "@/components/LedgerExportButtons";
import type { LedgerExportType } from "@/lib/ledger-export";


const TYPE_CONFIG: Record<string, { label: string; color: string; amountColor: string }> = {
  payment:      { label: "Payment",    color: "bg-blue-50 text-blue-700",   amountColor: "text-green-700" },
  payment_reversal: { label: "Reversal", color: "bg-rose-50 text-rose-700", amountColor: "text-rose-700" },
  expense:      { label: "Expense",    color: "bg-red-50 text-red-700",     amountColor: "text-red-600" },
  haji_transfer:{ label: "Haji",       color: "bg-orange-50 text-orange-700", amountColor: "text-orange-600" },
  withdrawal:   { label: "Withdrawal", color: "bg-purple-50 text-purple-700", amountColor: "text-purple-600" },
  opening_cash: { label: "Opening Cash", color: "bg-slate-50 text-slate-700", amountColor: "text-slate-700" },
  opening_bank: { label: "Opening Bank", color: "bg-slate-50 text-slate-700", amountColor: "text-slate-700" },
};

function safeParseQueueBody(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

const CHEQUE_STATUS_STYLES: Record<string, string> = {
  in_hand: "bg-yellow-50 text-yellow-700",
  deposited_to_bank: "bg-blue-50 text-blue-700",
  sent_to_haji: "bg-green-50 text-green-700",
  bounced: "bg-red-50 text-red-700",
};

function paymentListRowClassName(item: any) {
  if (item.type === "payment" && item.status === "cancelled") {
    return "bg-gray-50/80 opacity-65 [&_td:not(:last-child)]:line-through [&_td:not(:last-child)]:decoration-gray-400/90";
  }
  if (item.type === "payment_reversal") {
    return "bg-rose-50/40";
  }
  if (item.type === "withdrawal" && item.status === "pending") {
    return "bg-amber-50/50 opacity-80";
  }
  return "";
}

function appendPaymentReversalRow(items: any[], paymentRow: any, reason: string, cancelledAt?: string) {
  const reversal = buildPaymentCancellationReversalRow({
    ...(paymentRow.raw || {}),
    id: paymentRow.id,
    status: "cancelled",
    cancelledAt: cancelledAt ? new Date(cancelledAt) : new Date(),
    cancellationReason: reason,
    detail: paymentRow.detail,
    amount: paymentRow.amount,
    currency: { symbol: paymentRow.currencySymbol, code: paymentRow.currencyCode },
    customer: paymentRow.person ? { name: paymentRow.person } : null,
    city: paymentRow.cityName ? { name: paymentRow.cityName } : null,
  });
  if (!reversal) return items;
  if (items.some((row) => row.id === reversal.id)) return items;
  return [...items, reversal];
}

function renderChequeStatusHint(item: any, t: (key: string) => string) {
  if (item.type !== "payment" || !item.raw?.chequeStatus) return null;
  const chequeStatusLabels: Record<string, string> = {
    in_hand: t("in_hand_status"),
    deposited_to_bank: t("deposited_to_bank"),
    sent_to_haji: t("sent_to_haji_status"),
    used_for_liability: "Used for liability",
    bounced: t("bounced"),
  };
  return (
    <span
      className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium no-underline ${CHEQUE_STATUS_STYLES[item.raw.chequeStatus] || "bg-gray-50 text-gray-700"}`}
    >
      {chequeStatusLabels[item.raw.chequeStatus] || item.raw.chequeStatus}
    </span>
  );
}

function mapQueueUrlToCombinedType(url: string): "payment" | "expense" | "haji_transfer" | "withdrawal" | null {
  if (url.startsWith("/api/v1/payments")) return "payment";
  if (url.startsWith("/api/v1/expenses")) return "expense";
  if (url.startsWith("/api/v1/haji-transfers")) return "haji_transfer";
  if (url.startsWith("/api/v1/personal-withdrawals")) return "withdrawal";
  return null;
}

function applyQueuedMutationsToCombinedList(baseItems: any[], queueItems: any[]) {
  if (!Array.isArray(baseItems) || !Array.isArray(queueItems) || queueItems.length === 0) return baseItems;
  let next = [...baseItems];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    const type = mapQueueUrlToCombinedType(url);
    if (!type) continue;
    const match = url.match(/^\/api\/v1\/[^/]+\/([^/?#]+)/);
    const targetId = match?.[1];
    if (!targetId) continue;
    if (method === "DELETE") {
      next = next.filter((row) => !(String(row?.id || "") === targetId && String(row?.type || "") === type));
      continue;
    }
    const patch = safeParseQueueBody(String(q?.body || ""));
    const isPaymentCancel = type === "payment" && url.includes("/cancel");
    if (isPaymentCancel) {
      let cancelledRow: any = null;
      next = next.map((row) => {
        if (String(row?.id || "") !== targetId || String(row?.type || "") !== type) return row;
        cancelledRow = {
          ...row,
          status: "cancelled",
          _pending: true,
          raw: {
            ...(row.raw || {}),
            status: "cancelled",
            cancellationReason: patch?.reason ?? row.raw?.cancellationReason,
          },
        };
        return cancelledRow;
      });
      if (cancelledRow) {
        next = appendPaymentReversalRow(next, cancelledRow, patch?.reason ?? "");
      }
      continue;
    }
    next = next.map((row) => {
      if (String(row?.id || "") !== targetId || String(row?.type || "") !== type) return row;
      if (type === "withdrawal") {
        return {
          ...row,
          person: patch?.withdrawnBy ?? row?.person,
          detail: patch?.reason ?? row?.detail,
          amount: patch?.amount ?? row?.amount,
          _pending: true,
        };
      }
      return {
        ...row,
        detail: patch?.detail ?? row?.detail,
        amount: patch?.amount ?? row?.amount,
        _pending: true,
      };
    });
  }
  return next;
}

function TypeBadge({ type, amount }: { type: string; amount?: number }) {
  if (type === "payment" && Number(amount || 0) < 0) {
    return <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-rose-50 text-rose-700">Returned</span>;
  }
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
  { value: "our_account", label: "Office", hint: "Treat as company/office receipt" },
  { value: "haji", label: "Haji", hint: "Counts toward Haji settlement" },
];

const PAKISTAN_HAJI_TARGET = "Super Admin Account";
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
  inHandCheques: any[];
};

type LatestPaymentEntrySummary = {
  type: string;
  title: string;
  date: string;
  primary: string;
  amount: string;
  meta: string[];
  pending: boolean;
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

function buildLatestPaymentEntrySummary(
  type: string,
  body: any,
  formSnapshot: any,
  currencies: any[],
  lots: any[],
  pending = false,
): LatestPaymentEntrySummary {
  const currencyId = Number(body?.currencyId || formSnapshot?.currencyId || 0);
  const currency = currencies.find((row: any) => row.id === currencyId);
  const currencyLabel = currency?.symbol || currency?.code || "";
  const amount = Number(body?.amount || body?.cashAmount || formSnapshot?.amount || formSnapshot?.cashAmount || 0);
  const date = body?.paymentDate || body?.transferDate || body?.expenseDate || body?.withdrawalDate || formSnapshot?.paymentDate || formSnapshot?.transferDate || formSnapshot?.expenseDate || formSnapshot?.withdrawalDate || "";
  const lotId = Number(body?.lotId || formSnapshot?.lotId || 0);
  const lot = lots.find((row: any) => row.id === lotId);
  const refNo = body?.manualVoucherNo || body?.referenceNo || formSnapshot?.manualVoucherNo || formSnapshot?.referenceNo || "";
  const title = TYPE_CONFIG[type]?.label || type.replace("_", " ");
  const primary = type === "payment"
    ? (formSnapshot?.customerName || body?.customerName || body?.detail || "Customer payment")
    : type === "withdrawal"
      ? (body?.withdrawnBy || formSnapshot?.withdrawnBy || body?.detail || "Withdrawal")
      : (body?.detail || formSnapshot?.detail || title);
  const meta = [
    refNo ? `Ref ${refNo}` : "",
    lot?.lotNumber ? `Lot ${lot.lotNumber}` : "",
    body?.paymentMethod || formSnapshot?.paymentMethod || body?.sourceType || formSnapshot?.sourceType || body?.paidFrom || formSnapshot?.paidFrom || "",
  ].filter(Boolean);

  return {
    type,
    title,
    date,
    primary,
    amount: `${currencyLabel ? `${currencyLabel} ` : ""}${amount.toLocaleString("en-US")}`,
    meta,
    pending,
  };
}

function buildLatestPaymentEntrySummaryFromRow(item: any): LatestPaymentEntrySummary | null {
  if (!item) return null;
  const type = item.type || "payment";
  const raw = item.raw || {};
  const refNo = type === "haji_transfer" ? raw.referenceNo : raw.manualVoucherNo;
  const lotNumber = raw.lot?.lotNumber || item.lot?.lotNumber;
  const method = raw.paymentMethod || raw.sourceType || raw.paidFrom || "";
  const title = TYPE_CONFIG[type]?.label || type.replace("_", " ");
  const primary = type === "payment"
    ? (item.person || raw.customer?.name || item.detail || "Customer payment")
    : type === "withdrawal"
      ? (item.person || raw.withdrawnBy || item.detail || "Withdrawal")
      : (item.detail || title);
  const meta = [
    refNo ? `Ref ${refNo}` : "",
    lotNumber ? `Lot ${lotNumber}` : "",
    method,
  ].filter(Boolean);

  return {
    type,
    title,
    date: item.date || raw.paymentDate || raw.transferDate || raw.expenseDate || raw.withdrawalDate || "",
    primary,
    amount: `${item.currencySymbol || raw.currency?.symbol || raw.currency?.code || ""} ${Number(item.amount || 0).toLocaleString("en-US")}`.trim(),
    meta,
    pending: Boolean(item._pending),
  };
}

function preserveSignedPaymentAmount(value: number | null, rawValue: string): number | string {
  return rawValue === "-" || rawValue === "." || rawValue === "-." || rawValue.endsWith(".") ? rawValue : value || 0;
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = useQuickformEmbed();
  const simplifyModals = shouldSimplifyCityModals(user, isEmbed);
  const { isOnline, enqueue, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, discardQueuedItem, syncQueue } = useOffline();
  const canCreateRecords = user?.role === "city_admin";
  const isAfghanistanCity = user?.countryName === "Afghanistan";
  const isPakistanSimplified = simplifyModals && !isAfghanistanCity;
  const isSuperAdmin = user?.role === "super_admin";

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState<"today" | "last7" | "month" | "all" | "custom">("all");
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
  const [inHandCheques, setInHandCheques] = useState<any[]>([]);
  const [settlementIntermediaries, setSettlementIntermediaries] = useState<any[]>([]);
  const [settlementCashAccounts, setSettlementCashAccounts] = useState<any[]>([]);
  const [settlementOptionsLoading, setSettlementOptionsLoading] = useState(false);
  const [settlementOptionsError, setSettlementOptionsError] = useState("");
  const [form, setForm] = useState<any>({ paymentMethod: "cash", destination: "our_account" });
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

  // Cancel / delete combined ledger row
  const [showDelete, setShowDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Voucher duplicate warning
  const [voucherWarning, setVoucherWarning] = useState<{ matches: any[] } | null>(null);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  // ── Batch payment queue ──────────────────────────────────────────────────
  const [paymentQueue, setPaymentQueue] = useState<Array<{ tempId: string; customerName: string; voucherNo: string; amount: number; currencySymbol: string; detail: string; date: string; body: any }>>([]);
  const [savingQueue, setSavingQueue] = useState(false);
  const [queueSaved, setQueueSaved] = useState(false);
  const [paymentSavedNotice, setPaymentSavedNotice] = useState<string | null>(null);
  const [latestCreatedEntry, setLatestCreatedEntry] = useState<LatestPaymentEntrySummary | null>(null);
  const [showLatestEntry, setShowLatestEntry] = useState(false);
  const [createFormReady, setCreateFormReady] = useState(false);
  const [createFormVersion, setCreateFormVersion] = useState(0);
  const prefillHandledRef = useRef(false);
  const createRequestRef = useRef<{ signature: string; requestId: string } | null>(null);
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
    const embedRoute = isEmbed || getEmbedFromLocation();
    if (embedRoute) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
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
        .filter((entry) => !isSuperAdmin || entry.type === "payment" || entry.type === "haji_transfer");
      nextItems = [...pendingEntries, ...nextItems];
      nextItems = applyQueuedMutationsToCombinedList(nextItems, queuedItems as any[]);
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
  const refreshToLatestPaymentsAfterPaint = useCallback(() => {
    window.setTimeout(() => refreshToLatestPayments(), 0);
  }, [refreshToLatestPayments]);

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

  const applyDatePreset = (preset: "today" | "last7" | "month" | "all" | "custom") => {
    setDateRangePreset(preset);
    if (preset === "custom") return;
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
        "inHandCheques",
      ]);
      if (!cached) {
        return { loadedCurrencies: [] as any[] };
      }
      setLots(cached.lots);
      setCurrencies(cached.currencies);
      setCityBankAccounts(cached.cityBankAccounts);
      setSuperAdminBankAccounts(cached.superAdminBankAccounts);
      setInHandCheques(cached.inHandCheques || []);
      return { loadedCurrencies: cached.currencies };
    }

    const [lR, ciR, cityBanksR, superAdminBanksR, chequesR] = await Promise.all([
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/cities"),
      apiCall("/api/v1/bank-accounts"),
      apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }),
      isAfghanistanCity
        ? Promise.resolve({ success: true, data: [] })
        : apiCall("/api/v1/payments", {
            params: {
              all: 1,
              status: "active",
              payment_method: "cheque",
              destination: "our_account",
              cheque_status: "in_hand",
            },
          }),
    ]);
    if (lR.success) setLots(lR.data as any[]);
    if (cityBanksR.success) setCityBankAccounts(cityBanksR.data as any[]);
    if (superAdminBanksR.success) setSuperAdminBankAccounts(superAdminBanksR.data as any[]);
    if (chequesR.success) setInHandCheques(chequesR.data as any[]);
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
        inHandCheques: chequesR.success ? (chequesR.data as any[]) : [],
      });
    }
    return { loadedCurrencies };
  };

  const loadSettlementOptions = useCallback(async (currencyId: number) => {
    if (!isAfghanistanCity || !currencyId) {
      setSettlementIntermediaries([]);
      setSettlementCashAccounts([]);
      setSettlementOptionsError("");
      return;
    }
    setSettlementOptionsLoading(true);
    setSettlementOptionsError("");
    const result = await apiCall("/api/v1/haji-transfers/settlement-options", { params: { currencyId } });
    setSettlementOptionsLoading(false);
    if (result.success) {
      const payload = result.data as any;
      setSettlementIntermediaries(payload?.intermediaries || []);
      setSettlementCashAccounts(payload?.superAdminCashAccounts || []);
    } else {
      setSettlementIntermediaries([]);
      setSettlementCashAccounts([]);
      setSettlementOptionsError(result.error || "Failed to load settlement options");
    }
  }, [isAfghanistanCity]);

  useEffect(() => {
    if ((!showCreate && !showEdit) || !["payment", "haji_transfer"].includes(createType) || !isAfghanistanCity) return;
    const currencyId = Number(form.currencyId || currencies[0]?.id || 0);
    if (currencyId) void loadSettlementOptions(currencyId);
  }, [showCreate, showEdit, createType, isAfghanistanCity, form.currencyId, currencies, loadSettlementOptions]);

  const getAfghanistanPaymentTargetValue = useCallback((paymentForm: any = form) => {
    return buildSettlementTargetValue(paymentForm.settlementDestination, paymentForm.intermediaryId, paymentForm.superAdminCashAccountId) || "cash";
  }, [form]);

  const handleAfghanistanPaymentTargetChange = useCallback((value: string) => {
    if (value === "cash") {
      setForm((f: any) => ({
        ...f,
        paymentMethod: "cash",
        destination: "our_account",
        settlementDestination: null,
        intermediaryId: 0,
        superAdminCashAccountId: 0,
        bankAccountId: 0,
        superAdminBankAccountId: 0,
        detail: "",
      }));
      return;
    }
    const parsed = parseSettlementTargetValue(value);
    setForm((f: any) => ({
      ...f,
      ...parsed,
      paymentMethod: "cash",
      destination: "our_account",
      bankAccountId: 0,
      superAdminBankAccountId: 0,
      detail: "",
    }));
  }, []);

  const buildAfghanistanPaymentPayload = useCallback((paymentForm: any, currencyId: number) => {
    const amount = Number(paymentForm.amount);
    if (!paymentForm.customerId || !Number.isFinite(amount) || amount === 0) {
      return { error: "Customer and non-zero amount are required" };
    }
    const targetValue = getAfghanistanPaymentTargetValue(paymentForm);
    const targetName = targetValue === "cash"
      ? ""
      : targetValue.startsWith("intermediary:")
        ? settlementIntermediaries.find((row: any) => row.id === Number(targetValue.split(":")[1]))?.name || ""
        : settlementCashAccounts.find((row: any) => row.id === Number(targetValue.split(":")[1]))?.bankName || "";
    if (targetValue !== "cash" && !targetName) {
      return { error: "Please select a valid payment method" };
    }
    const parsedTarget = targetValue === "cash"
      ? { settlementDestination: null, intermediaryId: undefined, superAdminCashAccountId: undefined }
      : parseSettlementTargetValue(targetValue);
    return {
      body: sanitizePaymentSubmitPayload({
        ...paymentForm,
        settlementDestination: parsedTarget.settlementDestination,
        intermediaryId: parsedTarget.settlementDestination === "intermediary" ? parsedTarget.intermediaryId : undefined,
        superAdminCashAccountId: parsedTarget.settlementDestination === "super_admin_cash" ? parsedTarget.superAdminCashAccountId : undefined,
        amount,
        currencyId,
        paymentMethod: "cash",
        destination: "our_account",
        detail: formatAfghanistanCityPaymentDetail({
          customerName: paymentForm.customerName,
          targetName,
          manualVoucherNo: paymentForm.manualVoucherNo,
        }),
        bankAccountId: 0,
        superAdminBankAccountId: 0,
      }),
    };
  }, [getAfghanistanPaymentTargetValue, settlementCashAccounts, settlementIntermediaries]);

  const buildInitialFormForType = useCallback((type: string, loadedCurrencies: any[], preset: Record<string, any> = {}) => {
    const today = new Date().toISOString().split("T")[0];
    const currencyId = loadedCurrencies[0]?.id || currencies[0]?.id || 0;
    if (type === "payment") {
      return {
        customerId: 0,
        customerName: "",
        paymentDate: today,
        amount: 0,
        detail: "",
        currencyId,
        paymentMethod: "cash",
        destination: "our_account",
        notes: "",
        chequeNumber: "",
        chequeBank: "",
        chequeDueDate: "",
        bankAccountId: 0,
        superAdminBankAccountId: 0,
        settlementDestination: null,
        intermediaryId: 0,
        superAdminCashAccountId: 0,
        manualVoucherNo: "",
        ...preset,
      };
    }
    if (type === "expense") {
      return {
        expenseDate: today,
        amount: 0,
        detail: "",
        notes: "",
        lotId: 0,
        currencyId,
        paidFrom: "cash_office",
        customerId: 0,
        customerName: "",
        bankAccountId: 0,
        ...preset,
      };
    }
    if (type === "haji_transfer") {
      return {
        lotId: 0,
        transferDate: today,
        amount: 0,
        cashAmount: 0,
        detail: "",
        notes: "",
        currencyId,
        transferType: "from_in_hand",
        sourceType: "cash_office",
        settlementDestination: "intermediary",
        intermediaryId: 0,
        superAdminCashAccountId: 0,
        superAdminDestinationAccountId: 0,
        referenceNo: "",
        bankAccountId: 0,
        chequePaymentIds: [],
        transferredTo: "",
        ...preset,
      };
    }
    return {
      withdrawalDate: today,
      amount: 0,
      detail: "",
      withdrawnBy: "",
      notes: "",
      currencyId,
      sourceType: "cash_office",
      bankAccountId: 0,
      ...preset,
    };
  }, [currencies]);

  const loadLatestCreateEntrySummary = useCallback(async () => {
    if (isOnline) {
      const result = await apiCall("/api/v1/finance/combined", { params: { page: 1, limit: 1, type: "all" } });
      if (result.success) {
        const latest = buildLatestPaymentEntrySummaryFromRow(((result.data as any[]) || [])[0]);
        if (latest) return latest;
      }
    }

    const localEntry = items[0];
    if (localEntry) return buildLatestPaymentEntrySummaryFromRow(localEntry);

    const snapshot = readOfflineReadSnapshot<PaymentsReadSnapshot>(PAYMENTS_READ_CACHE_KEY)?.data;
    const snapshotEntry = snapshot?.items?.[0];
    if (snapshotEntry) return buildLatestPaymentEntrySummaryFromRow(snapshotEntry);
    return null;
  }, [isOnline, items]);

  const openCreate = async (type: string, preset?: Record<string, any>) => {
    setCreateFormReady(false);
    setCreateType(type);
    setResolvingQueueId(null);
    setPaymentSavedNotice(null);
    setShowLatestEntry(false);
    setLatestCreatedEntry(await loadLatestCreateEntrySummary());
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
    setForm(buildInitialFormForType(type, loadedCurrencies, preset));
    setPaymentQueue([]);
    setQueueSaved(false);
    setCreateFormReady(true);
    setShowCreate(true); setError("");
  };

  const resetCurrentCreateFormAfterSave = useCallback(() => {
    const currentDate = form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || new Date().toISOString().split("T")[0];
    const preserveDatePreset = {
      paymentDate: currentDate,
      expenseDate: currentDate,
      transferDate: currentDate,
      withdrawalDate: currentDate,
    };
    setForm(buildInitialFormForType(createType, currencies, preserveDatePreset));
    setCreateFormVersion((version) => version + 1);
  }, [buildInitialFormForType, createType, currencies, form.expenseDate, form.paymentDate, form.transferDate, form.withdrawalDate]);

  const buildSubmissionForType = async (type: string, forceVoucher = false) => {
    const resolvedCurrencyId = form.currencyId || currencies[0]?.id || 0;
    if (!resolvedCurrencyId) {
      return {
        error: getOfflineFormReadinessError({
          isOnline,
          currencyCount: currencies.length,
          moduleTitle: "Payment",
        }) || "Currency setup missing",
      };
    }

    if (type === "payment") {
      const paymentAmount = Number(form.amount);
      const paymentForm = { ...form, amount: paymentAmount };
      let afghanistanPaymentBody: any = null;
      if (isPakistanSimplified) {
        const validationError = validatePakistanPaymentForm(form);
        if (validationError) return { error: validationError };
      } else if (isAfghanistanCity) {
        const result = buildAfghanistanPaymentPayload(paymentForm, resolvedCurrencyId);
        if ("error" in result) return { error: result.error };
        afghanistanPaymentBody = result.body;
      } else if (!form.customerId || !Number.isFinite(paymentAmount) || paymentAmount === 0 || !form.detail) {
        return { error: t("customer") + ", non-zero " + t("amount") + ", " + t("detail") + " required" };
      }
      if (!forceVoucher && form.manualVoucherNo?.trim()) {
        const check = await apiCall(`/api/v1/payments/check-voucher?voucher_no=${encodeURIComponent(form.manualVoucherNo.trim())}`);
        if (check.success && (check.data as any).isDuplicate) return { duplicateMatches: (check.data as any).matches };
      }
      return {
        endpoint: "/api/v1/payments",
        body: isPakistanSimplified
          ? buildPaymentSubmitPayload(paymentForm, {
              currencyId: resolvedCurrencyId,
              cityBankAccounts,
              superAdminBankAccounts,
            })
          : isAfghanistanCity
            ? afghanistanPaymentBody
          : sanitizePaymentSubmitPayload({ ...paymentForm, currencyId: resolvedCurrencyId }),
      };
    }

    if (type === "expense") {
      if (!(form.amount > 0) || !form.detail) return { error: t("amount") + " (must be > 0) and " + t("detail") + " required" };
      if (form.paidFrom === "bank_account" && !form.bankAccountId) return { error: t("select") + " " + t("bank_account").toLowerCase() };
      if (form.paidFrom === "customer" && !form.customerId) return { error: t("select") + " " + t("customer").toLowerCase() };
      return {
        endpoint: "/api/v1/expenses",
        body: {
          ...form,
          lotId: form.lotId || null,
          currencyId: resolvedCurrencyId,
          bankAccountId: form.paidFrom === "bank_account" ? form.bankAccountId : undefined,
          customerId: form.paidFrom === "customer" ? form.customerId : undefined,
        },
      };
    }

    if (type === "haji_transfer") {
      const chequePaymentIds = Array.isArray(form.chequePaymentIds) ? form.chequePaymentIds : [];
      const isChequeSource = form.sourceType === "cheque" || form.sourceType === "mixed_cash_cheque";
      const destinationAccount = !isAfghanistanCity
        ? superAdminBankAccounts.find((a: any) => a.id === form.superAdminDestinationAccountId)
        : null;
      const transferredTo = !isAfghanistanCity
        ? (destinationAccount ? formatSuperAdminBankLabel(destinationAccount) : PAKISTAN_HAJI_TARGET)
        : undefined;
      const hajiDetail = isAfghanistanCity
        ? String(form.detail || "").trim()
        : buildCityHajiTransferDetail({
            sourceType: form.sourceType || "cash_office",
            transferredTo,
            destinationAccount,
          });
      if (isAfghanistanCity && !hajiDetail) return { error: t("detail") + " required" };
      if (!isChequeSource && !(form.amount > 0)) return { error: t("amount") + " (must be > 0) required" };
      if (form.sourceType === "bank_transfer" && !form.bankAccountId) return { error: t("select") + " " + t("bank_account").toLowerCase() };
      if (form.sourceType === "cheque" && chequePaymentIds.length === 0) return { error: t("select_cheques") };
      if (form.sourceType === "mixed_cash_cheque" && !(form.cashAmount > 0) && chequePaymentIds.length === 0) return { error: "Enter a cash amount or select at least one cheque" };
      if (!isAfghanistanCity && superAdminBankAccounts.length > 0 && !form.superAdminDestinationAccountId) return { error: "Please select a destination account" };
      if (isAfghanistanCity && !buildSettlementTargetValue(form.settlementDestination, form.intermediaryId, form.superAdminCashAccountId)) return { error: "Please select where funds are going" };
      return {
        endpoint: "/api/v1/haji-transfers",
        body: {
          lotId: form.lotId || null,
          transferDate: form.transferDate || form.paymentDate || new Date().toISOString().split("T")[0],
          amount: form.sourceType === "cheque" ? selectedHajiChequeTotal : Number(form.amount || 0),
          cashAmount: form.sourceType === "mixed_cash_cheque" ? Number(form.cashAmount || 0) : undefined,
          currencyId: resolvedCurrencyId,
          detail: hajiDetail,
          notes: form.notes || undefined,
          referenceNo: form.referenceNo || form.manualVoucherNo || undefined,
          transferType: form.sourceType === "bank_transfer" ? "direct" : "from_in_hand",
          sourceType: isAfghanistanCity
            ? "cash_office"
            : isChequeSource
              ? form.sourceType
              : form.sourceType || "cash_office",
          bankAccountId: form.sourceType === "bank_transfer" ? form.bankAccountId || undefined : undefined,
          chequePaymentIds: isChequeSource ? chequePaymentIds : undefined,
          superAdminDestinationAccountId: !isAfghanistanCity ? form.superAdminDestinationAccountId || undefined : undefined,
          transferredTo,
          settlementDestination: isAfghanistanCity ? form.settlementDestination || "intermediary" : undefined,
          intermediaryId: isAfghanistanCity && form.settlementDestination === "intermediary" ? Number(form.intermediaryId || 0) : undefined,
          superAdminCashAccountId: isAfghanistanCity && form.settlementDestination === "super_admin_cash" ? Number(form.superAdminCashAccountId || 0) : undefined,
        },
      };
    }

    if (!(form.amount > 0) || !form.detail) return { error: t("amount") + " (must be > 0) and " + t("detail") + " required" };
    if (!String(form.withdrawnBy || "").trim()) return { error: "Withdrawn By is required" };
    if (form.sourceType === "bank_account" && !form.bankAccountId) return { error: t("select") + " " + t("bank_account").toLowerCase() };
    return {
      endpoint: "/api/v1/personal-withdrawals",
      body: {
        ...form,
        withdrawnBy: String(form.withdrawnBy || "").trim(),
        currencyId: resolvedCurrencyId,
        bankAccountId: form.sourceType === "bank_account" ? form.bankAccountId : undefined,
      },
    };
  };

  useEffect(() => {
    if (prefillHandledRef.current || !canCreateRecords) return;
    const create = searchParams.get("create");
    const customerId = parseInt(searchParams.get("customer_id") || "0");
    if (create !== "payment" && !customerId) return;
    prefillHandledRef.current = true;
    const customerName = searchParams.get("customer_name") || "";
    void openCreate("payment", {
      customerId: Number.isFinite(customerId) ? customerId : 0,
      customerName,
      detail: searchParams.get("detail") || "",
    });
    window.history.replaceState({}, "", getEmbedQuickformPath("/payments"));
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
    window.history.replaceState({}, "", getEmbedQuickformPath("/payments"));
  }, [canCreateRecords, isEmbed, queuedItems, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (forceVoucher = false) => {
    setSubmitting(true); setError("");
    const submission = await buildSubmissionForType(createType, forceVoucher);
    if (submission.error) {
      setError(submission.error);
      setSubmitting(false);
      return;
    }
    if (submission.duplicateMatches) {
      setVoucherWarning({ matches: submission.duplicateMatches });
      setSubmitting(false);
      return;
    }
    const endpoint = submission.endpoint!;
    const body = submission.body;
    const formSnapshot = { ...form };
    const payloadSignature = `${endpoint}:${JSON.stringify(body)}`;
    if (!createRequestRef.current || createRequestRef.current.signature !== payloadSignature) {
      createRequestRef.current = { signature: payloadSignature, requestId: `browser-${crypto.randomUUID()}` };
    }
    const createRequestHeaders = { "x-sync-request-id": createRequestRef.current.requestId };
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

    const keepCreateModalOpen = canCreateRecords;

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
      if (keepCreateModalOpen) {
        setLatestCreatedEntry(buildLatestPaymentEntrySummary(createType, body, formSnapshot, currencies, lots, true));
        resetCurrentCreateFormAfterSave();
        setError("");
        setPaymentSavedNotice("Entry queued for sync.");
        setTimeout(() => setPaymentSavedNotice(null), 3000);
      } else {
        setShowCreate(false);
      }
      setResolvingQueueId(null);
      setSubmitting(false);
      return;
    }

    // ── Online: normal submit ──
    const r = await apiCall(endpoint, { method: "POST", body, headers: createRequestHeaders });
    if (r.success) {
      createRequestRef.current = null;
      setResolvingQueueId(null);
      if (keepCreateModalOpen) {
        setLatestCreatedEntry(buildLatestPaymentEntrySummary(createType, body, formSnapshot, currencies, lots));
        resetCurrentCreateFormAfterSave();
        setError("");
        setPaymentSavedNotice("Entry recorded.");
        setTimeout(() => setPaymentSavedNotice(null), 3000);
        refreshToLatestPaymentsAfterPaint();
      } else {
        setShowCreate(false);
        if (isEmbed) closeEmbed();
        refreshToLatestPaymentsAfterPaint();
      }
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  // ── Add current form to batch queue (payment only) ──────────────────────
  const addToQueue = async () => {
    setError("");
    const paymentAmount = Number(form.amount);
    const paymentForm = { ...form, amount: paymentAmount };
    let afghanistanPaymentBody: any = null;
    if (isPakistanSimplified) {
      const validationError = validatePakistanPaymentForm(form);
      if (validationError) { setError(validationError); return; }
    } else if (isAfghanistanCity) {
      const result = buildAfghanistanPaymentPayload(paymentForm, form.currencyId || currencies[0]?.id);
      if ("error" in result) { setError(result.error || "Invalid payment"); return; }
      afghanistanPaymentBody = result.body;
    } else if (!form.customerId || !Number.isFinite(paymentAmount) || paymentAmount === 0 || !form.detail) {
      setError(t("customer") + ", non-zero amount, detail required");
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
    const body = isPakistanSimplified
      ? buildPaymentSubmitPayload(paymentForm, {
          currencyId: form.currencyId || currencies[0]?.id,
          cityBankAccounts,
          superAdminBankAccounts,
        })
      : isAfghanistanCity
        ? afghanistanPaymentBody
      : sanitizePaymentSubmitPayload({ ...paymentForm, currencyId: form.currencyId || currencies[0]?.id });
    setPaymentQueue(prev => [...prev, {
      tempId: `q-${Date.now()}-${Math.random()}`,
      customerName: form.customerName || "Customer",
      voucherNo: form.manualVoucherNo?.trim() || "",
      amount: form.amount,
      currencySymbol: selectedCur?.symbol ?? "",
      detail: body.detail || form.detail,
      date: form.paymentDate,
      body,
    }]);
    // Reset form for next entry, keep modal open
    const selectedDate = form.paymentDate || new Date().toISOString().split("T")[0];
    setForm(buildInitialFormForType("payment", currencies, { paymentDate: selectedDate }));
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
    if (item.type === "payment_reversal" || (item.type === "payment" && item.status === "cancelled")) return;
    setCreateFormReady(false);
    setCreateType(item.type);
    setSelected(item);
    const { loadedCurrencies } = await loadHelpers();
    const raw = item.raw;
    if (item.type === "payment") {
      const linkedHajiTransfer = raw.hajiTransferPayment || null;
      setForm({
        customerId: raw.customerId || raw.customer?.id || 0,
        customerName: raw.customer?.name || item.person || "",
        paymentDate: item.date || String(raw.paymentDate || "").slice(0, 10),
        amount: raw.amount,
        detail: raw.detail || "",
        currencyId: raw.currencyId || loadedCurrencies[0]?.id || currencies[0]?.id || 0,
        paymentMethod: raw.paymentMethod || "cash",
        destination: raw.destination || "our_account",
        notes: raw.notes || "",
        chequeNumber: raw.chequeNumber || "",
        chequeBank: raw.chequeBank || "",
        chequeDueDate: raw.chequeDueDate ? String(raw.chequeDueDate).slice(0, 10) : "",
        bankAccountId: raw.bankAccountId || 0,
        superAdminBankAccountId: raw.superAdminBankAccountId || 0,
        settlementDestination: linkedHajiTransfer?.settlementDestination || null,
        intermediaryId: linkedHajiTransfer?.intermediaryId || 0,
        superAdminCashAccountId: linkedHajiTransfer?.superAdminCashAccountId || 0,
        manualVoucherNo: raw.manualVoucherNo || "",
      });
    } else if (item.type === "haji_transfer") {
      setForm({
        transferDate: item.date || (raw.transferDate ? String(raw.transferDate).slice(0, 10) : ""),
        amount: raw.amount,
        cashAmount: raw.cashAmount || 0,
        detail: raw.detail || "",
        referenceNo: raw.referenceNo || "",
        currencyId: raw.currencyId || loadedCurrencies[0]?.id || currencies[0]?.id || 0,
        sourceType: raw.sourceType || (raw.transferType === "direct" ? "bank_transfer" : "cash_office"),
        bankAccountId: raw.bankAccountId || 0,
        chequePaymentIds: raw.chequePaymentId ? [raw.chequePaymentId] : [],
        existingHajiCheques: raw.chequePayment ? [raw.chequePayment] : [],
        transferType: raw.transferType || (raw.sourceType === "bank_transfer" ? "direct" : "from_in_hand"),
        settlementDestination: raw.settlementDestination || "standard",
        superAdminDestinationAccountId: raw.superAdminBankAccountId || raw.superAdminCashAccountId || 0,
        intermediaryId: raw.intermediaryId || 0,
        superAdminCashAccountId: raw.superAdminCashAccountId || 0,
        transferredTo: raw.transferredTo || "",
        notes: raw.notes || "",
      });
    } else if (item.type === "expense") {
      setForm({
        expenseDate: item.date || (raw.expenseDate ? String(raw.expenseDate).slice(0, 10) : ""),
        amount: raw.amount,
        detail: raw.detail || "",
        notes: raw.notes || "",
        lotId: raw.lotId || 0,
        currencyId: raw.currencyId || loadedCurrencies[0]?.id || currencies[0]?.id || 0,
        paidFrom: raw.paidFrom || "cash_office",
        bankAccountId: raw.bankAccountId || 0,
        customerId: raw.customerPayment?.customerId || 0,
        customerName: raw.customerPayment?.customer?.name || "",
      });
    } else {
      // withdrawal
      setForm({
        withdrawalDate: item.date || (raw.withdrawalDate ? String(raw.withdrawalDate).slice(0, 10) : ""),
        amount: raw.amount,
        detail: raw.detail || "",
        notes: raw.notes || "",
        withdrawnBy: raw.withdrawnBy || item.person || "",
        currencyId: raw.currencyId || loadedCurrencies[0]?.id || currencies[0]?.id || 0,
        sourceType: raw.sourceType || "cash_office",
        bankAccountId: raw.bankAccountId || 0,
      });
    }
    setCreateFormReady(true);
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    const id = selected.id;
    const originalType = selected?.type;
    const submission = await buildSubmissionForType(createType, originalType === createType);
    if (submission.error) {
      setError(submission.error);
      return;
    }
    if (submission.duplicateMatches) {
      setVoucherWarning({ matches: submission.duplicateMatches });
      return;
    }
    const endpoint = createType === "payment" ? `/api/v1/payments/${id}` : createType === "expense" ? `/api/v1/expenses/${id}` : createType === "haji_transfer" ? `/api/v1/haji-transfers/${id}` : `/api/v1/personal-withdrawals/${id}`;
    const body = submission.body;
    const editedDate = form.paymentDate || form.transferDate || form.expenseDate || form.withdrawalDate || "";
    if (originalType && createType !== originalType) {
      if (!isOnline) {
        setError("Changing payment type requires internet so the old entry can be reversed safely.");
        return;
      }
      setSubmitting(true);
      const createResult = await apiCall(submission.endpoint!, { method: "POST", body });
      if (!createResult.success) {
        setSubmitting(false);
        setError(createResult.error || "Failed");
        return;
      }
      const typeLabel = TYPE_CONFIG[createType]?.label || createType;
      const previousTypeLabel = TYPE_CONFIG[originalType]?.label || originalType;
      const cleanupEndpoint = originalType === "payment" ? `/api/v1/payments/${id}/cancel` : originalType === "expense" ? `/api/v1/expenses/${id}` : originalType === "haji_transfer" ? `/api/v1/haji-transfers/${id}` : `/api/v1/personal-withdrawals/${id}`;
      const cleanupMethod = originalType === "payment" ? "PUT" : "DELETE";
      const cleanupBody = originalType === "payment" ? { reason: `Converted from ${previousTypeLabel} to ${typeLabel}` } : undefined;
      const cleanupResult = await apiCall(cleanupEndpoint, { method: cleanupMethod, body: cleanupBody });
      setSubmitting(false);
      if (cleanupResult.success) {
        setShowEdit(false);
        load();
      } else {
        setError(cleanupResult.error || `Created ${typeLabel}, but failed to remove old ${previousTypeLabel}. Please review before saving again.`);
        load();
      }
      return;
    }
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(id);
      if (pendingQueueId) {
        const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(body) });
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
                  date: editedDate || item.date,
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
        body: JSON.stringify(body),
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
                date: editedDate || item.date,
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
    const r = await apiCall(endpoint, { method: "PUT", body });
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

  const openDelete = (item: any) => {
    setOpenActionId(null);
    setDeleteTarget(item);
    setDeleteReason("");
    setDeleteError("");
    setShowDelete(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const item = deleteTarget;
    const typeLabel = TYPE_CONFIG[item.type]?.label || item.type;
    if (!deleteReason.trim()) {
      setDeleteError(t("reason_required"));
      return;
    }
    const reason = deleteReason.trim();
    const endpoint = item.type === "payment" ? `/api/v1/payments/${item.id}/cancel` : item.type === "expense" ? `/api/v1/expenses/${item.id}` : item.type === "haji_transfer" ? `/api/v1/haji-transfers/${item.id}` : `/api/v1/personal-withdrawals/${item.id}`;
    const method = item.type === "payment" ? "PUT" : "DELETE";
    const body = item.type === "payment" ? { reason } : undefined;
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(item?.id);
      if (pendingQueueId) {
        await discardQueuedItem(pendingQueueId);
        setItems((prev) => {
          const next = prev.filter((row: any) => row.id !== item.id);
          persistPaymentsSnapshot(next);
          return next;
        });
        setShowDelete(false);
        setDeleteTarget(null);
        return;
      }
      setDeleteSubmitting(true);
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
        let next = prev.map((row: any) =>
          row.id === item.id && item.type === "payment"
            ? {
                ...row,
                status: "cancelled",
                _pending: true,
                raw: {
                  ...(row.raw || {}),
                  status: "cancelled",
                  cancellationReason: reason,
                },
              }
            : row
        );
        if (item.type === "payment") {
          const cancelledRow = next.find((row: any) => row.id === item.id);
          if (cancelledRow) next = appendPaymentReversalRow(next, cancelledRow, reason);
        } else {
          next = next.filter((row: any) => row.id !== item.id);
        }
        persistPaymentsSnapshot(next);
        return next;
      });
      setDeleteSubmitting(false);
      setShowDelete(false);
      setDeleteTarget(null);
      return;
    }
    setDeleteSubmitting(true);
    setDeleteError("");
    const r = await apiCall(endpoint, { method, body });
    setDeleteSubmitting(false);
    if (r.success) {
      setShowDelete(false);
      setDeleteTarget(null);
      load();
    } else {
      setDeleteError(r.error || `Failed to ${item.type === "payment" ? "cancel" : "delete"} ${typeLabel.toLowerCase()}`);
    }
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

  const isHajiAuditPayment = (item: any) => (
    item.type === "payment"
    && item.status === "active"
    && item.raw?.destination === "haji"
    && ["cash", "bank_transfer", "online"].includes(item.raw?.paymentMethod)
  );

  const canSaCheck = (item: any) => (
    ["payment", "haji_transfer", "expense", "withdrawal"].includes(item.type)
    && !(item.type === "payment" && item.status !== "active")
  );

  const isSaChecked = (item: any) => !!(item.raw?.hajiAudit?.confirmed || item.raw?.saCheck?.confirmed);

  const saCheckEndpoint = (item: any) => {
    if (item.type === "payment") return `/api/v1/payments/${item.id}`;
    if (item.type === "haji_transfer") return `/api/v1/haji-transfers/${item.id}`;
    if (item.type === "expense") return `/api/v1/expenses/${item.id}`;
    if (item.type === "withdrawal") return `/api/v1/personal-withdrawals/${item.id}`;
    return "";
  };

  const saCheckMethod = (item: any) => item.type === "haji_transfer" ? "PUT" : "PATCH";

  const handleToggleSaCheck = async (item: any, confirmed: boolean) => {
    const url = saCheckEndpoint(item);
    if (!url) return;
    const method = saCheckMethod(item);
    const action = isHajiAuditPayment(item) ? "set_haji_audit" : "set_sa_check";
    const applySaCheckState = (pending: boolean) => {
      setItems((prev) => {
        const next = prev.map((row: any) =>
          row.id === item.id && row.type === item.type
            ? {
                ...row,
                _pending: pending ? true : row._pending,
                raw: {
                  ...(row.raw || {}),
                  ...(action === "set_haji_audit"
                    ? { hajiAudit: { ...(row.raw?.hajiAudit || {}), confirmed } }
                    : { saCheck: { ...(row.raw?.saCheck || {}), confirmed } }),
                },
              }
            : row
        );
        persistPaymentsSnapshot(next);
        return next;
      });
    };
    if (!isOnline) {
      if (getPendingQueueId(item?.id)) {
        setError("Sync this pending entry first, then update verification.");
        return;
      }
      await enqueue({
        url,
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmed }),
        pathname: "/payments",
        auditMeta: {
          action: "audit_toggle",
          entityType: item.type,
          entityLabel: "SA check toggle (Pending)",
          entityDetail: `${item.detail || "Payment"} — ${confirmed ? "verified" : "unverified"}`,
        },
      });
      applySaCheckState(true);
      return;
    }
    const r = await apiCall(url, {
      method,
      body: { action, confirmed },
    });
    if (r.success) applySaCheckState(false);
    else setError(r.error || "Failed to update verification");
  };

  const columns = isSuperAdmin ? [
    {
      key: "date", label: t("date"),
      render: (item: any) => <span className="whitespace-nowrap tabular-nums">{formatDate(item.date)}</span>,
    },
    {
      key: "person", label: "City / Name",
      render: (item: any) => (
        <div className="min-w-0 leading-tight">
          {item.type === "haji_transfer" ? (
            <span className="block truncate">{item.cityName || "—"}</span>
          ) : (
            <>
              <span className="block truncate">{item.cityName || item.person || "—"}</span>
              {item.cityName && item.person && (
                <span className="block truncate text-[11px] text-indigo-500">{item.person}</span>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      key: "detail", label: t("detail"),
      render: (item: any) => {
        const detailText = item.type === "payment"
          ? (item.raw?.destination === "haji"
            ? formatSuperAdminPaymentDetail({
                paymentMethod: item.raw?.paymentMethod,
                superAdminBankAccount: item.raw?.superAdminBankAccount,
              })
            : item.detail)
          : item.detail;
        return (
          <div className="min-w-0 leading-tight">
            <span className="block truncate">{detailText}</span>
          </div>
        );
      },
    },
    {
      key: "ref", label: "Ref No.",
      render: (item: any) => {
        const ref = item.type === "haji_transfer"
          ? item.raw?.referenceNo
          : item.raw?.manualVoucherNo;
        return ref ? (
          <span className="font-mono text-xs text-gray-600">{ref}</span>
        ) : (
          <span className="text-gray-300">—</span>
        );
      },
    },
    {
      key: "amount", label: t("amount"),
      render: (item: any) => {
        const isReversal = item.type === "payment_reversal";
        const isIncoming = item.type === "payment" || item.type === "haji_transfer";
        return (
          <span className={`font-semibold tabular-nums ${isReversal ? "text-rose-700" : isIncoming ? "text-green-700" : "text-gray-700"}`}>
            {isReversal ? "−" : ""}{item.currencySymbol} {item.amount?.toLocaleString("en-US")}
          </span>
        );
      },
    },
    {
      key: "runningBalance",
      label: "Running Balance",
      render: (item: any) => (
        <span className="text-sm font-medium tabular-nums text-gray-700">
          {formatCityAmount(user, item.runningBalance || 0, item.currencyCode)}
        </span>
      ),
    },
    {
      key: "sa_check", label: "SA Check",
      render: (item: any) => (
        canSaCheck(item) ? (
          isSaChecked(item) ? (
            <span className="text-xs font-semibold text-emerald-700">Verified</span>
          ) : (
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={false}
                onChange={() => handleToggleSaCheck(item, true)}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              Verify
            </label>
          )
        ) : <span className="text-gray-300">—</span>
      ),
    },
    {
      key: "actions", label: "",
      render: (item: any) => {
        if (item.type === "payment_reversal") return <span className="text-gray-300">—</span>;
        const actionKey = getActionKey(item);
        const canAuditUnverify = canSaCheck(item) && isSaChecked(item);
        return (
          <RowActionMenu
            open={openActionId === actionKey}
            onOpenChange={(open) => setOpenActionId(open ? actionKey : null)}
          >
            {canAuditUnverify && (
              <button
                type="button"
                onClick={() => { setOpenActionId(null); handleToggleSaCheck(item, false); }}
                className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-amber-700 hover:bg-amber-50 sm:py-2 sm:text-xs"
              >
                Unverify
              </button>
            )}
            {item.type === "payment" && user?.role === "super_admin" && !getPendingQueueId(item?.id) && (
              <button onClick={() => { setOpenActionId(null); openHardDelete(item); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-800 hover:bg-red-50 sm:py-2 sm:text-xs">{t("hard_delete")}</button>
            )}
          </RowActionMenu>
        );
      },
    },
  ] : [
    {
      key: "date", label: t("date"),
      render: (item: any) => <span className="whitespace-nowrap tabular-nums">{formatDate(item.date)}</span>,
    },
    {
      key: "type", label: "Type",
      render: (item: any) => <TypeBadge type={item.type} amount={item.amount} />,
    },
    {
      key: "person", label: isSuperAdmin ? "City / Name" : "Name",
      render: (item: any) => {
        if (isSuperAdmin && item.type === "haji_transfer") {
          return item.cityName ? (
            <div className="min-w-0 leading-tight">
              <span className="block truncate">{item.cityName}</span>
              {item.raw?.sourceType && (
                <span className="block truncate text-[11px] text-indigo-500 capitalize">{String(item.raw.sourceType).replace(/_/g, " ")}</span>
              )}
            </div>
          ) : <span className="text-gray-300">—</span>;
        }
        return item.person ? (
          <div className="min-w-0 leading-tight">
            <span className="block truncate">{item.person}</span>
            {user?.role === "super_admin" && item.cityName && (
              <span className="block truncate text-[11px] text-indigo-500">{item.cityName}</span>
            )}
          </div>
        ) : <span className="text-gray-300">—</span>;
      },
    },
    {
      key: "detail", label: t("detail"),
      render: (item: any) => {
        const detailText = item.type === "payment"
          ? (item.raw?.paymentMethod
            ? (isPakistanSimplified
              ? formatPakistanCityPaymentDetail({
                  paymentMethod: item.raw?.paymentMethod,
                  destination: item.raw?.destination,
                  bankAccount: item.raw?.bankAccount,
                  superAdminBankAccount: item.raw?.superAdminBankAccount,
                })
              : isAfghanistanCity
                ? item.detail
                : formatPaymentModuleDetail({
                  paymentMethod: item.raw?.paymentMethod,
                  destination: item.raw?.destination,
                  manualVoucherNo: item.raw?.manualVoucherNo,
                  chequeNumber: item.raw?.chequeNumber,
                  bankAccount: item.raw?.bankAccount,
                  superAdminBankAccount: item.raw?.superAdminBankAccount,
                }))
            : item.detail)
          : item.detail;
        return (
        <div className="min-w-0 leading-tight" title={item.type === "payment" && item.status === "cancelled" && !item.raw?.cancellationReason ? "Cancelled" : undefined}>
          <span className="block truncate">{detailText}</span>
          {item.type === "payment" && item.status === "cancelled" && item.raw?.cancellationReason && !isSuperAdmin && (
            <span className="mt-0.5 block truncate text-[11px] text-red-600/90">{item.raw.cancellationReason}</span>
          )}
          {item.type === "haji_transfer" && item.raw?.lotNumber && <span className="mt-0.5 block text-[11px] text-gray-400">Lot {item.raw.lotNumber}</span>}
          {!isSuperAdmin && item.type === "haji_transfer" && item.raw?.sourceType && (
            <span className="mt-0.5 block text-[11px] text-gray-400 capitalize">{String(item.raw.sourceType).replace(/_/g, " ")}</span>
          )}
          {item.type === "expense" && item.raw?.lotNumber && <span className="mt-0.5 block text-[11px] text-gray-400">Lot {item.raw.lotNumber}</span>}
          {!isSuperAdmin && renderChequeStatusHint(item, t)}
        </div>
        );
      },
    },
    {
      key: "ref", label: "Ref No.",
      render: (item: any) => {
        const ref = item.type === "haji_transfer"
          ? item.raw?.referenceNo
          : item.raw?.manualVoucherNo;
        return ref ? (
          <span className="font-mono text-xs text-gray-600">{ref}</span>
        ) : (
          <span className="text-gray-300">—</span>
        );
      },
    },
    {
      key: "amount", label: t("amount"),
      render: (item: any) => {
        const cfg = TYPE_CONFIG[item.type];
        const isReversal = item.type === "payment_reversal";
        const isReturn = item.type === "payment" && Number(item.amount || 0) < 0;
        return (
          <div>
            <span className={`font-semibold tabular-nums ${isReturn ? "text-rose-700" : cfg?.amountColor || "text-gray-700"}`}>
              {isReversal ? "−" : ""}{item.currencySymbol} {item.amount?.toLocaleString("en-US")}
            </span>
            {item.type === "payment" && item.raw?.currencyCode === "AFN" && item.raw?.usdEquivalent && (
              <p className="text-xs text-gray-400 mt-0.5">≈ ${Number(item.raw.usdEquivalent).toLocaleString("en-US")}</p>
            )}
          </div>
        );
      },
    },
    ...(isSuperAdmin ? [{
      key: "status", label: t("status"),
      render: (item: any) => {
        if (item.type === "payment") {
          const chequeStatusColors: Record<string, string> = {
            in_hand: "bg-yellow-50 text-yellow-700",
            deposited_to_bank: "bg-blue-50 text-blue-700",
            sent_to_haji: "bg-green-50 text-green-700",
            used_for_liability: "bg-orange-50 text-orange-700",
            bounced: "bg-red-50 text-red-700",
          };
          const chequeStatusLabels: Record<string, string> = {
            in_hand: t("in_hand_status"),
            deposited_to_bank: t("deposited_to_bank"),
            sent_to_haji: t("sent_to_haji_status"),
            used_for_liability: "Used for liability",
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
              {isSaChecked(item) && (
                <span className="text-xs px-1.5 py-0.5 rounded font-medium mt-1 inline-block bg-emerald-50 text-emerald-700">
                  ✓ SA checked
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
    }] : []),
    ...(isSuperAdmin ? [{
      key: "sa_check", label: "SA Check",
      render: (item: any) => (
        canSaCheck(item) ? (
          <label className="inline-flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={isSaChecked(item)}
              onChange={(e) => handleToggleSaCheck(item, e.target.checked)}
              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            {isSaChecked(item) ? "Verified" : "Verify"}
          </label>
        ) : <span className="text-gray-300">—</span>
      ),
    }] : []),
    {
      key: "runningBalance",
      label: "Running Balance",
      render: (item: any) => (
        <span className="text-sm font-medium text-gray-700">
          {formatCityAmount(user, item.runningBalance || 0, item.currencyCode)}
        </span>
      ),
    },
    {
      key: "actions", label: t("actions"),
      render: (item: any) => {
        if (item.type === "payment_reversal") return <span className="text-gray-300">—</span>;
        const actionKey = getActionKey(item);
        const canEdit =
          ["payment", "expense", "haji_transfer", "withdrawal"].includes(item.type) &&
          !(item.type === "payment" && item.status === "cancelled") &&
          !(item.type === "withdrawal" && item.status === "approved") &&
          !isSaChecked(item);
        return (
          <RowActionMenu
            open={openActionId === actionKey}
            onOpenChange={(open) => setOpenActionId(open ? actionKey : null)}
          >
            {canEdit && (
              <button onClick={() => { setOpenActionId(null); void openEdit(item); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{item.type === "expense" ? t("edit_expense") : t("edit")}</button>
            )}
            {item.type === "payment" && item.status === "active" && (
              <button type="button" onClick={() => openDelete(item)} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("cancel")}</button>
            )}
            {item.type !== "payment" && (
              <button type="button" onClick={() => openDelete(item)} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("delete")}</button>
            )}
            {item.type === "payment" && user?.role === "super_admin" && !getPendingQueueId(item?.id) && (
              <button onClick={() => { setOpenActionId(null); openHardDelete(item); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-800 hover:bg-red-50 sm:py-2 sm:text-xs">{t("hard_delete")}</button>
            )}
            {item.type === "withdrawal" && item.status === "pending" && user?.role === "super_admin" && (
              <button onClick={() => { setOpenActionId(null); handleApproveWithdrawal(item); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-green-700 hover:bg-green-50 sm:py-2 sm:text-xs">Approve</button>
            )}
            {item.type === "payment" && item.status === "active" && item.raw?.paymentMethod === "cheque" && item.raw?.chequeStatus === "in_hand" && (
              <button onClick={() => { setOpenActionId(null); setBounceTarget(item); setShowBounce(true); setError(""); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-amber-700 hover:bg-amber-50 sm:py-2 sm:text-xs">{t("mark_bounced")}</button>
            )}
          </RowActionMenu>
        );
      },
    },
  ];

  const createTitle =
    createType === "payment" ? t("new_payment_title") :
    createType === "expense" ? t("new_expense_title") :
    createType === "haji_transfer" ? t("new_haji_title") :
    t("new_withdrawal_title");

  const switchCreateType = (nextType: string) => {
    const currentDate = form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || new Date().toISOString().split("T")[0];
    void openCreate(nextType, {
      paymentDate: currentDate,
      expenseDate: currentDate,
      transferDate: currentDate,
      withdrawalDate: currentDate,
    });
  };

  const switchEditType = (nextType: string) => {
    const currentDate = form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || new Date().toISOString().split("T")[0];
    const commonPreset = {
      paymentDate: currentDate,
      expenseDate: currentDate,
      transferDate: currentDate,
      withdrawalDate: currentDate,
      amount: Number(form.amount || 0),
      detail: form.detail || "",
      notes: form.notes || "",
      currencyId: form.currencyId || currencies[0]?.id || 0,
      customerId: form.customerId || 0,
      customerName: form.customerName || "",
      manualVoucherNo: form.manualVoucherNo || form.referenceNo || "",
      referenceNo: form.referenceNo || form.manualVoucherNo || "",
    };
    setCreateType(nextType);
    setForm(buildInitialFormForType(nextType, currencies, commonPreset));
    setError("");
  };

  const effectivePaymentMethod = form.paymentMethod || "cash";
  const selectedMethod = PAYMENT_METHOD_OPTIONS.find((option) => option.value === effectivePaymentMethod);
  const selectedDestination = DESTINATION_OPTIONS.find((option) => option.value === form.destination);
  const showDestinationField = effectivePaymentMethod !== "cash";
  const needsBankAccountSelection = createType === "payment" && ["bank_transfer", "online"].includes(effectivePaymentMethod);
  const isOfficeOnlyPaymentMethod = createType === "payment" && ["cash", "cheque"].includes(effectivePaymentMethod);
  const showCityBankAccountSelect = needsBankAccountSelection && !isPakistanSimplified && form.destination === "our_account";
  const showSuperAdminBankAccountSelect = needsBankAccountSelection && !isPakistanSimplified && form.destination === "haji";
  const resolvedCurrencyId = form.currencyId || currencies[0]?.id || 0;
  const pakistanPaymentAccounts = isPakistanSimplified && needsBankAccountSelection
    ? buildPakistanPaymentAccountOptions({
        paymentCurrencyId: resolvedCurrencyId,
        currencies,
        cityBankAccounts,
        superAdminBankAccounts,
      })
    : [];
  const paymentExportType: LedgerExportType = typeFilter === "expense"
    ? "expenses"
    : typeFilter === "haji_transfer"
      ? "haji_transfers"
      : typeFilter === "withdrawal"
        ? "withdrawals"
        : "payments";
  const renderAfghanistanPaymentMethodSelect = () => (
    <div className={isEmbed ? "quickform-panel space-y-2" : "space-y-2 rounded-xl border border-gray-200 bg-gray-50/70 p-4"}>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Payment Method *</label>
      <select
        value={getAfghanistanPaymentTargetValue(form)}
        onChange={(e) => handleAfghanistanPaymentTargetChange(e.target.value)}
        className="select-field"
      >
        <option value="cash">Cash</option>
        {settlementIntermediaries.length > 0 && (
          <optgroup label="Intermediaries">
            {settlementIntermediaries.map((row: any) => (
              <option key={`af-pay-i-${row.id}`} value={`intermediary:${row.id}`}>{row.name}</option>
            ))}
          </optgroup>
        )}
        {settlementCashAccounts.length > 0 && (
          <optgroup label="Superadmin cash pots">
            {settlementCashAccounts.map((row: any) => (
              <option key={`af-pay-c-${row.id}`} value={`cash:${row.id}`}>{row.bankName}</option>
            ))}
          </optgroup>
        )}
      </select>
      {settlementOptionsLoading && <p className="text-xs text-gray-500">Loading payment methods…</p>}
      {settlementOptionsError && <p className="text-xs text-red-600">{settlementOptionsError}</p>}
    </div>
  );
  const selectedHajiChequeIds = Array.isArray(form.chequePaymentIds) ? form.chequePaymentIds : [];
  const hajiChequeOptions = [
    ...(Array.isArray(form.existingHajiCheques) ? form.existingHajiCheques : []),
    ...inHandCheques,
  ].filter((cheque: any, index: number, rows: any[]) => cheque?.id && rows.findIndex((row: any) => row?.id === cheque.id) === index);
  const selectedHajiCheques = hajiChequeOptions.filter((cheque: any) => selectedHajiChequeIds.includes(cheque.id));
  const selectedHajiChequeTotal = selectedHajiCheques.reduce((sum: number, cheque: any) => sum + Number(cheque.amount || 0), 0);
  const withdrawalSourceValue = form.sourceType === "bank_account" && form.bankAccountId
    ? `bank_account:${form.bankAccountId}`
    : "cash_office";

  return (
    <div className={isEmbed ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {!isEmbed && <PageHeader title={isSuperAdmin ? "Haji Payments" : t("payments")} />}
      {!isEmbed && (
        <div className="mb-3 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="input-field col-span-2 h-8 min-w-0 text-xs sm:col-span-1 sm:min-w-[7rem] sm:flex-1 sm:max-w-xs"
          />
          {!isSuperAdmin && (
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="select-field h-8 min-w-0 w-full text-xs sm:w-auto"
            >
              <option value="all">All types</option>
              <option value="payment">Payments</option>
              <option value="expense">Expenses</option>
              <option value="haji_transfer">Haji</option>
              <option value="withdrawal">Withdrawals</option>
            </select>
          )}
          <select
            value={dateRangePreset}
            onChange={(e) => applyDatePreset(e.target.value as "today" | "last7" | "month" | "all" | "custom")}
            className="select-field h-8 min-w-0 w-full text-xs sm:w-auto"
            aria-label="Date range preset"
          >
            <option value="month">This month</option>
            <option value="today">Today</option>
            <option value="last7">7 days</option>
            <option value="all">All dates</option>
            <option value="custom">Custom</option>
          </select>
          {dateRangePreset === "custom" && (
            <>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="input-field h-8 min-w-0 w-full text-xs sm:w-[8.5rem]"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="input-field h-8 min-w-0 w-full text-xs sm:w-[8.5rem]"
              />
            </>
          )}
          <LedgerExportButtons
            type={paymentExportType}
            dateFrom={fromDate || undefined}
            dateTo={toDate || undefined}
            cityId={user?.cityId ?? undefined}
            query={searchQuery}
            disabled={!isOnline}
            className="col-span-2 justify-end sm:ml-auto"
          />
        </div>
      )}
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
        compact={!isSuperAdmin}
        columns={columns}
        data={items}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
        rowClassName={!isSuperAdmin ? paymentListRowClassName : undefined}
      />}

      {/* ── CREATE MODAL ───────────────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setCreateFormReady(false); setPaymentSavedNotice(null); setLatestCreatedEntry(null); setShowLatestEntry(false); if (isEmbed) closeEmbed(); }} title={createTitle} size="md" inline={isEmbed} hideHeader={isEmbed} headerAccent={createType === "payment" ? "bg-emerald-500" : createType === "haji_transfer" ? "bg-indigo-500" : createType === "expense" ? "bg-rose-500" : "bg-amber-500"}>
        <div onClick={() => setShowLatestEntry(false)}>
        {paymentSavedNotice && <ModalStatusNotice type="success" message={paymentSavedNotice} />}
        {latestCreatedEntry && (
          <div className="mb-3">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowLatestEntry((v) => !v); }}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 transition-colors hover:bg-emerald-100/70"
            >
              <span className="shrink-0 font-semibold">Last Entry {showLatestEntry ? "▲" : "▼"}</span>
              <span className="shrink-0 tabular-nums text-emerald-700">{latestCreatedEntry.date ? formatDate(latestCreatedEntry.date) : "—"}</span>
            </button>
            {showLatestEntry && (
              <div onClick={(e) => e.stopPropagation()} className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-emerald-900">{latestCreatedEntry.pending ? "Queued" : ""} {latestCreatedEntry.title}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{latestCreatedEntry.amount}</span>
                </div>
                <div className="mt-1 truncate text-emerald-900">{latestCreatedEntry.primary}</div>
                {latestCreatedEntry.meta.length > 0 && (
                  <div className="mt-1 truncate text-[11px] text-emerald-700">{latestCreatedEntry.meta.join(" · ")}</div>
                )}
              </div>
            )}
          </div>
        )}
        {error && <ModalStatusNotice type="error" message={error} />}
        <div key={`create-${createType}-${createFormVersion}`} className="space-y-3">
          {simplifyModals && createType === "payment" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("date")} *</label>
                  <MobileDateInput
                    variant="field"
                    value={form.paymentDate || ""}
                    onChange={(d) => setForm((f: any) => ({ ...f, paymentDate: d, expenseDate: d, transferDate: d, withdrawalDate: d }))}
                    placeholder={t("date")}
                    aria-label={t("date")}
                    closeOnSelect
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</label>
                  <select value={createType} onChange={(e) => switchCreateType(e.target.value)} className="select-field">
                    <option value="payment">Receive Payment</option>
                    <option value="haji_transfer">Haji Transfer</option>
                    <option value="expense">Expense</option>
                    <option value="withdrawal">Withdrawal</option>
                  </select>
                </div>
              </div>

              <CustomerFieldWithNew
                value={form.customerId || 0}
                onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
                placeholder={t("search_customer")}
                label={t("customer")}
                showWalkInShortcut={false}
                cityId={user?.cityId ?? undefined}
              />

              {isAfghanistanCity && renderAfghanistanPaymentMethodSelect()}

              {!isAfghanistanCity && createFormReady && (
                <div className={isEmbed ? "quickform-panel space-y-3" : "space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4"}>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("payment_method")}</label>
                    <select
                      value={effectivePaymentMethod}
                      onChange={e => {
                        const paymentMethod = e.target.value;
                        const officeOnly = paymentMethod === "cash" || paymentMethod === "cheque";
                        setForm((f: any) => ({
                          ...f,
                          paymentMethod,
                          destination: officeOnly ? "our_account" : f.destination,
                          bankAccountId: 0,
                          superAdminBankAccountId: 0,
                        }));
                      }}
                      className="select-field"
                    >
                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  {!isOfficeOnlyPaymentMethod && isPakistanSimplified && (
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Account *</label>
                    <select
                      value={getPakistanPaymentAccountSelectValue(form)}
                      onChange={e => {
                        const parsed = parsePakistanPaymentAccountSelectValue(e.target.value);
                        setForm((f: any) => ({ ...f, ...parsed }));
                      }}
                      className="select-field"
                    >
                      <option value="">Select</option>
                      {pakistanPaymentAccounts.map((account) => (
                        <option key={account.key} value={account.key}>
                          {account.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  )}
                  {showDestinationField && !isPakistanSimplified && (
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("destination")}</label>
                    <select
                      value={form.destination || "our_account"}
                      onChange={e => setForm((f: any) => ({ ...f, destination: e.target.value, bankAccountId: 0, superAdminBankAccountId: 0 }))}
                      className="select-field"
                    >
                      {DESTINATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  {showCityBankAccountSelect && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bank Account *</label>
                      <select
                        value={form.bankAccountId || 0}
                        onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value, 10), superAdminBankAccountId: 0 }))}
                        className="select-field"
                      >
                        <option value={0}>Select</option>
                        {cityBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {showSuperAdminBankAccountSelect && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bank Account *</label>
                      <select
                        value={form.superAdminBankAccountId || 0}
                        onChange={e => setForm((f: any) => ({ ...f, superAdminBankAccountId: parseInt(e.target.value, 10), bankAccountId: 0 }))}
                        className="select-field"
                      >
                        <option value={0}>Select</option>
                        {superAdminBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {currencies.length > 1 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("amount")} *</label>
                    <FormattedNumberInput
                      allowNegative
                      value={form.amount || ""}
                      onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))}
                      className="input-field"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("currency")}</label>
                    <select
                      value={form.currencyId || currencies[0]?.id || 0}
                      onChange={e => setForm((f: any) => ({
                        ...f,
                        currencyId: parseInt(e.target.value, 10) || 0,
                        bankAccountId: 0,
                        superAdminBankAccountId: 0,
                        settlementDestination: isAfghanistanCity ? null : f.settlementDestination,
                        intermediaryId: isAfghanistanCity ? 0 : f.intermediaryId,
                        superAdminCashAccountId: isAfghanistanCity ? 0 : f.superAdminCashAccountId,
                      }))}
                      className="select-field"
                    >
                      {currencies.map((c: any) => (
                        <option key={c.id} value={c.id}>{formatCurrencySelectLabel(c)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("amount")} *</label>
                  <FormattedNumberInput
                    allowNegative
                    value={form.amount || ""}
                    onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))}
                    className="input-field"
                  />
                </div>
              )}

              {!isAfghanistanCity ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {form.paymentMethod === "cheque" ? t("cheque_number") : t("reference")}
                    </label>
                    <input
                      value={form.manualVoucherNo || ""}
                      onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))}
                      className="input-field"
                      placeholder={form.paymentMethod === "cheque" ? "e.g. 001234" : "e.g. REF-1024"}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("notes")}</label>
                    <input
                      value={form.notes || ""}
                      onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
                      className="input-field"
                      placeholder={t("notes")}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {form.paymentMethod === "cheque" ? t("cheque_number") : t("reference")}
                  </label>
                  <input
                    value={form.manualVoucherNo || ""}
                    onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))}
                    className="input-field"
                    placeholder={form.paymentMethod === "cheque" ? "e.g. 001234" : "e.g. REF-1024"}
                  />
                </div>
              )}
            </>
          ) : (
            <>
          {/* ── DATE — always first ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("date")} *</label>
              <MobileDateInput
                variant="field"
                value={form.paymentDate || form.expenseDate || form.transferDate || form.withdrawalDate || ""}
                onChange={(d) => setForm((f: any) => ({ ...f, paymentDate: d, expenseDate: d, transferDate: d, withdrawalDate: d }))}
                placeholder={t("date")}
                aria-label={t("date")}
                closeOnSelect
              />
            </div>
            <div className="min-w-0">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</label>
              <select value={createType} onChange={(e) => switchCreateType(e.target.value)} className="select-field">
                <option value="payment">Receive Payment</option>
                <option value="haji_transfer">Haji Transfer</option>
                <option value="expense">Expense</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </div>
          </div>

          {createType === "payment" && (
            <CustomerFieldWithNew
              value={form.customerId || 0}
              onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
              placeholder={t("search_customer")}
              showWalkInShortcut={false}
              cityId={user?.cityId ?? undefined}
            />
          )}

          {createType === "withdrawal" && (
            <WithdraweeFieldWithNew
              value={form.withdrawnBy || ""}
              onChange={(name) => setForm((f: any) => ({ ...f, withdrawnBy: name }))}
              placeholder="e.g. Ali, Rehman"
              labelClassName="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500"
            />
          )}

          {createType !== "haji_transfer" && !(createType === "payment" && isAfghanistanCity) && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("detail")} *</label>
              <input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
            </div>
          )}

          {createType !== "haji_transfer" && createType !== "payment" && currencies.length > 1 && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("currency")}</label>
              <select value={form.currencyId || 0} onChange={e => setForm((f: any) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} ({c.symbol})</option>)}
              </select>
            </div>
          )}

          {createType !== "haji_transfer" && createType !== "payment" && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("amount")} *</label>
              <FormattedNumberInput
                min="0.01"
                value={form.amount || ""}
                onValueChange={(value) => setForm((f: any) => ({ ...f, amount: value || 0 }))}
                className="input-field"
              />
            </div>
          )}

          {createType === "expense" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("from")} *</label>
                <select
                  value={form.paidFrom === "bank_account" && form.bankAccountId ? `bank:${form.bankAccountId}` : form.paidFrom === "customer" ? "customer" : "cash_office"}
                  onChange={e => {
                    const value = e.target.value;
                    if (value.startsWith("bank:")) {
                      setForm((f: any) => ({ ...f, paidFrom: "bank_account", bankAccountId: parseInt(value.slice(5), 10) || 0, customerId: 0, customerName: "" }));
                      return;
                    }
                    if (value === "customer") {
                      setForm((f: any) => ({ ...f, paidFrom: "customer", bankAccountId: 0 }));
                      return;
                    }
                    setForm((f: any) => ({ ...f, paidFrom: "cash_office", bankAccountId: 0, customerId: 0, customerName: "" }));
                  }}
                  className="select-field"
                >
                  <option value="cash_office">{t("cash_from_office")}</option>
                  <option value="customer">{t("customer")}</option>
                  {cityBankAccounts.filter((a: any) => a.isActive).map((account: any) => (
                    <option key={account.id} value={`bank:${account.id}`}>
                      {account.bankName}{account.accountNumber ? ` (${account.accountNumber})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("lot")}</label>
                <select value={form.lotId || 0} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value, 10) || 0 }))} className="select-field">
                  <option value={0}>{t("auto_fifo")}</option>
                  {lots.filter((lot: any) => lot.status === "ongoing" || !lot.status).map((lot: any) => (
                    <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {createType === "expense" && form.paidFrom === "customer" && (
            <CustomerFieldWithNew
              value={form.customerId || 0}
              onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
              placeholder={t("search_customer")}
              showWalkInShortcut={false}
              cityId={user?.cityId ?? undefined}
            />
          )}

          {createType === "withdrawal" && !isAfghanistanCity && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("source_of_funds")}</label>
              <select
                value={withdrawalSourceValue}
                onChange={e => {
                  const value = e.target.value;
                  if (value.startsWith("bank_account:")) {
                    setForm((f: any) => ({ ...f, sourceType: "bank_account", bankAccountId: parseInt(value.split(":")[1] || "0", 10) || 0 }));
                    return;
                  }
                  setForm((f: any) => ({ ...f, sourceType: "cash_office", bankAccountId: 0 }));
                }}
                className="select-field"
              >
                <option value="cash_office">{t("cash_from_office")}</option>
                {cityBankAccounts.filter((account: any) => account.isActive).map((account: any) => (
                  <option key={account.id} value={`bank_account:${account.id}`}>
                    {account.bankName}{account.accountNumber ? ` · ${account.accountNumber}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {createType === "payment" && !isAfghanistanCity && createFormReady && (
            <div className={isEmbed ? "quickform-panel space-y-3" : "space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4"}>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{simplifyModals ? t("payment_method") : "How was the payment received?"}</label>
                {simplifyModals ? (
                  <select
                    value={form.paymentMethod || "cash"}
                    onChange={e => setForm((f: any) => ({ ...f, paymentMethod: e.target.value, bankAccountId: 0, superAdminBankAccountId: 0 }))}
                    className="select-field"
                  >
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
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
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{simplifyModals ? t("destination") : "Where should this payment go?"}</label>
                {simplifyModals ? (
                  <select
                    value={form.destination || "our_account"}
                    onChange={e => setForm((f: any) => ({ ...f, destination: e.target.value, bankAccountId: 0, superAdminBankAccountId: 0 }))}
                    className="select-field"
                  >
                    {DESTINATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
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
                )}
              </div>

              {!simplifyModals && (
              <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                Method: <strong>{selectedMethod?.label || "Cash"}</strong>
                {" · "}
                Destination: <strong>{selectedDestination?.label || "Send to Haji"}</strong>
              </div>
              )}

              {showCityBankAccountSelect && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">City Bank Account *</label>
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
                </div>
              )}

              {showSuperAdminBankAccountSelect && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Super Admin Bank Account *</label>
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
                </div>
              )}
            </div>
          )}

          {createType === "payment" && (
            currencies.length > 1 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("amount")} *</label>
                  <FormattedNumberInput
                    allowNegative
                    value={form.amount || ""}
                    onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))}
                    className="input-field"
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("currency")}</label>
                  <select value={form.currencyId || 0} onChange={e => setForm((f: any) => ({ ...f, currencyId: parseInt(e.target.value) }))} className="select-field">
                    {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} ({c.symbol})</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("amount")} *</label>
                <FormattedNumberInput
                  allowNegative
                  value={form.amount || ""}
                  onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))}
                  className="input-field"
                />
              </div>
            )
          )}

          {createType === "payment" && !simplifyModals && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {form.paymentMethod === "cheque" ? t("cheque_number") : t("reference")}
              </label>
              <input
                value={form.manualVoucherNo || ""}
                onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))}
                className="input-field"
                placeholder={form.paymentMethod === "cheque" ? "e.g. 001234" : "e.g. REF-1024"}
              />
            </div>
          )}

          {createType === "payment" && form.paymentMethod === "cheque" && !simplifyModals && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("drawn_on_bank")}</label>
                  <input value={form.chequeBank || ""} onChange={e => setForm((f: any) => ({ ...f, chequeBank: e.target.value }))} className="input-field" placeholder="e.g. HBL" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("due_date")}</label>
                <input type="date" value={form.chequeDueDate || ""} onChange={e => setForm((f: any) => ({ ...f, chequeDueDate: e.target.value }))} className="input-field" />
              </div>
            </div>
          )}

          {createType === "haji_transfer" && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
              {!isAfghanistanCity && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">From *</label>
                  <select
                    value={form.sourceType || "cash_office"}
                    onChange={e => setForm((f: any) => ({
                      ...f,
                      sourceType: e.target.value,
                      bankAccountId: 0,
                      chequePaymentIds: [],
                      amount: e.target.value === "cheque" || e.target.value === "mixed_cash_cheque" ? 0 : f.amount,
                      cashAmount: e.target.value === "mixed_cash_cheque" ? f.cashAmount : 0,
                    }))}
                    className="select-field"
                  >
                    <option value="cash_office">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="mixed_cash_cheque">Cash + Cheques</option>
                    <option value="bank_transfer">Online</option>
                  </select>
                </div>
              )}
              {isAfghanistanCity && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Going to *</label>
                  {settlementOptionsLoading ? (
                    <div className="select-field text-sm text-gray-500">Loading…</div>
                  ) : settlementOptionsError ? (
                    <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{settlementOptionsError}</div>
                  ) : settlementIntermediaries.length === 0 && settlementCashAccounts.length === 0 ? (
                    <div className="rounded border border-yellow-200 bg-yellow-50 p-2 text-xs text-yellow-700">
                      No intermediaries or haji cash pots for this currency.
                    </div>
                  ) : (
                    <select
                      value={buildSettlementTargetValue(form.settlementDestination, form.intermediaryId, form.superAdminCashAccountId)}
                      onChange={(e) => {
                        const parsed = parseSettlementTargetValue(e.target.value);
                        setForm((f: any) => ({ ...f, ...parsed }));
                      }}
                      className="select-field text-sm"
                    >
                      <option value="">Select destination…</option>
                      {settlementIntermediaries.length > 0 && (
                        <optgroup label="Intermediaries">
                          {settlementIntermediaries.map((row: any) => (
                            <option key={`i-${row.id}`} value={`intermediary:${row.id}`}>{row.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {settlementCashAccounts.length > 0 && (
                        <optgroup label="Haji cash pots">
                          {settlementCashAccounts.map((row: any) => (
                            <option key={`c-${row.id}`} value={`cash:${row.id}`}>{row.bankName}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  )}
                </div>
              )}
              {isAfghanistanCity && renderAfghanistanPaymentMethodSelect()}
              {(form.sourceType === "cheque" || form.sourceType === "mixed_cash_cheque") && !isAfghanistanCity && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("select_cheques")} {form.sourceType === "cheque" ? "*" : ""}</label>
                  {hajiChequeOptions.length === 0 ? (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">No cheques in hand. Record a cheque payment first.</div>
                  ) : (
                    <div className="max-h-52 overflow-auto rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
                      {hajiChequeOptions.map((cheque: any) => {
                        const checked = selectedHajiChequeIds.includes(cheque.id);
                        const ref = cheque.chequeNumber || cheque.manualVoucherNo || String(cheque.id);
                        const symbol = cheque.currency?.symbol || cheque.currency?.code || "";
                        return (
                          <label key={cheque.id} className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-sm leading-tight hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setForm((f: any) => {
                                const current = Array.isArray(f.chequePaymentIds) ? f.chequePaymentIds : [];
                                return {
                                  ...f,
                                  chequePaymentIds: current.includes(cheque.id)
                                    ? current.filter((id: number) => id !== cheque.id)
                                    : [...current, cheque.id],
                                };
                              })}
                              className="shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="min-w-0 truncate font-medium text-gray-800">{ref}</span>
                            <span className="ml-auto shrink-0 pl-4 text-right tabular-nums font-medium text-gray-700">
                              {symbol} {Number(cheque.amount || 0).toLocaleString("en-US")}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {form.sourceType === "bank_transfer" && !isAfghanistanCity && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Bank Account *</label>
                  <select
                    value={form.bankAccountId || 0}
                    onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value, 10) || 0 }))}
                    className="select-field"
                  >
                    <option value={0}>Select bank account</option>
                    {cityBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isAfghanistanCity && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Superadmin Account *</label>
                  <select
                    value={form.superAdminDestinationAccountId || 0}
                    onChange={e => setForm((f: any) => ({ ...f, superAdminDestinationAccountId: parseInt(e.target.value, 10) || 0 }))}
                    className="select-field"
                  >
                    <option value={0}>Select</option>
                    {superAdminBankAccounts.filter((a: any) => a.isActive).map((account: any) => (
                      <option key={account.id} value={account.id}>{formatSuperAdminBankLabel(account)}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${currencies.length > 1 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {form.sourceType === "mixed_cash_cheque" ? "Cash Amount" : t("amount")}{" "}
                    {form.sourceType === "cheque" ? <span className="font-normal text-gray-400">(auto)</span> : "*"}
                  </label>
                  {form.sourceType === "cheque" ? (
                    <div className="input-field bg-gray-50 tabular-nums text-gray-800">
                      {selectedHajiChequeTotal > 0 ? selectedHajiChequeTotal.toLocaleString("en-US") : "—"}
                    </div>
                  ) : (
                    <FormattedNumberInput
                      min="0.01"
                      value={form.sourceType === "mixed_cash_cheque" ? (form.cashAmount || "") : (form.amount || "")}
                      onValueChange={(value) => setForm((f: any) => form.sourceType === "mixed_cash_cheque"
                        ? ({ ...f, cashAmount: value || 0 })
                        : ({ ...f, amount: value || 0 }))}
                      className="input-field"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ref. No.</label>
                  <input
                    value={form.referenceNo || ""}
                    onChange={e => setForm((f: any) => ({ ...f, referenceNo: e.target.value }))}
                    className="input-field"
                  />
                </div>
                {currencies.length > 1 && (
                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("currency")} *</label>
                    <select
                      value={form.currencyId || 0}
                      onChange={e => {
                        const currencyId = parseInt(e.target.value, 10) || 0;
                        setForm((f: any) => ({
                          ...f,
                          currencyId,
                          settlementDestination: isAfghanistanCity ? "intermediary" : f.settlementDestination,
                          intermediaryId: isAfghanistanCity ? 0 : f.intermediaryId,
                          superAdminCashAccountId: isAfghanistanCity ? 0 : f.superAdminCashAccountId,
                          superAdminDestinationAccountId: !isAfghanistanCity ? 0 : f.superAdminDestinationAccountId,
                        }));
                        if (isAfghanistanCity && currencyId) void loadSettlementOptions(currencyId);
                      }}
                      className="select-field"
                    >
                      <option value={0}>Select</option>
                      {currencies.map((currency: any) => (
                        <option key={currency.id} value={currency.id}>{formatCurrencySelectLabel(currency)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t("notes")}</label>
                  <input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
                </div>
              </div>
              {form.sourceType === "mixed_cash_cheque" && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">
                  Slip total: {selectedHajiCheques[0]?.currency?.symbol || selectedHajiCheques[0]?.currency?.code || ""} {(Number(form.cashAmount || 0) + selectedHajiChequeTotal).toLocaleString("en-US")}
                </div>
              )}
            </div>
          )}

            </>
          )}

        </div>
        {/* ── Batch queue (payment only) ── */}
        {!isEmbed && createType === "payment" && paymentQueue.length > 0 && (
          <div className="mt-4 border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Queued ({paymentQueue.length})</p>
            {/* Header row */}
            <div className="grid grid-cols-[70px_1fr_80px_70px_24px] gap-1 px-3 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Date</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Name</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Voucher</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 text-right">Amount</span>
              <span />
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {paymentQueue.map((q, i) => (
                <div key={q.tempId} className="grid grid-cols-[70px_1fr_80px_70px_24px] gap-1 items-center bg-blue-50 rounded-lg px-3 py-2">
                  <span className="text-[10px] text-blue-600 font-medium whitespace-nowrap tabular-nums">{formatDate(q.date)}</span>
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

        <div className={isEmbed ? "quickform-footer" : "flex justify-end gap-2 pt-4 mt-4 border-t"}>
          {isEmbed ? (
            <button
              onClick={() => handleCreate()}
              disabled={submitting}
              className="glass-btn glass-btn-primary w-full min-h-11 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save payment"}
            </button>
          ) : createType === "payment" ? (
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
        </div>
      </Modal>

      {/* ── EDIT MODAL ──────────────────────────────────────────────────────── */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {createType === "payment" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
                  <MobileDateInput
                    variant="field"
                    value={form.paymentDate || ""}
                    onChange={(d) => setForm((f: any) => ({ ...f, paymentDate: d, expenseDate: d, transferDate: d, withdrawalDate: d }))}
                    placeholder={t("date")}
                    aria-label={t("date")}
                    closeOnSelect
                  />
                </div>
                {canCreateRecords && (
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select value={createType} onChange={(e) => switchEditType(e.target.value)} className="select-field">
                      <option value="payment">Receive Payment</option>
                      <option value="haji_transfer">Haji Transfer</option>
                      <option value="expense">Expense</option>
                      <option value="withdrawal">Withdrawal</option>
                    </select>
                  </div>
                )}
              </div>

              <CustomerFieldWithNew
                value={form.customerId || 0}
                onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
                placeholder={t("search_customer")}
                showWalkInShortcut={false}
                cityId={user?.cityId ?? undefined}
              />

              {isAfghanistanCity && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
                  <input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
                </div>
              )}

              {!isAfghanistanCity && createFormReady && (
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t("payment_method")}</label>
                    <select
                      value={effectivePaymentMethod}
                      onChange={e => {
                        const paymentMethod = e.target.value;
                        const officeOnly = paymentMethod === "cash" || paymentMethod === "cheque";
                        setForm((f: any) => ({
                          ...f,
                          paymentMethod,
                          destination: officeOnly ? "our_account" : f.destination,
                          bankAccountId: 0,
                          superAdminBankAccountId: 0,
                        }));
                      }}
                      className="select-field"
                    >
                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  {!isOfficeOnlyPaymentMethod && isPakistanSimplified && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Account *</label>
                      <select
                        value={getPakistanPaymentAccountSelectValue(form)}
                        onChange={e => {
                          const parsed = parsePakistanPaymentAccountSelectValue(e.target.value);
                          setForm((f: any) => ({ ...f, ...parsed }));
                        }}
                        className="select-field"
                      >
                        <option value="">Select</option>
                        {pakistanPaymentAccounts.map((account) => (
                          <option key={account.key} value={account.key}>{account.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {showDestinationField && !isPakistanSimplified && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">{t("destination")}</label>
                      <select value={form.destination || "our_account"} onChange={e => setForm((f: any) => ({ ...f, destination: e.target.value, bankAccountId: 0, superAdminBankAccountId: 0 }))} className="select-field">
                        {DESTINATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {showCityBankAccountSelect && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account *</label>
                      <select value={form.bankAccountId || 0} onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value, 10), superAdminBankAccountId: 0 }))} className="select-field">
                        <option value={0}>Select</option>
                        {cityBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {showSuperAdminBankAccountSelect && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account *</label>
                      <select value={form.superAdminBankAccountId || 0} onChange={e => setForm((f: any) => ({ ...f, superAdminBankAccountId: parseInt(e.target.value, 10), bankAccountId: 0 }))} className="select-field">
                        <option value={0}>Select</option>
                        {superAdminBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {currencies.length > 1 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
                    <FormattedNumberInput min={createType === "payment" ? undefined : "0.01"} allowNegative={createType === "payment"} value={form.amount || ""} onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))} className="input-field" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
                    <select value={form.currencyId || currencies[0]?.id || 0} onChange={e => setForm((f: any) => ({ ...f, currencyId: parseInt(e.target.value, 10) || 0, bankAccountId: 0, superAdminBankAccountId: 0, settlementDestination: isAfghanistanCity ? null : f.settlementDestination, intermediaryId: isAfghanistanCity ? 0 : f.intermediaryId, superAdminCashAccountId: isAfghanistanCity ? 0 : f.superAdminCashAccountId }))} className="select-field">
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{formatCurrencySelectLabel(c)}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
                  <FormattedNumberInput min={createType === "payment" ? undefined : "0.01"} allowNegative={createType === "payment"} value={form.amount || ""} onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))} className="input-field" />
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {form.paymentMethod === "cheque" ? t("cheque_number") : t("reference")}
                  </label>
                  <input
                    value={form.manualVoucherNo || ""}
                    onChange={e => setForm((f: any) => ({ ...f, manualVoucherNo: e.target.value }))}
                    className="input-field"
                    placeholder={form.paymentMethod === "cheque" ? "e.g. 001234" : "e.g. REF-1024"}
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("notes")}</label>
                  <input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" placeholder={t("notes")} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
                  <MobileDateInput
                    variant="field"
                    value={form.expenseDate || form.withdrawalDate || form.transferDate || form.paymentDate || ""}
                    onChange={(d) => setForm((f: any) => ({ ...f, expenseDate: d, withdrawalDate: d, transferDate: d, paymentDate: d }))}
                    placeholder={t("date")}
                    aria-label={t("date")}
                    closeOnSelect
                  />
                </div>
                {canCreateRecords && (
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select value={createType} onChange={(e) => switchEditType(e.target.value)} className="select-field">
                      <option value="payment">Receive Payment</option>
                      <option value="haji_transfer">Haji Transfer</option>
                      <option value="expense">Expense</option>
                      <option value="withdrawal">Withdrawal</option>
                    </select>
                  </div>
                )}
              </div>

              {createType !== "haji_transfer" && !(createType === "payment" && isAfghanistanCity) && (
                <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label><input value={form.detail || ""} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
              )}

              {createType !== "haji_transfer" && currencies.length > 1 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
                    <FormattedNumberInput min={createType === "payment" ? undefined : "0.01"} allowNegative={createType === "payment"} value={form.amount || ""} onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))} className="input-field" />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label>
                    <select value={form.currencyId || currencies[0]?.id || 0} onChange={e => setForm((f: any) => ({ ...f, currencyId: parseInt(e.target.value, 10) || 0 }))} className="select-field">
                      {currencies.map((c: any) => <option key={c.id} value={c.id}>{formatCurrencySelectLabel(c)}</option>)}
                    </select>
                  </div>
                </div>
              ) : createType !== "haji_transfer" ? (
                <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><FormattedNumberInput min={createType === "payment" ? undefined : "0.01"} allowNegative={createType === "payment"} value={form.amount || ""} onValueChange={(value, rawValue) => setForm((f: any) => ({ ...f, amount: preserveSignedPaymentAmount(value, rawValue) }))} className="input-field" /></div>
              ) : null}

              {createType === "expense" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("from")}</label>
                    <select
                      value={form.paidFrom === "bank_account" && form.bankAccountId ? `bank:${form.bankAccountId}` : form.paidFrom === "customer" ? "customer" : "cash_office"}
                      onChange={e => {
                        const value = e.target.value;
                        if (value.startsWith("bank:")) {
                          setForm((f: any) => ({ ...f, paidFrom: "bank_account", bankAccountId: parseInt(value.slice(5), 10) || 0, customerId: 0, customerName: "" }));
                          return;
                        }
                        if (value === "customer") {
                          setForm((f: any) => ({ ...f, paidFrom: "customer", bankAccountId: 0 }));
                          return;
                        }
                        setForm((f: any) => ({ ...f, paidFrom: "cash_office", bankAccountId: 0, customerId: 0, customerName: "" }));
                      }}
                      className="select-field"
                    >
                      <option value="cash_office">{t("cash_from_office")}</option>
                      <option value="customer">{t("customer")}</option>
                      {cityBankAccounts.filter((a: any) => a.isActive).map((account: any) => (
                        <option key={account.id} value={`bank:${account.id}`}>
                          {account.bankName}{account.accountNumber ? ` (${account.accountNumber})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label>
                    <select value={form.lotId || 0} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value, 10) || 0 }))} className="select-field">
                      <option value={0}>{t("auto_fifo")}</option>
                      {lots.filter((lot: any) => lot.status === "ongoing" || !lot.status).map((lot: any) => (
                        <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {createType === "expense" && form.paidFrom === "customer" && (
                <CustomerFieldWithNew
                  value={form.customerId || 0}
                  onChange={(id, name) => setForm((f: any) => ({ ...f, customerId: id, customerName: name }))}
                  placeholder={t("search_customer")}
                  showWalkInShortcut={false}
                  cityId={user?.cityId ?? undefined}
                />
              )}

              {createType === "withdrawal" && (
                <>
                  <WithdraweeFieldWithNew
                    value={form.withdrawnBy || ""}
                    onChange={(name) => setForm((f: any) => ({ ...f, withdrawnBy: name }))}
                    labelClassName="block text-sm font-medium text-gray-700 mb-1"
                    required={false}
                  />
                  {!isAfghanistanCity && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("source_of_funds")}</label>
                      <select
                        value={form.sourceType === "bank_account" && form.bankAccountId ? `bank_account:${form.bankAccountId}` : form.sourceType || "cash_office"}
                        onChange={e => {
                          const value = e.target.value;
                          if (value.startsWith("bank_account:")) {
                            setForm((f: any) => ({ ...f, sourceType: "bank_account", bankAccountId: parseInt(value.split(":")[1] || "0", 10) || 0 }));
                            return;
                          }
                          setForm((f: any) => ({ ...f, sourceType: "cash_office", bankAccountId: 0 }));
                        }}
                        className="select-field"
                      >
                        <option value="cash_office">{t("cash_from_office")}</option>
                        {cityBankAccounts.filter((account: any) => account.isActive).map((account: any) => (
                          <option key={account.id} value={`bank_account:${account.id}`}>
                            {account.bankName}{account.accountNumber ? ` · ${account.accountNumber}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {createType === "haji_transfer" && (
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {!isAfghanistanCity && (
                      <div className="min-w-0">
                        <label className="block text-sm font-medium text-gray-700 mb-1">From *</label>
                        <select
                          value={form.sourceType || "cash_office"}
                          onChange={e => setForm((f: any) => ({
                            ...f,
                            sourceType: e.target.value,
                            bankAccountId: 0,
                            chequePaymentIds: [],
                            transferType: e.target.value === "bank_transfer" ? "direct" : "from_in_hand",
                          }))}
                          className="select-field"
                        >
                          <option value="cash_office">Cash</option>
                          <option value="cheque">Cheque</option>
                          <option value="mixed_cash_cheque">Cash + Cheques</option>
                          <option value="bank_transfer">Online</option>
                        </select>
                      </div>
                    )}
                  </div>
                  {isAfghanistanCity && (
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Going to *</label>
                      {settlementOptionsLoading ? (
                        <div className="select-field text-sm text-gray-500">Loading…</div>
                      ) : settlementOptionsError ? (
                        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">{settlementOptionsError}</div>
                      ) : (
                        <select
                          value={buildSettlementTargetValue(form.settlementDestination, form.intermediaryId, form.superAdminCashAccountId)}
                          onChange={(e) => {
                            const parsed = parseSettlementTargetValue(e.target.value);
                            setForm((f: any) => ({ ...f, ...parsed }));
                          }}
                          className="select-field text-sm"
                        >
                          <option value="">Select destination…</option>
                          {settlementIntermediaries.length > 0 && (
                            <optgroup label="Intermediaries">
                              {settlementIntermediaries.map((row: any) => (
                                <option key={`i-${row.id}`} value={`intermediary:${row.id}`}>{row.name}</option>
                              ))}
                            </optgroup>
                          )}
                          {settlementCashAccounts.length > 0 && (
                            <optgroup label="Haji cash pots">
                              {settlementCashAccounts.map((row: any) => (
                                <option key={`c-${row.id}`} value={`cash:${row.id}`}>{row.bankName}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      )}
                    </div>
                  )}
                  {!isAfghanistanCity && (
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Superadmin Account *</label>
                      <select
                        value={form.superAdminDestinationAccountId || 0}
                        onChange={e => {
                          const nextId = parseInt(e.target.value, 10) || 0;
                          const account = superAdminBankAccounts.find((a: any) => a.id === nextId);
                          setForm((f: any) => ({
                            ...f,
                            superAdminDestinationAccountId: nextId,
                            transferredTo: account ? formatSuperAdminBankLabel(account) : f.transferredTo,
                          }));
                        }}
                        className="select-field"
                      >
                        <option value={0}>Select</option>
                        {superAdminBankAccounts.filter((a: any) => a.isActive).map((account: any) => (
                          <option key={account.id} value={account.id}>{formatSuperAdminBankLabel(account)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {(form.sourceType === "cheque" || form.sourceType === "mixed_cash_cheque") && !isAfghanistanCity && (
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("select_cheques")} *</label>
                      {hajiChequeOptions.length === 0 ? (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">No cheque details available for this transfer.</div>
                      ) : (
                        <div className="max-h-52 overflow-auto rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
                          {hajiChequeOptions.map((cheque: any) => {
                            const checked = selectedHajiChequeIds.includes(cheque.id);
                            const locked = cheque.chequeStatus && cheque.chequeStatus !== "in_hand";
                            const ref = cheque.chequeNumber || cheque.manualVoucherNo || String(cheque.id);
                            const symbol = cheque.currency?.symbol || cheque.currency?.code || "";
                            return (
                              <label key={cheque.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm leading-tight">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={locked}
                                  onChange={() => setForm((f: any) => {
                                    const current = Array.isArray(f.chequePaymentIds) ? f.chequePaymentIds : [];
                                    return {
                                      ...f,
                                      chequePaymentIds: current.includes(cheque.id)
                                        ? current.filter((id: number) => id !== cheque.id)
                                        : [...current, cheque.id],
                                    };
                                  })}
                                  className="shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-60"
                                />
                                <span className="min-w-0 truncate font-medium text-gray-800">{ref}</span>
                                {cheque.customer?.name && <span className="min-w-0 truncate text-gray-500">— {cheque.customer.name}</span>}
                                <span className="ml-auto shrink-0 pl-4 text-right tabular-nums font-medium text-gray-700">
                                  {symbol} {Number(cheque.amount || 0).toLocaleString("en-US")}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {form.sourceType === "bank_transfer" && !isAfghanistanCity && (
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account *</label>
                      <select
                        value={form.bankAccountId || 0}
                        onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value, 10) || 0 }))}
                        className="select-field"
                      >
                        <option value={0}>Select bank account</option>
                        {cityBankAccounts.filter((a: any) => a.isActive).map((a: any) => (
                          <option key={a.id} value={a.id}>
                            {a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""}{a.currency?.code ? ` · ${a.currency.code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${currencies.length > 1 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {form.sourceType === "mixed_cash_cheque" ? "Cash Amount" : t("amount")}{" "}
                        {form.sourceType === "cheque" ? <span className="font-normal text-gray-400">(auto)</span> : "*"}
                      </label>
                      {form.sourceType === "cheque" ? (
                        <div className="input-field bg-gray-50 tabular-nums text-gray-800">
                          {selectedHajiChequeTotal > 0 ? selectedHajiChequeTotal.toLocaleString("en-US") : "—"}
                        </div>
                      ) : (
                        <FormattedNumberInput
                          min="0.01"
                          value={form.sourceType === "mixed_cash_cheque" ? (form.cashAmount || "") : (form.amount || "")}
                          onValueChange={(value) => setForm((f: any) => form.sourceType === "mixed_cash_cheque"
                            ? ({ ...f, cashAmount: value || 0 })
                            : ({ ...f, amount: value || 0 }))}
                          className="input-field"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ref. No.</label>
                      <input
                        value={form.referenceNo || ""}
                        onChange={e => setForm((f: any) => ({ ...f, referenceNo: e.target.value }))}
                        className="input-field"
                      />
                    </div>
                    {currencies.length > 1 && (
                      <div className="min-w-0">
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")} *</label>
                        <select
                          value={form.currencyId || 0}
                          onChange={e => {
                            const currencyId = parseInt(e.target.value, 10) || 0;
                            setForm((f: any) => ({
                              ...f,
                              currencyId,
                              settlementDestination: isAfghanistanCity ? "intermediary" : f.settlementDestination,
                              intermediaryId: isAfghanistanCity ? 0 : f.intermediaryId,
                              superAdminCashAccountId: isAfghanistanCity ? 0 : f.superAdminCashAccountId,
                              superAdminDestinationAccountId: !isAfghanistanCity ? 0 : f.superAdminDestinationAccountId,
                            }));
                            if (isAfghanistanCity && currencyId) void loadSettlementOptions(currencyId);
                          }}
                          className="select-field"
                        >
                          <option value={0}>Select</option>
                          {currencies.map((currency: any) => (
                            <option key={currency.id} value={currency.id}>{formatCurrencySelectLabel(currency)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
                      <input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
                    </div>
                  </div>
                  {form.sourceType === "mixed_cash_cheque" && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">
                      Slip total: {selectedHajiCheques[0]?.currency?.symbol || selectedHajiCheques[0]?.currency?.code || ""} {(Number(form.cashAmount || 0) + selectedHajiChequeTotal).toLocaleString("en-US")}
                    </div>
                  )}
                </div>
              )}

              {createType !== "haji_transfer" && (
                <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes || ""} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
              )}
            </>
          )}
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

      {/* ── CANCEL / DELETE MODAL ─────────────────────────────────────────────── */}
      <Modal
        open={showDelete}
        onClose={() => { if (!deleteSubmitting) { setShowDelete(false); setDeleteTarget(null); setDeleteError(""); } }}
        title={deleteTarget?.type === "payment" ? t("cancel") + " payment" : t("delete")}
        size="sm"
      >
        <div className="space-y-4">
          {deleteTarget && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
              <p className="font-medium text-gray-900">{deleteTarget.person || deleteTarget.detail || TYPE_CONFIG[deleteTarget.type]?.label}</p>
              {deleteTarget.detail && deleteTarget.person && (
                <p className="text-gray-500 mt-0.5">{deleteTarget.detail}</p>
              )}
              <p className="font-semibold text-gray-800 mt-1">
                {formatCityAmount(user, deleteTarget.amount, deleteTarget.currencyCode)}
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("cancel_reason")} *</label>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="input-field"
              rows={3}
              autoFocus
              placeholder={deleteTarget?.type === "payment" ? "Why is this payment being cancelled?" : "Reason for deletion"}
            />
          </div>
          {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => { setShowDelete(false); setDeleteTarget(null); setDeleteError(""); }} className="btn-secondary text-sm" disabled={deleteSubmitting}>{t("cancel")}</button>
            <button type="button" onClick={handleDelete} disabled={deleteSubmitting} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {deleteSubmitting ? "..." : deleteTarget?.type === "payment" ? t("cancel") : t("delete")}
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
