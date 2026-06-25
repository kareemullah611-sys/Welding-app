"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, RowActionMenu, formatDate, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { isEditableCustomerQueuedPayload, safeParseQueuedBody } from "@/lib/queue-resolve";
import { applyPendingCustomerLedger } from "@/lib/offline-customer-ledger";
import { useSearchParams } from "next/navigation";
import { getEmbedQuickformPath } from "@/lib/quickform-embed";
import { useOffline } from "@/hooks/useOffline";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { openLedgerExport, printCustomerLedgerStatement } from "@/lib/ledger-export";
import { formatLedgerMoneyAmount } from "@/lib/city-money-format";

function compactCustomerLedgerDetail(entry: { type?: string; detail?: string; voucherNo?: string }) {
  const detail = String(entry.detail || entry.voucherNo || "").trim();
  const prefix = entry.type === "sale" ? "Sale" : "Rcpt";
  if (!detail) return prefix;
  const combined = `${prefix} · ${detail}`;
  return combined.length > 42 ? `${combined.slice(0, 40)}…` : combined;
}

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
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", cityId: 0 });
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
    setForm({ name: "", phone: "", address: "", cityId: user?.cityId || 0, ...preset });
    setShowCreate(true);
    setFormError("");
  };
  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError("Name required"); return; }
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

  const openEdit = (c: any) => { setSelected(c); setForm({ name: c.name, phone: c.phone || "", address: c.address || "", cityId: c.cityId }); setShowEdit(true); setFormError(""); };
  const handleEdit = async () => {
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

  const loadLedger = async (c: any, dates?: { from?: string; to?: string }) => {
    setLedgerLoading(true);
    setLedgerData(null);
    const params: Record<string, string> = {};
    if (dates?.from) params.date_from = dates.from;
    if (dates?.to) params.date_to = dates.to;
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
    await loadLedger(c);
  };

  const applyLedgerDateFilter = async () => {
    if (!selected) return;
    await loadLedger(selected, {
      from: ledgerDateFrom || undefined,
      to: ledgerDateTo || undefined,
    });
  };

  const buildLedgerBalanceSummary = (data: any) => {
    if (!data) return "";
    const symbolForCode = (code: string) => {
      const row = (data.ledger || []).find((e: any) => e.currency === code);
      return row?.currencySymbol || code;
    };
    if (data.balanceByCurrency && Object.keys(data.balanceByCurrency).length > 0) {
      return Object.entries(data.balanceByCurrency)
        .map(([cc, amt]) => formatLedgerMoneyAmount(Math.abs(Number(amt)), symbolForCode(cc), cc))
        .filter(Boolean)
        .join(" · ");
    }
    if (typeof data.balance === "number") {
      const code = data.ledger?.[0]?.currency;
      const symbol = data.ledger?.[0]?.currencySymbol;
      return formatLedgerMoneyAmount(Math.abs(data.balance), symbol, code);
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
        columns={[
        { key: "name", label: t("name"), render: (c: any) => (
          <div className="flex items-center gap-2">
            {String(c?.id || "").startsWith("pending-") ? (
              <span className="font-medium text-gray-500">{c.name}</span>
            ) : (
              <button onClick={() => openLedger(c)} className="font-medium text-primary-600 hover:underline">{c.name}</button>
            )}
            {!c.isActive && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{t("inactive")}</span>}
          </div>
        )},
        { key: "phone", label: t("phone"), render: (c: any) => c.phone || "-" },
        { key: "address", label: t("address"), render: (c: any) => c.address || "-", className: "max-w-xs truncate" },
        { key: "balance", label: t("balance"), render: (c: any) => {
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
        }},
        { key: "actions", label: "", render: (c: any) => (
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
        )},
      ]} data={customers} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />}

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("new_customer")} size="md" inline={isEmbed} hideHeader={isEmbed}>
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" placeholder="Customer name" autoFocus /></div>
          <div><label className="block mb-1">{t("phone")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" placeholder="Phone (optional)" /></div>
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
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      {/* LEDGER */}
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Ledger — ${selected?.name || ""}`} size="lg">
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[#d4d4d8] bg-[#f4f4f5]/90 px-3 py-2">
            <div className="flex flex-col items-start gap-1">
              {ledgerData && ledgerData.balanceByCurrency && Object.keys(ledgerData.balanceByCurrency).length > 0 ? (
                Object.entries(ledgerData.balanceByCurrency).map(([code, amt]: [string, any]) => {
                  const bal = Number(amt || 0);
                  const sym = ledgerEntrySymbol({ currency: code, currencySymbol: (ledgerData.ledger || []).find((e: any) => e.currency === code)?.currencySymbol });
                  return (
                    <span
                      key={code}
                      className={`rounded border px-2 py-0.5 text-xs font-medium tabular-nums ${bal > 0 ? "border-red-200 bg-red-50 text-red-800" : bal < 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-600"}`}
                    >
                      {bal === 0 ? `${sym} ${t("settled")}` : formatLedgerMoneyAmount(Math.abs(bal), sym, code)}
                    </span>
                  );
                })
              ) : ledgerData && typeof ledgerData.balance === "number" ? (
                <span className={`rounded border px-2 py-0.5 text-xs font-medium tabular-nums ${ledgerData.balance > 0 ? "border-red-200 bg-red-50 text-red-800" : ledgerData.balance < 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-gray-200 bg-white text-gray-600"}`}>
                  {ledgerData.balance === 0
                    ? t("settled")
                    : formatLedgerMoneyAmount(Math.abs(ledgerData.balance), ledgerData.ledger?.[0]?.currencySymbol, ledgerData.ledger?.[0]?.currency)}
                </span>
              ) : (
                <span className="text-xs text-gray-500">No balance</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={!isOnline || !selected?.id}
                onClick={() => openLedgerExport({
                  type: "customer_ledger",
                  customerId: selected?.id,
                  dateFrom: ledgerDateFrom || undefined,
                  dateTo: ledgerDateTo || undefined,
                  cityId: user?.cityId ?? undefined,
                  query: ledgerSearchQuery,
                })}
                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                XLSX
              </button>
              <button
                type="button"
                disabled={!ledgerData}
                onClick={() => {
                  if (!ledgerData) return;
                  printCustomerLedgerStatement({
                    customerName: selected?.name || "",
                    ledger: ledgerData.ledger || [],
                    balanceSummary: buildLedgerBalanceSummary(ledgerData),
                    dateFrom: ledgerDateFrom || undefined,
                    dateTo: ledgerDateTo || undefined,
                    query: ledgerSearchQuery,
                  });
                }}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                PDF
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-1.5 text-xs">
            <label className="flex items-center gap-1.5 text-gray-600">
              <span className="font-medium">{t("from")}</span>
              <input type="date" value={ledgerDateFrom} onChange={(e) => setLedgerDateFrom(e.target.value)} className="input-field w-32 py-0.5 text-xs" />
            </label>
            <label className="flex items-center gap-1.5 text-gray-600">
              <span className="font-medium">{t("to")}</span>
              <input type="date" value={ledgerDateTo} onChange={(e) => setLedgerDateTo(e.target.value)} className="input-field w-32 py-0.5 text-xs" />
            </label>
            <button type="button" onClick={applyLedgerDateFilter} className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
              {t("generate")}
            </button>
            <input
              type="text"
              value={ledgerSearchQuery}
              onChange={(e) => setLedgerSearchQuery(e.target.value)}
              placeholder="Search…"
              className="input-field min-w-[8rem] flex-1 py-0.5 text-xs sm:max-w-[10rem]"
            />
          </div>

          {ledgerLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : ledgerData ? (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[76px]" />
                    <col />
                    <col className="w-[76px]" />
                    <col className="w-[76px]" />
                    <col className="w-[84px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#f4f4f5] text-[10px] uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-1.5 text-left font-semibold">{t("date")}</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Detail</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Dr</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Cr</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Bal</th>
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
                        return <tr><td colSpan={5} className="py-6 text-center text-gray-400">No ledger entries</td></tr>;
                      }
                      return rows.map((e: any, i: number) => {
                        const sym = ledgerEntrySymbol(e);
                        return (
                        <tr key={i} className={`border-t border-[#e4e4e7] hover:bg-[#f5e8eb] ${e.status === "cancelled" ? "opacity-40 line-through" : ""}`}>
                          <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{formatDate(e.date)}</td>
                          <td className="px-2 py-1.5 text-gray-800 truncate" title={String(e.detail || e.voucherNo || "")}>
                            {compactCustomerLedgerDetail(e)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{e.debit > 0 ? formatLedgerMoneyAmount(e.debit, sym, e.currency) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-green-700">{e.credit > 0 ? formatLedgerMoneyAmount(e.credit, sym, e.currency) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-800">
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
            <div className="py-6 text-center text-sm text-gray-400">No ledger data</div>
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
