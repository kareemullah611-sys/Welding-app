"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, RowActionMenu, formatDate, formatNumber, MobileDateInput } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { isEditableCustomerQueuedPayload, safeParseQueuedBody } from "@/lib/queue-resolve";
import { applyPendingCustomerLedger } from "@/lib/offline-customer-ledger";
import { useSearchParams } from "next/navigation";
import { getEmbedQuickformPath, shouldSimplifyCityModals } from "@/lib/quickform-embed";
import { useOffline } from "@/hooks/useOffline";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { printCustomerLedgerStatement } from "@/lib/ledger-export";
import { formatLedgerMoneyAmount } from "@/lib/city-money-format";
import { GlassButton } from "@/components/ui/GlassButton";
import { LedgerExportButtons } from "@/components/LedgerExportButtons";
import { Play } from "lucide-react";

function compactCustomerLedgerDetail(entry: { type?: string; detail?: string; voucherNo?: string }) {
  const detail = String(entry.detail || entry.voucherNo || "").trim();
  if (entry.type === "payment") return detail;
  const prefix = entry.type === "sale" ? "Sale" : "Rcpt";
  if (!detail) return prefix;
  return `${prefix} · ${detail}`;
}

function ledgerBalanceTone(balance: number) {
  if (balance > 0) return "border-red-200 bg-red-50 text-red-900";
  if (balance < 0) return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-gray-200 bg-white text-gray-600";
}

const LEDGER_FIELD_LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]";

const CUSTOMERS_READ_CACHE_KEY = "mrf-customers-read-cache-v1";

type CustomersReadSnapshot = {
  customers: any[];
  ledgerByCustomer: Record<string, any>;
};

function applyQueuedMutationsToCustomers(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/customers/")) continue;
    const match = url.match(/^\/api\/v1\/customers\/([^/?#]+)/);
    const customerId = match?.[1];
    if (!customerId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== customerId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === customerId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            phone: patch?.phone ?? row?.phone,
            address: patch?.address ?? row?.address,
            cityId: patch?.cityId ?? row?.cityId,
            isActive: typeof patch?.isActive === "boolean" ? patch.isActive : row?.isActive,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

export default function CustomersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, enqueue, updateQueuedItem, retryQueuedItem, discardQueuedItem, syncQueue, queuedItems, lastSyncResult } = useOffline();
  const searchParams = useSearchParams();
  const isEmbed = useQuickformEmbed();
  const simplifyModals = shouldSimplifyCityModals(user, isEmbed);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState("");
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState("all");
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    cityId: 0,
    portalAccessEnabled: false,
    portalUsername: "",
    portalPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [openActionId, setOpenActionId] = useState<number | string | null>(null);
  const getPendingQueueId = useCallback((row: any): string | null => {
    if (!row) return null;
    if (typeof row._queueId === "string" && row._queueId) return row._queueId;
    const id = String(row.id || "");
    if (id.startsWith("pending-")) return id.replace("pending-", "");
    return null;
  }, []);
  const [prefillHandled, setPrefillHandled] = useState(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<CustomersReadSnapshot>(CUSTOMERS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<CustomersReadSnapshot>) => {
    const existing = readSnapshot()?.data || { customers: [], ledgerByCustomer: {} };
    writeOfflineReadSnapshot<CustomersReadSnapshot>(CUSTOMERS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      ledgerByCustomer: { ...(existing.ledgerByCustomer || {}), ...(partial.ledgerByCustomer || {}) },
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    if (isEmbed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const result = await apiCall("/api/v1/customers", { params });
    if (result.success) {
      let nextCustomers = (result.data as any[]) || [];
      const pendingCustomers = queuedItems
        .filter((q) => q.pathname === "/customers" && q.method === "POST" && q.url === "/api/v1/customers")
        .map((q) => {
          const parsed = safeParseQueuedBody(q.body) as any;
          return {
            id: `pending-${q.id}`,
            _queueId: q.id,
            name: parsed?.name || "Customer",
            phone: parsed?.phone || "",
            address: parsed?.address || "",
            cityId: Number(parsed?.cityId || user?.cityId || 0),
            isActive: true,
            _pending: true,
          };
        });
      nextCustomers = [...pendingCustomers, ...nextCustomers];
      nextCustomers = applyQueuedMutationsToCustomers(nextCustomers, queuedItems as any[]);
      setCustomers(nextCustomers);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
      mergeSnapshot({ customers: nextCustomers });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.customers?.length) {
        const cleanedCustomers = pruneStalePendingRows(snapshot.customers as any[], queuedItems as any[], "/customers");
        const mergedSnapshotCustomers = applyQueuedMutationsToCustomers(cleanedCustomers, queuedItems as any[]);
        setCustomers(mergedSnapshotCustomers);
        setTotalPages(1);
        setTotal(mergedSnapshotCustomers.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isEmbed, isOnline, mergeSnapshot, page, queuedItems, readSnapshot, searchQuery, user?.cityId]);
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
    window.history.replaceState({}, "", getEmbedQuickformPath("/customers"));
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

  const openCreate = (preset?: Partial<typeof form>) => {
    setForm({ name: "", phone: "", address: "", cityId: user?.cityId || 0, portalAccessEnabled: false, portalUsername: "", portalPassword: "", ...preset });
    setShowCreate(true);
    setFormError("");
  };
  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError("Name required"); return; }
    if (!isOnline && (form.portalAccessEnabled || form.portalPassword || form.portalUsername)) {
      setFormError("Portal access settings require internet so credentials are not stored offline.");
      return;
    }
    const payload = { ...form, name: form.name.trim() };

    if (resolvingQueueId) {
      const ok = await updateQueuedItem(resolvingQueueId, {
        body: JSON.stringify(payload),
        auditMeta: {
          action: "update",
          entityType: "customer",
          entityLabel: "Customer (Pending)",
          entityDetail: payload.name,
        },
      });
      if (!ok) {
        setFormError("Queued customer entry not found");
        return;
      }
      if (isOnline) {
        await retryQueuedItem(resolvingQueueId);
        await syncQueue();
      }
      setResolvingQueueId(null);
      setShowCreate(false);
      if (isEmbed) closeEmbed();
      load();
      return;
    }

    if (!isOnline) {
      const queueId = await enqueue({
        url: "/api/v1/customers",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        pathname: "/customers",
        auditMeta: {
          action: "create",
          entityType: "customer",
          entityLabel: "Customer (Pending)",
          entityDetail: payload.name,
        },
      });
      setCustomers((prev) => {
        const next = [{
        id: `pending-${queueId}`,
        _queueId: queueId,
        name: payload.name,
        phone: payload.phone || "",
        address: payload.address || "",
        cityId: payload.cityId || user?.cityId || 0,
        isActive: true,
        _pending: true,
      }, ...prev];
        mergeSnapshot({ customers: next });
        return next;
      });
      setShowCreate(false);
      setResolvingQueueId(null);
      if (isEmbed) closeEmbed();
      return;
    }
    setSubmitting(true);
    const result = await apiCall("/api/v1/customers", { method: "POST", body: payload });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); setResolvingQueueId(null); if (isEmbed) closeEmbed(); load(); } else { setFormError(result.error || "Failed"); }
  };

  const openEdit = (c: any) => { setSelected(c); setForm({ name: c.name, phone: c.phone || "", address: c.address || "", cityId: c.cityId, portalAccessEnabled: Boolean(c.portalAccessEnabled), portalUsername: c.portalUsername || "", portalPassword: "" }); setShowEdit(true); setFormError(""); };
  const handleEdit = async () => {
    if (!isOnline && (form.portalAccessEnabled !== Boolean(selected?.portalAccessEnabled) || form.portalUsername !== (selected?.portalUsername || "") || form.portalPassword)) {
      setFormError("Portal access settings require internet so credentials are not stored offline.");
      return;
    }
    if (selected?._pending && selected?._queueId) {
      const updatedForm = { ...form, name: form.name.trim() };
      const ok = await updateQueuedItem(selected._queueId, {
        body: JSON.stringify(updatedForm),
        auditMeta: {
          action: "update",
          entityType: "customer",
          entityLabel: "Customer (Pending)",
          entityDetail: updatedForm.name || "Customer",
        },
      });
      if (!ok) {
        setFormError("Pending queue entry not found");
        return;
      }
      setCustomers((prev) => {
        const next = prev.map((c) => c.id === selected.id ? { ...c, ...updatedForm, _pending: true } : c);
        mergeSnapshot({ customers: next });
        return next;
      });
      setShowEdit(false);
      return;
    }

    if (!isOnline) {
      const queueId = await enqueue({
        url: `/api/v1/customers/${selected.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        pathname: "/customers",
        auditMeta: {
          action: "update",
          entityType: "customer",
          entityLabel: "Customer Update (Pending)",
          entityDetail: form.name.trim() || selected?.name || "Customer",
        },
      });
      setCustomers((prev) => {
        const next = prev.map((c) => c.id === selected.id ? { ...c, ...form, _pending: true, _queueId: queueId } : c);
        mergeSnapshot({ customers: next });
        return next;
      });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/customers/${selected.id}`, { method: "PUT", body: form });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const renderPortalAccessFields = (isEdit = false) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Portal Access</p>
          <p className="text-xs text-slate-500">Allow this customer to login to the customer portal.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only"
            checked={form.portalAccessEnabled}
            onChange={(e) => setForm((f) => ({ ...f, portalAccessEnabled: e.target.checked }))}
          />
          <span className={`relative h-7 w-12 rounded-full transition-colors ${form.portalAccessEnabled ? "bg-primary-600" : "bg-slate-300"}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.portalAccessEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </span>
        </label>
      </div>
      {form.portalAccessEnabled && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Portal Username *</label>
            <input
              value={form.portalUsername}
              onChange={(e) => setForm((f) => ({ ...f, portalUsername: e.target.value }))}
              className="input-field"
              placeholder="e.g. adil_customer"
              autoCapitalize="none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{isEdit ? "New Portal Password" : "Portal Password *"}</label>
            <input
              type="password"
              value={form.portalPassword}
              onChange={(e) => setForm((f) => ({ ...f, portalPassword: e.target.value }))}
              className="input-field"
              placeholder={isEdit ? "Leave blank to keep current" : "Minimum 8 characters"}
            />
          </div>
        </div>
      )}
      {isEdit && selected?.portalLastLoginAt && (
        <p className="mt-2 text-xs text-slate-500">Last login: {formatDate(String(selected.portalLastLoginAt).slice(0, 10))}</p>
      )}
    </div>
  );

  const handleDelete = async (c: any) => {
    if (!confirm(`${c.name}: ${t("confirm_deactivate_customer")}`)) return;
    const pendingQueueId = getPendingQueueId(c);
    if (pendingQueueId && String(c?.id || "").startsWith("pending-")) {
      const ok = await discardQueuedItem(pendingQueueId);
      if (!ok) return;
      setCustomers((prev) => {
        const next = prev.filter((row) => row.id !== c.id);
        mergeSnapshot({ customers: next });
        return next;
      });
      return;
    }
    if (!isOnline) {
      const queueId = await enqueue({
        url: `/api/v1/customers/${c.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
        pathname: "/customers",
        auditMeta: {
          action: "update",
          entityType: "customer",
          entityLabel: "Customer Deactivate (Pending)",
          entityDetail: c.name,
        },
      });
      setCustomers((prev) => {
        const next = prev.map((row) => row.id === c.id ? { ...row, isActive: false, _pending: true, _queueId: queueId } : row);
        mergeSnapshot({ customers: next });
        return next;
      });
      return;
    }
    await apiCall(`/api/v1/customers/${c.id}`, { method: "DELETE" });
    load();
  };

  const openHardDelete = (c: any) => { setHardDeleteTarget(c); setHardDeletePassword(""); setHardDeleteError(""); setShowHardDelete(true); };
  const handleHardDelete = async () => {
    if (!hardDeletePassword.trim()) { setHardDeleteError(t("password_required")); return; }
    const pendingQueueId = getPendingQueueId(hardDeleteTarget);
    if (pendingQueueId && String(hardDeleteTarget?.id || "").startsWith("pending-")) {
      const ok = await discardQueuedItem(pendingQueueId);
      if (!ok) { setHardDeleteError("Unable to remove pending customer."); return; }
      setCustomers((prev) => {
        const next = prev.filter((row) => row.id !== hardDeleteTarget.id);
        mergeSnapshot({ customers: next });
        return next;
      });
      setShowHardDelete(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/customers/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setSubmitting(false);
    if (result.success) { setShowHardDelete(false); load(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  const handleReactivate = async (c: any) => {
    if (!confirm(`${c.name}: ${t("confirm_reactivate_customer")}`)) return;
    if (String(c?.id || "").startsWith("pending-")) return;
    if (!isOnline) {
      const queueId = await enqueue({
        url: `/api/v1/customers/${c.id}`,
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
        pathname: "/customers",
        auditMeta: {
          action: "update",
          entityType: "customer",
          entityLabel: "Customer Reactivate (Pending)",
          entityDetail: c.name,
        },
      });
      setCustomers((prev) => {
        const next = prev.map((row) => row.id === c.id ? { ...row, isActive: true, _pending: true, _queueId: queueId } : row);
        mergeSnapshot({ customers: next });
        return next;
      });
      return;
    }
    await apiCall(`/api/v1/customers/${c.id}`, { method: "PUT", body: { isActive: true } });
    load();
  };

  const loadLedger = async (c: any, dates?: { from?: string; to?: string; type?: string }) => {
    setLedgerLoading(true);
    setLedgerData(null);
    const params: Record<string, string> = {};
    if (dates?.from) params.date_from = dates.from;
    if (dates?.to) params.date_to = dates.to;
    if (dates?.type && dates.type !== "all") params.ledger_type = dates.type;
    const result = await apiCall(`/api/v1/customers/${c.id}`, { params });
    if (result.success) {
      const mergedLedger = !isOnline
        ? applyPendingCustomerLedger(result.data as any, queuedItems as any, Number(c.id))
        : result.data;
      setLedgerData(mergedLedger);
      mergeSnapshot({ ledgerByCustomer: { [String(c.id)]: mergedLedger } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cached = snapshot?.ledgerByCustomer?.[String(c.id)];
      if (cached) {
        setLedgerData(applyPendingCustomerLedger(cached as any, queuedItems as any, Number(c.id)));
        setShowOfflineSnapshot(true);
      }
    }
    setLedgerLoading(false);
  };

  const openLedger = async (c: any) => {
    if (String(c?.id || "").startsWith("pending-")) {
      setFormError("Pending customer is not synced yet. Please sync first.");
      return;
    }
    setSelected(c);
    setShowLedger(true);
    setLedgerDateFrom("");
    setLedgerDateTo("");
    setLedgerSearchQuery("");
    setLedgerTypeFilter("all");
    await loadLedger(c);
  };

  const applyLedgerDateFilter = async () => {
    if (!selected) return;
    await loadLedger(selected, {
      from: ledgerDateFrom || undefined,
      to: ledgerDateTo || undefined,
      type: ledgerTypeFilter,
    });
  };

  const buildLedgerBalanceSummary = (data: any) => {
    if (!data) return "";
    const symbolForCode = (code: string) => {
      const row = (data.ledger || []).find((e: any) => e.currency === code);
      return row?.currencySymbol || code;
    };
    const formatBalanceLine = (amount: number, symbol?: string, code?: string) => {
      if (amount === 0) return `${t("balance")}: ${t("settled")}`;
      return `${t("balance")}: ${formatLedgerMoneyAmount(Math.abs(amount), symbol, code)}`;
    };
    if (data.balanceByCurrency && Object.keys(data.balanceByCurrency).length > 0) {
      return Object.entries(data.balanceByCurrency)
        .map(([cc, amt]) => formatBalanceLine(Number(amt), symbolForCode(cc), cc))
        .join(" · ");
    }
    if (typeof data.balance === "number") {
      const code = data.ledger?.[0]?.currency;
      const symbol = data.ledger?.[0]?.currencySymbol;
      return formatBalanceLine(data.balance, symbol, code);
    }
    return "";
  };

  const ledgerEntrySymbol = (entry: any) => String(entry?.currencySymbol || entry?.currency || "").trim();

  useEffect(() => {
    const shouldResolve = searchParams.get("resolve") === "1";
    const queueId = searchParams.get("queue_id");
    if (!shouldResolve || !queueId) return;
    const target = queuedItems.find((q) => q.id === queueId && q.pathname === "/customers");
    if (!target) return;
    try {
      const parsed = safeParseQueuedBody(target.body);
      if (!isEditableCustomerQueuedPayload(parsed)) {
        setFormError("This queued customer action cannot be edited in form. Use Retry or Discard in Activity.");
        return;
      }
      openCreate({
        name: parsed.name || "",
        phone: parsed.phone || "",
        address: parsed.address || "",
        cityId: Number(parsed.cityId || user?.cityId || 0),
      });
      setResolvingQueueId(queueId);
      setFormError("Resolving queued customer entry. Save to update and re-sync.");
      window.history.replaceState({}, "", getEmbedQuickformPath("/customers"));
    } catch {
      // ignore malformed queued payload
    }
  }, [isEmbed, queuedItems, searchParams, user?.cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const customerNameColumn = {
    key: "name",
    label: t("name"),
    render: (c: any) => (
      <div className="flex items-center gap-2">
        {String(c?.id || "").startsWith("pending-") ? (
          <span className="font-medium text-gray-500">{c.name}</span>
        ) : (
          <button onClick={() => openLedger(c)} className="font-medium text-primary-600 hover:underline">{c.name}</button>
        )}
        {!c.isActive && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{t("inactive")}</span>}
      </div>
    ),
  };
  const customerPhoneColumn = {
    key: "phone",
    label: t("phone"),
    render: (c: any) => c.phone || "-",
  };
  const customerAddressColumn = {
    key: "address",
    label: t("address"),
    render: (c: any) => c.address || "-",
    className: "max-w-xs truncate",
  };
  const customerBalanceColumn = {
    key: "balance",
    label: t("balance"),
    render: (c: any) => {
      if (c.balanceByCurrency && Object.keys(c.balanceByCurrency).length > 0) {
        return (
          <div className="space-y-0.5">
            {Object.entries(c.balanceByCurrency).map(([cc, amt]: [string, any]) => (
              <div key={cc} className={`font-medium text-sm ${amt > 0 ? "text-red-600" : amt < 0 ? "text-green-600" : "text-gray-400"}`}>
                {amt !== 0 ? `${cc} ${Math.abs(amt).toLocaleString("en-US")}` : `${cc} ${t("settled")}`}
              </div>
            ))}
          </div>
        );
      }
      if (c.balance !== undefined) {
        return <span className={`font-medium ${c.balance > 0 ? "text-red-600" : c.balance < 0 ? "text-green-600" : ""}`}>{c.balance !== 0 ? Math.abs(c.balance).toLocaleString("en-US") : t("settled")}</span>;
      }
      return <span>-</span>;
    },
  };
  const customerActionsColumn = {
    key: "actions",
    label: "",
    render: (c: any) => (
      <RowActionMenu
        open={openActionId === c.id}
        onOpenChange={(open) => setOpenActionId(open ? c.id : null)}
      >
        {c.isActive && (
          <button onClick={() => { setOpenActionId(null); openEdit(c); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("edit")}</button>
        )}
        {c.isActive ? (
          <button onClick={() => { setOpenActionId(null); handleDelete(c); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("deactivate")}</button>
        ) : (
          <button onClick={() => { setOpenActionId(null); handleReactivate(c); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-green-700 hover:bg-green-50 sm:py-2 sm:text-xs">{t("reactivate")}</button>
        )}
        {user?.role === "super_admin" && (
          <button onClick={() => { setOpenActionId(null); openHardDelete(c); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-800 hover:bg-red-50 sm:py-2 sm:text-xs">{t("hard_delete")}</button>
        )}
      </RowActionMenu>
    ),
  };
  const customerColumns = simplifyModals
    ? [customerNameColumn, customerBalanceColumn, customerPhoneColumn, customerActionsColumn]
    : [customerNameColumn, customerPhoneColumn, customerAddressColumn, customerBalanceColumn, customerActionsColumn];

  return (
    <div className={isEmbed ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {!isEmbed && <PageHeader title={t("customers")} />}
      {!isEmbed && showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached customers data for this device.
        </div>
      )}
      {!isEmbed && <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        columns={customerColumns} data={customers} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />}

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("new_customer")} size="md" inline={isEmbed} hideHeader={isEmbed}>
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" placeholder="Customer name" autoFocus /></div>
          <div><label className="block mb-1">{t("phone")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" placeholder="Phone (optional)" /></div>
          {renderPortalAccessFields(false)}
        </div>
        <div className={isEmbed ? "quickform-footer" : "flex justify-end gap-3 pt-4 mt-4 border-t"}>
          <button onClick={handleCreate} disabled={submitting} className={isEmbed ? "glass-btn glass-btn-primary w-full min-h-11 disabled:opacity-60" : "btn-primary text-sm"}>
            {submitting ? "Saving…" : t("create")}
          </button>
        </div>
      </Modal>

      {/* EDIT */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.name || ""}`} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("phone")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("address")}</label><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="input-field" /></div>
          {renderPortalAccessFields(true)}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      {/* LEDGER */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("customer_ledger")} — ${selected?.name || ""}`} size="lg">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d4d4d8] bg-[#f4f4f5]/90 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {ledgerData && ledgerData.balanceByCurrency && Object.keys(ledgerData.balanceByCurrency).length > 0 ? (
                Object.entries(ledgerData.balanceByCurrency).map(([code, amt]: [string, any]) => {
                  const bal = Number(amt || 0);
                  const sym = ledgerEntrySymbol({ currency: code, currencySymbol: (ledgerData.ledger || []).find((e: any) => e.currency === code)?.currencySymbol });
                  return (
                    <div
                      key={code}
                      className={`inline-flex items-baseline gap-2 rounded-lg border px-3 py-1.5 ${ledgerBalanceTone(bal)}`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{t("balance")}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {bal === 0 ? t("settled") : formatLedgerMoneyAmount(Math.abs(bal), sym, code)}
                      </span>
                    </div>
                  );
                })
              ) : ledgerData && typeof ledgerData.balance === "number" ? (
                <div className={`inline-flex items-baseline gap-2 rounded-lg border px-3 py-1.5 ${ledgerBalanceTone(ledgerData.balance)}`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{t("balance")}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {ledgerData.balance === 0
                      ? t("settled")
                      : formatLedgerMoneyAmount(Math.abs(ledgerData.balance), ledgerData.ledger?.[0]?.currencySymbol, ledgerData.ledger?.[0]?.currency)}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-gray-500">—</span>
              )}
            </div>
            <LedgerExportButtons
              type="customer_ledger"
              customerId={selected?.id}
              dateFrom={ledgerDateFrom || undefined}
              dateTo={ledgerDateTo || undefined}
              cityId={user?.cityId ?? undefined}
              ledgerType={ledgerTypeFilter}
              query={ledgerSearchQuery.trim().length >= 2 ? ledgerSearchQuery.trim() : undefined}
              disabled={!isOnline || !selected?.id}
              onPrintPdf={() => {
                if (!ledgerData) return;
                printCustomerLedgerStatement({
                  customerName: selected?.name || "",
                  ledger: ledgerData.ledger || [],
                  balanceSummary: buildLedgerBalanceSummary(ledgerData),
                  dateFrom: ledgerDateFrom || undefined,
                  dateTo: ledgerDateTo || undefined,
                  query: ledgerTypeFilter === "all" ? ledgerSearchQuery : `${ledgerSearchQuery || ""} ${ledgerTypeFilter}`.trim(),
                });
              }}
            />
          </div>

          <div className="rounded-xl border border-[#ececee] bg-white/95 px-3 py-2">
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_7rem_7.5rem_7.5rem_auto]">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <label className={LEDGER_FIELD_LABEL}>Search</label>
                <input
                  type="text"
                  value={ledgerSearchQuery}
                  onChange={(e) => setLedgerSearchQuery(e.target.value)}
                  placeholder="Search entries…"
                  className="input-field h-8 min-h-8 w-full py-1.5 text-sm"
                />
              </div>
              <div className="min-w-0">
                <label className={LEDGER_FIELD_LABEL}>Type</label>
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setLedgerTypeFilter(nextType);
                    if (selected) {
                      void loadLedger(selected, {
                        from: ledgerDateFrom || undefined,
                        to: ledgerDateTo || undefined,
                        type: nextType,
                      });
                    }
                  }}
                  className="select-field h-8 min-h-8 w-full py-1.5 text-sm"
                >
                  <option value="all">All</option>
                  <option value="sale">Sale</option>
                  <option value="payment">Receipt</option>
                  <option value="opening">Opening</option>
                </select>
              </div>
              <div className="min-w-0">
                <label className={LEDGER_FIELD_LABEL}>{t("from")}</label>
                <MobileDateInput
                  variant="filter"
                  value={ledgerDateFrom}
                  onChange={setLedgerDateFrom}
                  placeholder={t("from")}
                  aria-label={t("from")}
                  className="h-8 w-full px-2 text-sm"
                />
              </div>
              <div className="min-w-0">
                <label className={LEDGER_FIELD_LABEL}>{t("to")}</label>
                <MobileDateInput
                  variant="filter"
                  value={ledgerDateTo}
                  onChange={setLedgerDateTo}
                  placeholder={t("to")}
                  aria-label={t("to")}
                  className="h-8 w-full px-2 text-sm"
                />
              </div>
              <GlassButton
                type="button"
                onClick={applyLedgerDateFilter}
                disabled={ledgerLoading || !selected}
                className="col-span-2 h-8 px-3 text-sm sm:col-span-1"
              >
                <Play className="h-4 w-4" strokeWidth={2} />
                {ledgerLoading ? t("loading") : t("generate")}
              </GlassButton>
            </div>
          </div>

          {ledgerLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            </div>
          ) : ledgerData ? (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col />
                    <col className="w-[88px]" />
                    <col className="w-[88px]" />
                    <col className="w-[96px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#f4f4f5] text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-3 py-2 text-left font-semibold">{t("date")}</th>
                      <th className="px-3 py-2 text-left font-semibold">{t("detail")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("debit")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("credit")}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t("balance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const rows = (ledgerData.ledger || []).filter((e: any) => {
                        const needle = ledgerSearchQuery.trim().toLowerCase();
                        if (needle.length < 2) return true;
                        return [e.date, e.type, e.currency, e.currencySymbol, e.detail, e.voucherNo, e.status]
                          .some((value) => String(value ?? "").toLowerCase().includes(needle));
                      });
                      if (rows.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">
                              No ledger entries for this period
                            </td>
                          </tr>
                        );
                      }
                      return rows.map((e: any, i: number) => {
                        const sym = ledgerEntrySymbol(e);
                        return (
                          <tr
                            key={i}
                            className={`border-t border-[#e4e4e7] transition-colors hover:bg-[#fafafa] ${e.status === "cancelled" ? "opacity-40 line-through" : ""}`}
                          >
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{formatDate(e.date)}</td>
                            <td className="whitespace-normal break-words px-3 py-2 text-gray-800" title={String(e.detail || e.voucherNo || "")}>
                              {compactCustomerLedgerDetail(e)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-red-700">
                              {e.debit > 0 ? formatLedgerMoneyAmount(e.debit, sym, e.currency) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                              {e.credit > 0 ? formatLedgerMoneyAmount(e.credit, sym, e.currency) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                              {(typeof e.balance === "number" && !Number.isNaN(e.balance))
                                ? formatLedgerMoneyAmount(e.balance, sym, e.currency)
                                : "—"}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
              No ledger data available
            </div>
          )}
        </div>
      </Modal>

      {/* HARD DELETE 2FA MODAL */}
      <Modal open={showHardDelete} onClose={() => setShowHardDelete(false)} title={`⚠️ ${t("hard_delete")}`} size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">{t("permanent_delete_warning")}</p>
            <p>{t("customer")}: <span className="font-bold">{hardDeleteTarget?.name}</span></p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("enter_admin_password")}</label>
            <input
              type="password"
              value={hardDeletePassword}
              onChange={e => setHardDeletePassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleHardDelete()}
              className="input-field"
              placeholder={t("password")}
              autoFocus
            />
          </div>
          {hardDeleteError && <p className="text-sm text-red-600">{hardDeleteError}</p>}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setShowHardDelete(false)} className="btn-secondary text-sm">{t("cancel")}</button>
            <button onClick={handleHardDelete} disabled={submitting} className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {submitting ? "..." : t("hard_delete")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
