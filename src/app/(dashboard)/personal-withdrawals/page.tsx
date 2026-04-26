"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";
import { useOffline } from "@/hooks/useOffline";
import { readOfflineFormCache, writeOfflineFormCache } from "@/lib/offline-form-cache";
import { getOfflineFormReadinessError } from "@/lib/offline-readiness";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

const WITHDRAWALS_FORM_CACHE_KEY = "mrf-withdrawals-form-cache-v1";
const WITHDRAWALS_READ_CACHE_KEY = "mrf-withdrawals-read-cache-v1";

type WithdrawalsFormCache = {
  currencies: any[];
  inHandCheques: any[];
  withdraweeOptions: string[];
};

type WithdrawalsReadSnapshot = {
  items: any[];
  counts: { all: number; pending: number; approved: number };
  totalPages: number;
  total: number;
};

export default function PersonalWithdrawalsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, enqueue, lastSyncResult, queuedItems, updateQueuedItem, retryQueuedItem, syncQueue } = useOffline();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const isAfghanistanCity = user?.role === "city_admin" && user?.countryName === "Afghanistan";
  const [items, setItems] = useState<any[]>([]);
  const [counts, setCounts] = useState({ all: 0, pending: 0, approved: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved">(user?.role === "super_admin" ? "pending" : "all");
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [inHandCheques, setInHandCheques] = useState<any[]>([]);
  const [form, setForm] = useState({ withdrawalDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", withdrawnBy: "", notes: "", currencyId: 0, sourceType: "cash_office", chequePaymentId: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [withdraweeSearch, setWithdraweeSearch] = useState("");
  const [withdraweeOptions, setWithdraweeOptions] = useState<string[]>([]);
  const [showWithdraweeMenu, setShowWithdraweeMenu] = useState(false);
  const withdraweeMenuRef = useRef<HTMLDivElement | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");
  const [prefillHandled, setPrefillHandled] = useState(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  const normalizeWithdraweeName = (value: string) => value.trim().replace(/\s+/g, " ");

  const selectWithdrawee = useCallback((name: string) => {
    const normalized = normalizeWithdraweeName(name);
    setForm((f) => ({ ...f, withdrawnBy: normalized }));
    setWithdraweeSearch(normalized);
    setShowWithdraweeMenu(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    if (statusFilter !== "all") params.approval_status = statusFilter;
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const countParams: any = normalizedQuery.length >= 2 ? { q: normalizedQuery } : {};
    const [result, allCountRes, pendingCountRes, approvedCountRes] = await Promise.all([
      apiCall("/api/v1/personal-withdrawals", { params }),
      apiCall("/api/v1/personal-withdrawals", { params: { page: 1, limit: 1, ...countParams } }),
      apiCall("/api/v1/personal-withdrawals", { params: { page: 1, limit: 1, approval_status: "pending", ...countParams } }),
      apiCall("/api/v1/personal-withdrawals", { params: { page: 1, limit: 1, approval_status: "approved", ...countParams } }),
    ]);
    if (result.success) {
      setItems(result.data as any[]);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
      const nextCounts = {
        all: (allCountRes.pagination as any)?.total || 0,
        pending: (pendingCountRes.pagination as any)?.total || 0,
        approved: (approvedCountRes.pagination as any)?.total || 0,
      };
      setCounts(nextCounts);
      writeOfflineReadSnapshot<WithdrawalsReadSnapshot>(WITHDRAWALS_READ_CACHE_KEY, {
        items: result.data as any[],
        counts: nextCounts,
        totalPages: (result.pagination as any)?.totalPages || 1,
        total: (result.pagination as any)?.total || 0,
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<WithdrawalsReadSnapshot>(WITHDRAWALS_READ_CACHE_KEY)?.data;
      if (snapshot?.items?.length) {
        setItems(snapshot.items);
        setCounts(snapshot.counts || { all: 0, pending: 0, approved: 0 });
        setTotalPages(snapshot.totalPages || 1);
        setTotal(snapshot.total || 0);
        setShowOfflineSnapshot(true);
      }
    } else {
      setCounts({
        all: (allCountRes.pagination as any)?.total || 0,
        pending: (pendingCountRes.pagination as any)?.total || 0,
        approved: (approvedCountRes.pagination as any)?.total || 0,
      });
    }
    setLoading(false);
  }, [isOnline, page, searchQuery, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (lastSyncResult && lastSyncResult.synced > 0) load();
  }, [lastSyncResult, load]);
  useEffect(() => { setPage(1); }, [searchQuery]);
  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    openCreate();
    window.history.replaceState({}, "", isEmbed ? "/personal-withdrawals?embed=1" : "/personal-withdrawals");
  }, [prefillHandled, searchParams, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setStatusFilter(user?.role === "super_admin" ? "pending" : "all");
  }, [user?.role]);

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

  useEffect(() => {
    if (!showWithdraweeMenu) return;
    const handleOutside = (event: MouseEvent) => {
      if (withdraweeMenuRef.current && !withdraweeMenuRef.current.contains(event.target as Node)) {
        setShowWithdraweeMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showWithdraweeMenu]);

  const openCreate = async (preset?: Record<string, any>) => {
    if (!isOnline) {
      const cached = readOfflineFormCache<WithdrawalsFormCache>(WITHDRAWALS_FORM_CACHE_KEY, [
        "currencies",
        "inHandCheques",
        "withdraweeOptions",
      ]);
      if (!cached) {
        setFormError(getOfflineFormReadinessError({
          isOnline,
          currencyCount: 0,
          moduleTitle: "Withdrawal",
        }) || "Offline setup missing");
        setShowCreate(true);
        return;
      }
      setCurrencies(cached.currencies);
      setInHandCheques(cached.inHandCheques);
      setWithdraweeOptions(cached.withdraweeOptions);
      const nextWithdrawnBy = (preset?.withdrawnBy as string) || "";
      setForm((f) => ({
        ...f,
        withdrawalDate: new Date().toISOString().split("T")[0],
        amount: 0,
        detail: "",
        withdrawnBy: "",
        notes: "",
        sourceType: "cash_office",
        chequePaymentId: 0,
        currencyId: cached.currencies[0]?.id || 0,
        ...preset,
      }));
      setWithdraweeSearch(nextWithdrawnBy);
      setShowWithdraweeMenu(false);
      setShowCreate(true);
      setFormError("");
      return;
    }

    const requests: Promise<any>[] = [apiCall("/api/v1/cities")];
    requests.push(apiCall("/api/v1/personal-withdrawals/names"));
    if (!isAfghanistanCity) {
      requests.push(apiCall("/api/v1/payments", {
        params: { all: 1, status: "active", payment_method: "cheque", destination: "our_account", cheque_status: "in_hand" },
      }));
    }
    const [cityRes, nameRes, chequeRes] = await Promise.all(requests);
    if (cityRes.success && user?.cityId) {
      const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { setCurrencies(city.currencies); setForm((f) => ({ ...f, currencyId: city.currencies[0].id })); }
    }
    if (nameRes?.success) setWithdraweeOptions((nameRes.data as string[]) || []);
    else setWithdraweeOptions([]);
    if (!isAfghanistanCity && chequeRes?.success) setInHandCheques(chequeRes.data as any[]);
    else setInHandCheques([]);
    const cachedCurrencies = cityRes.success && user?.cityId
      ? (((cityRes.data as any[]).find((c: any) => c.id === user.cityId)?.currencies) || [])
      : [];
    if (cachedCurrencies.length > 0) {
      writeOfflineFormCache<WithdrawalsFormCache>(WITHDRAWALS_FORM_CACHE_KEY, {
        currencies: cachedCurrencies,
        inHandCheques: !isAfghanistanCity && chequeRes?.success ? (chequeRes.data as any[]) : [],
        withdraweeOptions: nameRes?.success ? ((nameRes.data as string[]) || []) : [],
      });
    }
    const nextWithdrawnBy = (preset?.withdrawnBy as string) || "";
    setForm((f) => ({ ...f, withdrawalDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", withdrawnBy: "", notes: "", sourceType: "cash_office", chequePaymentId: 0, ...preset }));
    setWithdraweeSearch(nextWithdrawnBy);
    setShowWithdraweeMenu(false);
    setShowCreate(true); setFormError("");
  };

  const handleCreate = async () => {
    if (!form.amount || !form.detail) { setFormError(t("amount") + " " + t("and") + " " + t("detail") + " required"); return; }
    if (!normalizeWithdraweeName(form.withdrawnBy)) { setFormError("Withdrawn By is required"); return; }
    if (form.sourceType === "cheque" && !form.chequePaymentId) { setFormError("Please select a cheque"); return; }

    const resolvedCurrencyId = form.currencyId || currencies[0]?.id || 0;
    if (!resolvedCurrencyId) {
      setFormError(getOfflineFormReadinessError({
        isOnline,
        currencyCount: currencies.length,
        moduleTitle: "Withdrawal",
      }) || "Currency setup missing");
      return;
    }

    const payload = {
      ...form,
      withdrawnBy: normalizeWithdraweeName(form.withdrawnBy),
      currencyId: resolvedCurrencyId,
    };

    if (resolvingQueueId) {
      const updateOk = await updateQueuedItem(resolvingQueueId, { body: JSON.stringify(payload) });
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

    if (!isOnline) {
      await enqueue({
        url: "/api/v1/personal-withdrawals",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        pathname: "/personal-withdrawals",
        auditMeta: {
          action: "create",
          entityType: "personal_withdrawal",
          entityLabel: "Withdrawal (Pending)",
          entityDetail: `${payload.withdrawnBy} — ${Number(payload.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => [{
        id: `pending-${Date.now()}`,
        withdrawalDate: form.withdrawalDate,
        amount: form.amount,
        detail: form.detail,
        withdrawnBy: payload.withdrawnBy,
        notes: form.notes || null,
        sourceType: form.sourceType,
        approvedAt: null,
        _pending: true,
      }, ...prev]);
      setShowCreate(false);
      if (isEmbed) closeEmbed();
      return;
    }

    setSubmitting(true);
    const result = await apiCall("/api/v1/personal-withdrawals", {
      method: "POST",
      body: payload,
    });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); if (isEmbed) closeEmbed(); load(); } else { setFormError(result.error || "Failed"); }
  };

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId) return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/personal-withdrawals");
    if (!target) return;
    try {
      const parsed = JSON.parse(target.body || "{}");
      openCreate(parsed);
      setResolvingQueueId(queueId);
      setFormError("Resolving queued withdrawal. Save to update and re-sync.");
      window.history.replaceState({}, "", isEmbed ? "/personal-withdrawals?embed=1" : "/personal-withdrawals");
    } catch {
      // ignore malformed queued payload
    }
  }, [isEmbed, queuedItems, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (w: any) => {
    setSelected(w);
    setForm({ withdrawalDate: w.withdrawalDate, amount: w.amount, detail: w.detail, withdrawnBy: w.withdrawnBy || "", notes: w.notes || "", currencyId: 0, sourceType: w.sourceType || "cash_office", chequePaymentId: w.chequePaymentId || 0 });
    setShowEdit(true); setFormError("");
  };

  const handleEdit = async () => {
    const body = { amount: form.amount, detail: form.detail, withdrawnBy: form.withdrawnBy, notes: form.notes };
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/personal-withdrawals/${selected.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        pathname: "/personal-withdrawals",
        auditMeta: {
          action: "edit",
          entityType: "personal_withdrawal",
          entityLabel: "Withdrawal Edit (Pending)",
          entityDetail: `${form.withdrawnBy || form.detail} — ${Number(form.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) =>
        prev.map((row: any) =>
          row.id === selected.id
            ? {
                ...row,
                amount: form.amount,
                detail: form.detail,
                withdrawnBy: form.withdrawnBy,
                notes: form.notes,
                _pending: true,
              }
            : row
        )
      );
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/personal-withdrawals/${selected.id}`, {
      method: "PUT",
      body,
    });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const handleDelete = async (w: any) => {
    if (!confirm(`${t("confirm_delete")} "${w.detail}"?`)) return;
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/personal-withdrawals/${w.id}`,
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "",
        pathname: "/personal-withdrawals",
        auditMeta: {
          action: "delete",
          entityType: "personal_withdrawal",
          entityLabel: "Withdrawal Delete (Pending)",
          entityDetail: `${w.withdrawnBy || w.detail} — ${Number(w.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) => prev.filter((row: any) => row.id !== w.id));
      return;
    }
    await apiCall(`/api/v1/personal-withdrawals/${w.id}`, { method: "DELETE" });
    load();
  };

  const handleApprove = async (w: any) => {
    const label = w.withdrawnBy ? `"${w.withdrawnBy}"` : `"${w.detail}"`;
    if (!confirm(`Approve withdrawal of ${w.currency?.symbol} ${w.amount?.toLocaleString("en-US")} by ${label}?\n\nThis will create a Haji Transfer automatically.`)) return;
    if (!isOnline) {
      await enqueue({
        url: `/api/v1/personal-withdrawals/${w.id}/approve`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
        pathname: "/personal-withdrawals",
        auditMeta: {
          action: "approve",
          entityType: "personal_withdrawal",
          entityLabel: "Withdrawal Approval (Pending)",
          entityDetail: `${w.withdrawnBy || w.detail} — ${Number(w.amount || 0).toLocaleString("en-US")}`,
        },
      });
      setItems((prev) =>
        prev.map((row: any) =>
          row.id === w.id
            ? {
                ...row,
                approvedAt: new Date().toISOString(),
                approvedBy: row.approvedBy || { fullName: user?.fullName || "Super Admin" },
                _pending: true,
              }
            : row
        )
      );
      return;
    }
    setApprovingId(w.id);
    const result = await apiCall(`/api/v1/personal-withdrawals/${w.id}/approve`, { method: "POST" });
    setApprovingId(null);
    if (result.success) { load(); } else { alert(result.error || "Approval failed"); }
  };

  // Summary of pending withdrawals grouped by person
  const pendingItems = items.filter((w) => !w.approvedAt);
  const approvedItems = items.filter((w) => !!w.approvedAt);
  const personTotals = pendingItems.reduce((acc: Record<string, number>, w) => {
    const name = w.withdrawnBy || "—";
    acc[name] = (acc[name] || 0) + Number(w.amount);
    return acc;
  }, {});
  const normalizedWithdraweeSearch = normalizeWithdraweeName(withdraweeSearch).toLowerCase();
  const filteredWithdrawees = withdraweeOptions
    .filter((name) => name.toLowerCase().includes(normalizedWithdraweeSearch))
    .slice(0, 8);
  const canAddWithdrawee =
    normalizedWithdraweeSearch.length > 0 &&
    !withdraweeOptions.some((name) => name.toLowerCase() === normalizedWithdraweeSearch);
  const addWithdrawee = () => {
    const normalized = normalizeWithdraweeName(withdraweeSearch);
    if (!normalized) return;
    setWithdraweeOptions((prev) => [normalized, ...prev.filter((name) => name.toLowerCase() !== normalized.toLowerCase())]);
    selectWithdrawee(normalized);
  };

  return (
    <div>
      {!isEmbed && <PageHeader
        title={t("personal_withdrawals")}
        subtitle={`${total} ${t("records").toLowerCase()}`}
      />}
      {!isEmbed && showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached withdrawals data for this device.
        </div>
      )}

      {!isEmbed && <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter("all")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${statusFilter === "all" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"}`}
        >
          All ({counts.all})
        </button>
        <button
          onClick={() => setStatusFilter("pending")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${statusFilter === "pending" ? "bg-amber-600 text-white border-amber-600" : "bg-white text-amber-700 border-amber-200"}`}
        >
          Pending ({counts.pending})
        </button>
        <button
          onClick={() => setStatusFilter("approved")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${statusFilter === "approved" ? "bg-green-600 text-white border-green-600" : "bg-white text-green-700 border-green-200"}`}
        >
          Approved ({counts.approved})
        </button>
      </div>}

      {/* Pending approvals summary for super admin */}
      {!isEmbed && user?.role === "super_admin" && pendingItems.length > 0 && (
        <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-xl">
          <p className="text-sm font-semibold text-orange-800 mb-2">⏳ Pending Approval — {pendingItems.length} withdrawal(s)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(personTotals).map(([name, tot]) => (
              <span key={name} className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full font-medium">
                {name}: {formatNumber(tot)}
              </span>
            ))}
          </div>
        </div>
      )}

      {!isEmbed && <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        searchPlaceholder="Search withdrawals (min 2 chars)"
        columns={[
          { key: "withdrawalDate", label: t("date"), render: (w: any) => formatDate(w.withdrawalDate) },
          {
            key: "withdrawnBy",
            label: "Withdrawn By",
            render: (w: any) => (
              <div>
                <span className="font-medium text-gray-800">{w.withdrawnBy || <span className="text-gray-400 italic text-xs">not specified</span>}</span>
                <p className="text-xs text-gray-500 mt-0.5">{w.detail}</p>
              </div>
            ),
          },
          {
            key: "amount",
            label: t("amount"),
            render: (w: any) => <span className="font-medium text-red-600">{w.currency?.symbol} {w.amount?.toLocaleString("en-US")}</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (w: any) => w.approvedAt ? (
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
                  ✓ Approved
                </span>
                <p className="text-xs text-gray-400 mt-0.5">by {w.approvedBy?.fullName}</p>
              </div>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                {w._pending ? "syncing…" : "⏳ Pending"}
              </span>
            ),
          },
          {
            key: "sourceType",
            label: "Source",
            render: (w: any) => (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
                w.sourceType === "cheque"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}>
                {w.sourceType === "cheque" ? "🧾 Cheque in Hand" : "💵 Cash from Office"}
              </span>
            ),
          },
          { key: "notes", label: t("notes"), render: (w: any) => w.notes || "-" },
          {
            key: "actions",
            label: "",
            render: (w: any) => (
              <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-action-menu-root="true">
                <button
                  type="button"
                  onPointerDown={(event) => { event.stopPropagation(); }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActionMenuDirection("down");
                    setOpenActionId((current) => current === w.id ? null : w.id);
                  }}
                  className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
                >
                  ⋯
                </button>
                {openActionId === w.id && (
                  <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                    {!w.approvedAt && !w._pending && (
                      <>
                        <button
                          onClick={() => { setOpenActionId(null); openEdit(w); }}
                          className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50"
                        >
                          {t("edit")}
                        </button>
                        {user?.role === "super_admin" && (
                          <button
                            onClick={() => { setOpenActionId(null); handleApprove(w); }}
                            disabled={approvingId === w.id}
                            className="w-full rounded-lg px-3 py-2 text-left text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                          >
                            {approvingId === w.id ? "Approving..." : "Approve"}
                          </button>
                        )}
                        <button
                          onClick={() => { setOpenActionId(null); handleDelete(w); }}
                          className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                        >
                          {t("delete")}
                        </button>
                      </>
                    )}
                    {w.approvedAt && w.hajiTransferId && (
                      <div className="px-3 py-2 text-xs text-gray-500">Haji #{w.hajiTransferId}</div>
                    )}
                  </div>
                )}
              </div>
            ),
          },
        ]}
        data={items}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />}

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("record_withdrawal")} size="md" inline={isEmbed}>
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div className="relative" ref={withdraweeMenuRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">Withdrawn By *</label>
            <input
              value={withdraweeSearch}
              onChange={(e) => {
                setWithdraweeSearch(e.target.value);
                setForm((f) => ({ ...f, withdrawnBy: "" }));
                setShowWithdraweeMenu(true);
              }}
              onFocus={() => setShowWithdraweeMenu(true)}
              className="input-field"
              placeholder="Search existing names"
            />
            {showWithdraweeMenu && (
              <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="max-h-48 overflow-y-auto py-1">
                  {filteredWithdrawees.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setWithdraweeSearch(name);
                        selectWithdrawee(name);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      {name}
                    </button>
                  ))}
                  {canAddWithdrawee && (
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        addWithdrawee();
                      }}
                      className="w-full border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-primary-700 hover:bg-primary-50"
                    >
                      + Add &quot;{normalizeWithdraweeName(withdraweeSearch)}&quot;
                    </button>
                  )}
                  {!filteredWithdrawees.length && !canAddWithdrawee && (
                    <div className="px-3 py-2 text-xs text-gray-500">No matching name found</div>
                  )}
                </div>
              </div>
            )}
            {form.withdrawnBy && (
              <p className="mt-1 text-xs text-gray-500">
                Selected: <span className="font-medium text-gray-700">{form.withdrawnBy}</span>
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
            <input type="date" value={form.withdrawalDate} onChange={(e) => setForm((f) => ({ ...f, withdrawalDate: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
            <input type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" readOnly={form.sourceType === "cheque" && !!form.chequePaymentId} onWheel={e => e.currentTarget.blur()} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source of Funds</label>
            {isAfghanistanCity ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                💵 Cash from Office only for Afghanistan city operations
              </div>
            ) : (
              <select value={form.sourceType} onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value, chequePaymentId: 0 }))} className="select-field">
                <option value="cash_office">💵 Cash from Office</option>
                <option value="cheque">🧾 Cheque in Hand</option>
              </select>
            )}
          </div>
          {!isAfghanistanCity && form.sourceType === "cheque" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("cheque")} *</label>
              {inHandCheques.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
                  No cheques in hand. Record a cheque payment first.
                </div>
              ) : (
                <select
                  value={form.chequePaymentId || 0}
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    const sel = inHandCheques.find((c: any) => c.id === id);
                    setForm((f) => ({
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
          {!isAfghanistanCity && form.sourceType === "cheque" && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
              🧾 This withdrawal will consume the selected in-hand cheque.
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button>
        </div>
      </Modal>

      {/* EDIT */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_withdrawal")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Withdrawn By</label>
            <input value={form.withdrawnBy} onChange={(e) => setForm((f) => ({ ...f, withdrawnBy: e.target.value }))} className="input-field" placeholder="e.g. Ali, Rehman" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label>
            <input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label>
            <input type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" readOnly={form.sourceType === "cheque"} onWheel={e => e.currentTarget.blur()} />
          </div>
          <div className="p-2 bg-gray-50 border rounded text-xs text-gray-600">
            Source: <strong>{selected?.sourceType === "cheque" ? "🧾 Cheque in Hand" : "💵 Cash from Office"}</strong> (cannot change after creation)
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
