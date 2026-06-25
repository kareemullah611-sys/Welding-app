"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, formatDate, RowActionMenu, MobileDateInput } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";
import { getEmbedQuickformPath, shouldSimplifyCityModals } from "@/lib/quickform-embed";
import Link from "next/link";
import { useOffline } from "@/hooks/useOffline";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { getPendingQueueId } from "@/lib/queue-resolve";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { formatCurrencySelectLabel } from "@/lib/city-money-format";
import {
  buildSettlementTargetValue,
  isSettlementTargetSelected,
  parseSettlementTargetValue,
} from "@/lib/haji-settlement-target";


const SOURCE_CONFIG: Record<string, { label: string; color: string; icon?: string }> = {
  cash_office:    { label: "Cash from Office", color: "bg-green-50 text-green-700" },
  cheque:         { label: "Cheque", color: "bg-blue-50 text-blue-700"  },
  bank_transfer:  { label: "Bank Transfer", color: "bg-purple-50 text-purple-700" },
  // legacy
  from_in_hand:   { label: "Cash from Office", color: "bg-green-50 text-green-700" },
  direct:         { label: "Bank Transfer", color: "bg-purple-50 text-purple-700" },
};

const PAKISTAN_HAJI_TARGET = "Super Admin Account";
const HAJI_FORM_CACHE_KEY = "mrf-haji-form-cache-v1";
const HAJI_READ_CACHE_KEY = "mrf-haji-read-cache-v1";

type HajiFormCache = {
  lots: any[];
  currencies: any[];
  bankAccounts: any[];
  inHandCheques: any[];
  settlementByCurrency?: Record<string, { intermediaries: any[]; superAdminCashAccounts: any[] }>;
};

type HajiReadSnapshot = {
  items: any[];
  totalPages: number;
  total: number;
};

function applyQueuedMutationsToHajiTransfers(baseItems: any[], queueItems: any[]) {
  if (!Array.isArray(baseItems) || !Array.isArray(queueItems) || queueItems.length === 0) return baseItems;
  let next = [...baseItems];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/haji-transfers/")) continue;
    const match = url.match(/^\/api\/v1\/haji-transfers\/([^/?#]+)/);
    const transferId = match?.[1];
    if (!transferId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== transferId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === transferId
        ? {
            ...row,
            amount: patch?.amount ?? row?.amount,
            detail: patch?.detail ?? row?.detail,
            sourceType: patch?.sourceType ?? row?.sourceType,
            transferType: patch?.transferType ?? row?.transferType,
            transferredTo: patch?.transferredTo ?? row?.transferredTo,
            notes: patch?.notes ?? row?.notes,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

export default function HajiTransfersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, enqueue, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, discardQueuedItem, syncQueue } = useOffline();
  const searchParams = useSearchParams();
  const isEmbed = useQuickformEmbed();
  const simplifyModals = shouldSimplifyCityModals(user, isEmbed);
  const shouldUseSuperAdminTarget = user?.role === "city_admin" && user?.countryName === "Pakistan";
  const isAfghanistanCity = user?.role === "city_admin" && user?.countryName === "Afghanistan";
  const isSuperAdmin = user?.role === "super_admin";
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
  const [settlementIntermediaries, setSettlementIntermediaries] = useState<any[]>([]);
  const [settlementCashAccounts, setSettlementCashAccounts] = useState<any[]>([]);
  const [settlementOptionsLoading, setSettlementOptionsLoading] = useState(false);
  const [settlementOptionsError, setSettlementOptionsError] = useState("");
  const [form, setForm] = useState<any>({
    lotId: 0, transferDate: new Date().toISOString().split("T")[0],
    amount: 0, currencyId: 0, detail: "", sourceType: "cash_office",
    settlementDestination: "intermediary", intermediaryId: 0, superAdminCashAccountId: 0,
    bankAccountId: 0, chequePaymentId: 0, chequePaymentIds: [] as number[], cashAmount: 0, transferredTo: "", notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);

  // Filters
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showSummary, setShowSummary] = useState(true);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
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

  const loadSettlementOptions = useCallback(async (currencyId: number) => {
    const canLoad = isAfghanistanCity || isSuperAdmin;
    if (!canLoad || !currencyId) {
      setSettlementIntermediaries([]);
      setSettlementCashAccounts([]);
      setSettlementOptionsError("");
      return;
    }
    setSettlementOptionsLoading(true);
    setSettlementOptionsError("");
    const r = await apiCall("/api/v1/haji-transfers/settlement-options", { params: { currencyId } });
    setSettlementOptionsLoading(false);
    if (r.success) {
      const payload = r.data as any;
      setSettlementIntermediaries(payload?.intermediaries || []);
      setSettlementCashAccounts(payload?.superAdminCashAccounts || []);
    } else {
      setSettlementIntermediaries([]);
      setSettlementCashAccounts([]);
      setSettlementOptionsError(r.error || "Failed to load settlement options");
    }
  }, [isAfghanistanCity, isSuperAdmin]);

  useEffect(() => {
    if (!showCreate || !isAfghanistanCity) return;
    const currencyId = form.currencyId || currencies[0]?.id || 0;
    if (currencyId) void loadSettlementOptions(currencyId);
  }, [showCreate, isAfghanistanCity, form.currencyId, currencies, loadSettlementOptions]);

  useEffect(() => {
    if (!showEdit) return;
    const currencyId = form.currencyId || selected?.currencyId || selected?.currency?.id || 0;
    const needsOptions =
      isAfghanistanCity ||
      selected?.settlementDestination === "intermediary" ||
      selected?.settlementDestination === "super_admin_cash";
    if (needsOptions && currencyId) void loadSettlementOptions(currencyId);
  }, [showEdit, isAfghanistanCity, form.currencyId, selected, loadSettlementOptions]);

  const load = useCallback(async () => {
    if (isEmbed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    if (filterFrom) params.date_from = filterFrom;
    if (filterTo) params.date_to = filterTo;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const r = await apiCall("/api/v1/haji-transfers", { params });
    if (r.success) {
      const pendingTransfers = queuedItems
        .filter((q) => q.pathname === "/haji-transfers" && q.method === "POST" && q.url === "/api/v1/haji-transfers")
        .map((q) => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(q.body || "{}");
          } catch {
            parsed = {};
          }
          return {
            id: `pending-${q.id}`,
            transferDate: parsed?.transferDate || new Date().toISOString().split("T")[0],
            transferredTo: parsed?.transferredTo || "",
            amount: Number(parsed?.amount || 0),
            detail: parsed?.detail || "",
            sourceType: parsed?.sourceType || "cash_office",
            _pending: true,
          };
        });
      let nextItems = [...pendingTransfers, ...((r.data as any[]) || [])];
      nextItems = applyQueuedMutationsToHajiTransfers(nextItems, queuedItems as any[]);
      setItems(nextItems);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
      writeOfflineReadSnapshot<HajiReadSnapshot>(HAJI_READ_CACHE_KEY, {
        items: nextItems,
        totalPages: (r.pagination as any)?.totalPages || 1,
        total: (r.pagination as any)?.total || 0,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<HajiReadSnapshot>(HAJI_READ_CACHE_KEY)?.data;
      if (snapshot?.items?.length) {
        const cleanedItems = pruneStalePendingRows(snapshot.items as any[], queuedItems as any[], "/haji-transfers");
        const mergedSnapshotItems = applyQueuedMutationsToHajiTransfers(cleanedItems, queuedItems as any[]);
        setItems(mergedSnapshotItems);
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || mergedSnapshotItems.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [filterFrom, filterTo, isEmbed, isOnline, page, queuedItems, searchQuery]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.synced > 0) load();
  }, [lastSyncResult, load]);
  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    setShowCreate(true);
    openCreate();
    window.history.replaceState({}, "", getEmbedQuickformPath("/haji-transfers"));
  }, [prefillHandled, searchParams, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const openCreate = async (preset?: Record<string, any>) => {
    if (!isOnline) {
      const cached = readOfflineFormCache<HajiFormCache>(HAJI_FORM_CACHE_KEY, [
        "lots",
        "currencies",
        "bankAccounts",
        "inHandCheques",
      ]);
      if (!cached) {
        setError(getOfflineFormReadinessError({
          isOnline,
          currencyCount: 0,
          moduleTitle: "Haji Transfer",
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
        transferDate: new Date().toISOString().split("T")[0],
        amount: 0,
        detail: "",
        sourceType: "cash_office",
        bankAccountId: 0,
        chequePaymentId: 0,
        chequePaymentIds: [],
        cashAmount: 0,
        transferredTo: shouldUseSuperAdminTarget ? PAKISTAN_HAJI_TARGET : "",
        notes: "",
        lotId: 0,
        settlementDestination: "intermediary",
        intermediaryId: 0,
        superAdminCashAccountId: 0,
        currencyId: cached.currencies[0]?.id || 0,
        ...preset,
      }));
      setShowCreate(true);
      setError("");
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
    const city = cR.success && user?.cityId
      ? (cR.data as any[]).find((c: any) => c.id === user.cityId)
      : null;
    const cachedCurrencies = city?.currencies || [];
    if (cachedCurrencies.length) setCurrencies(cachedCurrencies);
    const defaultCurrencyId =
      Number(preset?.currencyId) ||
      cachedCurrencies[0]?.id ||
      0;
    if (cachedCurrencies.length > 0) {
      writeOfflineFormCache<HajiFormCache>(HAJI_FORM_CACHE_KEY, {
        lots: lR.success ? (lR.data as any[]) : [],
        currencies: cachedCurrencies,
        bankAccounts: !isAfghanistanCity && baR?.success ? (baR.data as any[]) : [],
        inHandCheques: !isAfghanistanCity && chR?.success ? (chR.data as any[]) : [],
      });
    }
    if (!isAfghanistanCity && baR?.success) setBankAccounts(baR.data as any[]);
    else setBankAccounts([]);
    if (!isAfghanistanCity && chR?.success) setInHandCheques(chR.data as any[]);
    else setInHandCheques([]);
    setForm((f: any) => ({
      ...f, transferDate: new Date().toISOString().split("T")[0],
      amount: 0, detail: "", sourceType: "cash_office",
      bankAccountId: 0, chequePaymentId: 0, chequePaymentIds: [], cashAmount: 0,
      transferredTo: shouldUseSuperAdminTarget ? PAKISTAN_HAJI_TARGET : "",
      notes: "", lotId: 0,
      settlementDestination: "intermediary", intermediaryId: 0, superAdminCashAccountId: 0,
      currencyId: defaultCurrencyId,
      ...preset,
    }));
    setShowCreate(true); setError("");
    if (isAfghanistanCity && defaultCurrencyId) {
      void loadSettlementOptions(defaultCurrencyId);
    }
  };

  const handleCreate = async () => {
    if (!form.detail) { setError(t("detail") + " required"); return; }
    if (form.sourceType === "cash_office" && !form.amount) { setError(t("amount") + " required"); return; }
    if (form.sourceType === "cheque" && form.chequePaymentIds.length === 0) { setError("Please select at least one cheque"); return; }
    if (form.sourceType === "mixed_cash_cheque" && !form.cashAmount && form.chequePaymentIds.length === 0) { setError("Enter a cash amount or select at least one cheque"); return; }
    if (form.sourceType === "bank_transfer" && !form.bankAccountId) { setError("Please select a bank account"); return; }
    if (isAfghanistanCity) {
      const target = buildSettlementTargetValue(
        form.settlementDestination,
        form.intermediaryId,
        form.superAdminCashAccountId,
      );
      if (!isSettlementTargetSelected(target)) {
        setError("Please select where funds are going");
        return;
      }
    }

    const resolvedCurrencyId = form.currencyId || currencies[0]?.id || 0;
    if (!resolvedCurrencyId) {
      setError(getOfflineFormReadinessError({
        isOnline,
        currencyCount: currencies.length,
        moduleTitle: "Haji Transfer",
      }) || "Currency setup missing");
      return;
    }

    let body: any;
    if (form.sourceType === "mixed_cash_cheque" || form.sourceType === "cheque") {
      body = {
        sourceType: form.sourceType === "cheque" ? "mixed_cash_cheque" : form.sourceType,
        transferDate: form.transferDate,
        detail: form.detail,
        transferredTo: form.transferredTo || undefined,
        notes: form.notes || undefined,
        lotId: form.lotId || undefined,
        currencyId: resolvedCurrencyId || undefined,
        cashAmount: form.sourceType === "mixed_cash_cheque" ? Number(form.cashAmount || 0) : 0,
        chequePaymentIds: form.chequePaymentIds,
      };
    } else {
      body = {
        ...form,
        currencyId: resolvedCurrencyId,
        sourceType: isAfghanistanCity ? "cash_office" : form.sourceType,
        transferType: "from_in_hand",
      };
      if (isAfghanistanCity) {
        body.settlementDestination = form.settlementDestination;
        body.intermediaryId = form.settlementDestination === "intermediary" ? Number(form.intermediaryId) : undefined;
        body.superAdminCashAccountId = form.settlementDestination === "super_admin_cash" ? Number(form.superAdminCashAccountId) : undefined;
      }
      if (!body.lotId) delete body.lotId;
      if (!body.transferredTo) delete body.transferredTo;
      if (body.sourceType !== "bank_transfer") delete body.bankAccountId;
      delete body.chequePaymentIds;
      delete body.cashAmount;
      delete body.chequePaymentId;
      if (body.sourceType === "cash_office") body.amount = Number(form.amount || 0);
    }

    const optimisticAmount =
      form.sourceType === "mixed_cash_cheque" || form.sourceType === "cheque"
        ? mixedSlipTotal
        : Number(form.amount || 0);

    if (resolvingQueueId) {
      const updateOk = await updateQueuedItem(resolvingQueueId, { body: JSON.stringify(body) });
      if (!updateOk) {
        setError("Queued entry was not found. Please retry from Activity.");
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

    if (!isOnline) {
      const queueId = await enqueue({
        url: "/api/v1/haji-transfers",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/haji-transfers",
        auditMeta: {
          action: "create",
          entityType: "haji_transfer",
          entityLabel: "Haji Transfer (Pending)",
          entityDetail: `${form.detail} — ${Number(optimisticAmount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => [{
        id: `pending-${queueId}`,
        transferDate: form.transferDate,
        amount: optimisticAmount,
        detail: form.detail,
        sourceType: form.sourceType,
        transferredTo: form.transferredTo || null,
        lot: form.lotId ? lots.find((l: any) => l.id === form.lotId) : null,
        _pending: true,
      }, ...prev]);
      setShowCreate(false);
      setResolvingQueueId(null);
      if (isEmbed) closeEmbed();
      return;
    }

    setSubmitting(true);
    const r = await apiCall("/api/v1/haji-transfers", { method: "POST", body });
    if (r.success) {
      setResolvingQueueId(null);
      setShowCreate(false); if (isEmbed) closeEmbed(); load();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId) return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/haji-transfers");
    if (!target) return;
    try {
      const parsed = JSON.parse(target.body || "{}");
      openCreate(parsed);
      setResolvingQueueId(queueId);
      setError("Resolving queued transfer. Save to update and re-sync.");
      window.history.replaceState({}, "", getEmbedQuickformPath("/haji-transfers"));
    } catch {
      // ignore malformed queued payload
    }
  }, [isEmbed, queuedItems, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (item: any) => {
    setSelected(item);
    let sourceType = item.sourceType || (
      item.transferType === "direct" ? "bank_transfer" :
      item.transferType === "from_in_hand" ? "cash_office" : "cash_office"
    );
    setForm({
      lotId: item.lotId, transferDate: item.transferDate, amount: item.amount,
      currencyId: item.currencyId || item.currency?.id || 0, detail: item.detail,
      sourceType, transferType: item.transferType || "from_in_hand",
      settlementDestination: item.settlementDestination === "super_admin_cash" ? "super_admin_cash" : "intermediary",
      intermediaryId: item.intermediaryId || 0,
      superAdminCashAccountId: item.superAdminCashAccountId || 0,
      bankAccountId: item.bankAccountId || 0, chequePaymentId: item.chequePaymentId || 0,
      transferredTo: item.transferredTo || "", notes: item.notes || "",
    });
    if (isAfghanistanCity || item.settlementDestination === "intermediary" || item.settlementDestination === "super_admin_cash") {
      void loadSettlementOptions(item.currencyId || item.currency?.id || 0);
    }
    setShowEdit(true); setError("");
  };

  const toggleHajiAudit = async (item: any, confirmed: boolean) => {
    const r = await apiCall(`/api/v1/haji-transfers/${item.id}`, {
      method: "PUT",
      body: { action: "set_haji_audit", confirmed },
    });
    if (r.success) load();
    else setError(r.error || "Failed to update audit confirmation");
  };

  const handleEdit = async () => {
    if (isAfghanistanCity) {
      const target = buildSettlementTargetValue(
        form.settlementDestination,
        form.intermediaryId,
        form.superAdminCashAccountId,
      );
      if (!isSettlementTargetSelected(target)) {
        setError("Please select where funds are going");
        return;
      }
    }
    const body: any = {
      amount: form.amount, detail: form.detail,
      sourceType: form.sourceType,
      transferType: form.sourceType === "cash_office" ? "from_in_hand" : form.sourceType === "bank_transfer" ? "direct" : "from_in_hand",
      transferredTo: form.transferredTo || null, notes: form.notes,
    };
    if (selected?.settlementDestination === "intermediary" || selected?.settlementDestination === "super_admin_cash" || isAfghanistanCity) {
      body.settlementDestination = form.settlementDestination;
      body.intermediaryId = form.settlementDestination === "intermediary" ? Number(form.intermediaryId) : null;
      body.superAdminCashAccountId = form.settlementDestination === "super_admin_cash" ? Number(form.superAdminCashAccountId) : null;
    }
    if (form.sourceType === "bank_transfer" && form.bankAccountId) body.bankAccountId = form.bankAccountId;
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(selected?.id);
      if (pendingQueueId) {
        const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(body) });
        if (!ok) {
          setError("Queued transfer was not found. Please retry from Activity.");
          return;
        }
        setItems((prev) =>
          prev.map((row: any) =>
            row.id === selected.id
              ? {
                  ...row,
                  amount: form.amount,
                  detail: form.detail,
                  sourceType: form.sourceType,
                  transferType: body.transferType,
                  transferredTo: form.transferredTo || null,
                  notes: form.notes || null,
                }
              : row
          )
        );
        setShowEdit(false);
        return;
      }
      await enqueue({
        url: `/api/v1/haji-transfers/${selected.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/haji-transfers",
        auditMeta: {
          action: "edit",
          entityType: "haji_transfer",
          entityLabel: "Haji Transfer Edit (Pending)",
          entityDetail: `${form.detail} — ${Number(form.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) =>
        prev.map((row: any) =>
          row.id === selected.id
            ? {
                ...row,
                amount: form.amount,
                detail: form.detail,
                sourceType: form.sourceType,
                transferType: body.transferType,
                transferredTo: form.transferredTo || null,
                notes: form.notes || null,
              }
            : row
        )
      );
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/haji-transfers/${selected.id}`, { method: "PUT", body });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`${t("confirm_delete")} "${item.detail}"?`)) return;
    if (!isOnline) {
      const pendingQueueId = getPendingQueueId(item?.id);
      if (pendingQueueId) {
        await discardQueuedItem(pendingQueueId);
        setItems((prev) => prev.filter((row: any) => row.id !== item.id));
        return;
      }
      await enqueue({
        url: `/api/v1/haji-transfers/${item.id}`,
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "",
        pathname: "/haji-transfers",
        auditMeta: {
          action: "delete",
          entityType: "haji_transfer",
          entityLabel: "Haji Transfer Delete (Pending)",
          entityDetail: `${item.detail} — ${Number(item.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => prev.filter((row: any) => row.id !== item.id));
      return;
    }
    await apiCall(`/api/v1/haji-transfers/${item.id}`, { method: "DELETE" });
    load();
  };

  const getSourceType = (tr: any) => tr.sourceType || (tr.transferType === "direct" ? "bank_transfer" : "cash_office");

  if (user?.role === "super_admin" && !isEmbed) {
    return (
      <div>
        <PageHeader title={t("haji_transfers")} />
        <div className="rounded-xl border border-[#d4d4d8] bg-[#f4f4f5]/90 p-5">
          <p className="text-sm font-semibold text-[#2A0608]">Use Payments as the single settlement module</p>
          <p className="mt-1 text-sm text-[#52525b]">
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

  const renderGoingToSelect = () => {
    const selectedValue = buildSettlementTargetValue(
      form.settlementDestination,
      form.intermediaryId,
      form.superAdminCashAccountId,
    );
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Going to *</label>
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
            value={selectedValue}
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
    );
  };

  return (
    <div className={isEmbed ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {!isEmbed && <PageHeader
        title={t("haji_transfers")}
        action={user?.role === "city_admin" ? (
          <div className="flex flex-wrap items-center gap-2">
            <MobileDateInput variant="filter" value={filterFrom} onChange={setFilterFrom} placeholder="From" aria-label="From date" />
            <MobileDateInput variant="filter" value={filterTo} onChange={setFilterTo} placeholder="To" aria-label="To date" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <MobileDateInput variant="filter" value={filterFrom} onChange={setFilterFrom} placeholder="From" aria-label="From date" />
            <MobileDateInput variant="filter" value={filterTo} onChange={setFilterTo} placeholder="To" aria-label="To date" />
          </div>
        )}
      />}
      {!isEmbed && showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached haji transfer data for this device.
        </div>
      )}

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
        columns={[
        { key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) },
        {
          key: "detail", label: t("detail"),
          render: (tr: any) => (
            <div>
              <span>{tr.detail}</span>
              {tr.transferredTo && <p className="text-xs text-blue-600 mt-0.5">→ {tr.transferredTo}</p>}
              {tr.hajiAudit?.confirmed && <p className="text-xs text-emerald-700 mt-0.5">✓ Audit confirmed</p>}
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
            return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>;
          },
        },
        { key: "lotNumber", label: t("lot"), render: (tr: any) => tr.lot?.lotNumber || tr.lotNumber || "-" },
        {
          key: "actions", label: "",
          render: (tr: any) => {
            const auditLocked = !!tr.hajiAudit?.confirmed;
            const auditEligible = tr.settlementDestination === "intermediary" || tr.settlementDestination === "super_admin_cash";
            return (
            (user?.role === "city_admin" || user?.role === "super_admin") && tr.recordType !== "customer_payment" ? (
              <RowActionMenu
                open={openActionId === tr.id}
                onOpenChange={(open) => setOpenActionId(open ? tr.id : null)}
              >
                {isSuperAdmin && auditEligible && (
                  <button
                    onClick={() => { setOpenActionId(null); void toggleHajiAudit(tr, !tr.hajiAudit?.confirmed); }}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-emerald-700 hover:bg-emerald-50 sm:py-2 sm:text-xs"
                  >
                    {tr.hajiAudit?.confirmed ? "Unconfirm audit" : "Confirm audit"}
                  </button>
                )}
                {!auditLocked && (
                  <>
                    <button onClick={() => { setOpenActionId(null); openEdit(tr); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("edit")}</button>
                    <button onClick={() => { setOpenActionId(null); handleDelete(tr); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("delete")}</button>
                  </>
                )}
              </RowActionMenu>
            ) : null
            );
          },
        },
      ]} data={items} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />}

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("record_haji_transfer")} size="md" inline={isEmbed} hideHeader={isEmbed}>
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isAfghanistanCity ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("date")} *</label>
                  <MobileDateInput value={form.transferDate} onChange={(transferDate) => setForm((f: any) => ({ ...f, transferDate }))} placeholder={t("date")} />
                </div>
                {renderGoingToSelect()}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("detail")} *</label>
                <input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("amount")} *</label>
                  <input
                    type="number"
                    value={form.amount || ""}
                    onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                    className="input-field"
                    onWheel={e => e.currentTarget.blur()}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("currency")} *</label>
                  <select
                    value={form.currencyId || 0}
                    onChange={e => {
                      const nextCurrencyId = parseInt(e.target.value, 10) || 0;
                      setForm((f: any) => ({
                        ...f,
                        currencyId: nextCurrencyId,
                        settlementDestination: "intermediary",
                        intermediaryId: 0,
                        superAdminCashAccountId: 0,
                      }));
                      if (nextCurrencyId) void loadSettlementOptions(nextCurrencyId);
                    }}
                    className="select-field"
                  >
                    <option value={0}>— Select currency —</option>
                    {currencies.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {formatCurrencySelectLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("lot")}</label>
                  <select value={form.lotId} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                    <option value={0}>{t("auto_fifo")}</option>
                    {lots.filter((l: any) => l.status === "ongoing" || !l.status).map(l => (
                      <option key={l.id} value={l.id}>{l.lotNumber}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
              <MobileDateInput value={form.transferDate} onChange={(transferDate) => setForm((f: any) => ({ ...f, transferDate }))} placeholder={t("date")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("source_of_funds")} *</label>
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
                <option value="cash_office">{t("cash_from_office")}</option>
                <option value="cheque">{t("cheque")}</option>
                <option value="mixed_cash_cheque">Cash + Cheques</option>
                <option value="bank_transfer">{t("bank_transfer")}</option>
              </select>
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
              {form.chequePaymentIds.length > 0 && !simplifyModals && (
                <div className="mt-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                  {form.chequePaymentIds.length} selected · {selectedCheques[0]?.currency?.symbol || selectedCheques[0]?.currency?.code || ""} {formatNumber(selectedChequeTotal)}
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

          {!shouldUseSuperAdminTarget && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transferred To</label>
            <input
              value={form.transferredTo}
              onChange={e => setForm((f: any) => ({ ...f, transferredTo: e.target.value }))}
              className="input-field"
              placeholder="Person or account name"
            />
          </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")} *</label>
              <select
                value={form.currencyId || 0}
                onChange={e => {
                  const nextCurrencyId = parseInt(e.target.value, 10) || 0;
                  setForm((f: any) => ({ ...f, currencyId: nextCurrencyId }));
                }}
                className="select-field"
              >
                <option value={0}>— Select currency —</option>
                {currencies.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {formatCurrencySelectLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label>
              <select value={form.lotId} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("auto_fifo")}</option>
                {lots.filter((l: any) => l.status === "ongoing" || !l.status).map(l => (
                  <option key={l.id} value={l.id}>{l.lotNumber}</option>
                ))}
              </select>
            </div>
          </div>

          {form.sourceType === "mixed_cash_cheque" && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-700">
              Slip total: {selectedCheques[0]?.currency?.symbol || selectedCheques[0]?.currency?.code || ""} {formatNumber(mixedSlipTotal)}
            </div>
          )}
            </>
          )}

          {!isEmbed && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
          )}

        </div>
        <div className={isEmbed ? "quickform-footer" : "flex justify-end gap-3 pt-4 mt-4 border-t"}>
          <button
            onClick={handleCreate}
            disabled={submitting}
            className={isEmbed ? "glass-btn glass-btn-primary w-full min-h-11 disabled:opacity-60" : "btn-primary text-sm"}
          >
            {submitting ? "Saving…" : t("record")}
          </button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {!isAfghanistanCity && (
          <div className="p-2 bg-gray-50 border rounded text-xs text-gray-600">
            {t("source_of_funds")}: <strong>{SOURCE_CONFIG[form.sourceType]?.label || form.sourceType}</strong> (cannot change after creation)
          </div>
          )}
          {isAfghanistanCity ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("date")}</label>
                  <MobileDateInput value={form.transferDate} onChange={(transferDate) => setForm((f: any) => ({ ...f, transferDate }))} placeholder={t("date")} />
                </div>
                {renderGoingToSelect()}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t("detail")}</label>
                <input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("amount")}</label>
                  <input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("currency")}</label>
                  <div className="input-field bg-gray-50 text-gray-700">
                    {selected?.currency?.code || currencies.find((c: any) => c.id === form.currencyId)?.code || "—"}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{t("lot")}</label>
                  <div className="input-field bg-gray-50 text-gray-700">
                    {selected?.lot?.lotNumber || selected?.lotNumber || t("auto_fifo")}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
          {!shouldUseSuperAdminTarget && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transferred To</label>
            <input
              value={form.transferredTo}
              onChange={e => setForm((f: any) => ({ ...f, transferredTo: e.target.value }))}
              className="input-field"
              placeholder="Person or account name"
            />
          </div>
          )}
          {(selected?.settlementDestination === "intermediary" || selected?.settlementDestination === "super_admin_cash") && (
          <div className="space-y-3 rounded-lg border border-[#e4e4e7] bg-[#fafafa] p-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Settlement destination *</label>
              <select
                value={form.settlementDestination}
                onChange={e => setForm((f: any) => ({
                  ...f,
                  settlementDestination: e.target.value,
                  intermediaryId: 0,
                  superAdminCashAccountId: 0,
                }))}
                className="select-field"
              >
                <option value="intermediary">Intermediary</option>
                <option value="super_admin_cash">Super Admin cash account</option>
              </select>
            </div>
            {form.settlementDestination === "intermediary" ? (
              <select
                value={form.intermediaryId || 0}
                onChange={e => setForm((f: any) => ({ ...f, intermediaryId: parseInt(e.target.value) || 0 }))}
                className="select-field"
              >
                <option value={0}>Select intermediary…</option>
                {settlementIntermediaries.map((row: any) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            ) : (
              <select
                value={form.superAdminCashAccountId || 0}
                onChange={e => setForm((f: any) => ({ ...f, superAdminCashAccountId: parseInt(e.target.value) || 0 }))}
                className="select-field"
              >
                <option value={0}>Select cash account…</option>
                {settlementCashAccounts.map((row: any) => (
                  <option key={row.id} value={row.id}>{row.bankName}</option>
                ))}
              </select>
            )}
          </div>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
          </div>
            </>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

    </div>
  );
}
