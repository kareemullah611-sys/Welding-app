"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { isEditableCustomerQueuedPayload, safeParseQueuedBody } from "@/lib/queue-resolve";
import { useSearchParams } from "next/navigation";
import { useOffline } from "@/hooks/useOffline";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

const CUSTOMERS_READ_CACHE_KEY = "mrf-customers-read-cache-v1";

type CustomersReadSnapshot = {
  customers: any[];
  ledgerByCustomer: Record<string, any>;
};

export default function CustomersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, enqueue, updateQueuedItem, retryQueuedItem, syncQueue, queuedItems, lastSyncResult } = useOffline();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
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
  const [form, setForm] = useState({ name: "", phone: "", address: "", cityId: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null);
  const [hardDeletePassword, setHardDeletePassword] = useState("");
  const [hardDeleteError, setHardDeleteError] = useState("");
  const [resolvingQueueId, setResolvingQueueId] = useState<string | null>(null);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");
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
    setLoading(true);
    const params: any = { page, limit: 20 };
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length >= 2) params.q = normalizedQuery;
    const result = await apiCall("/api/v1/customers", { params });
    if (result.success) {
      setCustomers(result.data as any[]);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
      mergeSnapshot({ customers: result.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.customers?.length) {
        setCustomers(snapshot.customers);
        setTotalPages(1);
        setTotal(snapshot.customers.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, page, readSnapshot, searchQuery]);
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
    window.history.replaceState({}, "", isEmbed ? "/customers?embed=1" : "/customers");
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
        id: `pending-${Date.now()}`,
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
    setSubmitting(true);
    const result = await apiCall(`/api/v1/customers/${hardDeleteTarget.id}/hard-delete`, { method: "DELETE", body: { password: hardDeletePassword } });
    setSubmitting(false);
    if (result.success) { setShowHardDelete(false); load(); }
    else setHardDeleteError(result.error || "Failed to delete");
  };

  const handleReactivate = async (c: any) => {
    if (!confirm(`${c.name}: ${t("confirm_reactivate_customer")}`)) return;
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

  const openLedger = async (c: any) => {
    setSelected(c); setShowLedger(true); setLedgerData(null);
    const result = await apiCall(`/api/v1/customers/${c.id}`);
    if (result.success) {
      setLedgerData(result.data);
      mergeSnapshot({ ledgerByCustomer: { [String(c.id)]: result.data } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cached = snapshot?.ledgerByCustomer?.[String(c.id)];
      if (cached) {
        setLedgerData(cached);
        setShowOfflineSnapshot(true);
      }
    }
  };

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
      window.history.replaceState({}, "", isEmbed ? "/customers?embed=1" : "/customers");
    } catch {
      // ignore malformed queued payload
    }
  }, [isEmbed, queuedItems, searchParams, user?.cityId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {!isEmbed && <PageHeader title={t("customers")} subtitle={`${total} ${t("customers").toLowerCase()}`} />}
      {!isEmbed && showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached customers data for this device.
        </div>
      )}
      {!isEmbed && <DataTable
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        searchPlaceholder="Search customers (min 2 chars)"
        columns={[
        { key: "name", label: t("name"), render: (c: any) => (
          <div className="flex items-center gap-2">
            <button onClick={() => openLedger(c)} className="font-medium text-primary-600 hover:underline">{c.name}</button>
            {c._pending && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">syncing…</span>}
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
          <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-action-menu-root="true">
            <button
              type="button"
              onPointerDown={(event) => { event.stopPropagation(); }}
              onClick={(event) => {
                event.stopPropagation();
                setActionMenuDirection("down");
                setOpenActionId((current) => current === c.id ? null : c.id);
              }}
              className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
            >
              ⋯
            </button>
            {openActionId === c.id && (
              <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                {c.isActive && (
                  <button onClick={() => { setOpenActionId(null); openEdit(c); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("edit")}</button>
                )}
                {c.isActive ? (
                  <button disabled={c._pending} onClick={() => { setOpenActionId(null); handleDelete(c); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">{t("deactivate")}</button>
                ) : (
                  <button disabled={c._pending} onClick={() => { setOpenActionId(null); handleReactivate(c); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-green-700 hover:bg-green-50 disabled:opacity-50">{t("reactivate")}</button>
                )}
                {user?.role === "super_admin" && (
                  <button disabled={c._pending} onClick={() => { setOpenActionId(null); openHardDelete(c); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">{t("hard_delete")}</button>
                )}
              </div>
            )}
          </div>
        )},
      ]} data={customers} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />}

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); if (isEmbed) closeEmbed(); }} title={t("new_customer")} size="md" inline={isEmbed}>
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("phone")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("address")}</label><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
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
      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("customer_ledger")}: ${selected?.name || ""}`} size="xl">
        {!ledgerData ? <div className="py-8 text-center"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto" /></div> : (
          <div>
            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              {ledgerData.balanceByCurrency && Object.keys(ledgerData.balanceByCurrency).length > 0
                ? Object.entries(ledgerData.balanceByCurrency).map(([cc, amt]: [string, any]) => (
                    <span key={cc}>Closing Balance ({cc}): <strong className={`${amt > 0 ? "text-red-600" : amt < 0 ? "text-green-600" : ""}`}>{amt !== 0 ? `${cc} ${Math.abs(Number(amt)).toLocaleString("en-US")}` : t("settled")}</strong></span>
                  ))
                : <span>Closing Balance: <strong className={`${ledgerData.balance > 0 ? "text-red-600" : ledgerData.balance < 0 ? "text-green-600" : ""}`}>{ledgerData.balance !== 0 ? Math.abs(ledgerData.balance).toLocaleString("en-US") : t("settled")}</strong></span>
              }
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left">{t("date")}</th><th className="px-3 py-2 text-left">Entry Type</th><th className="px-3 py-2 text-left">{t("currency")}</th><th className="px-3 py-2 text-left">Particulars</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Closing Balance</th></tr></thead>
                <tbody className="divide-y">
                  {ledgerData.ledger?.map((e: any, i: number) => (
                    <tr key={i} className={e.status === "cancelled" ? "opacity-40 line-through" : ""}>
                      <td className="px-3 py-1.5">{e.date}</td>
                      <td className="px-3 py-1.5"><span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "sale" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{e.type === "sale" ? "Sales Invoice" : "Receipt"}</span></td>
                      <td className="px-3 py-1.5 text-xs font-semibold text-gray-500">{e.currency}</td>
                      <td className="px-3 py-1.5 max-w-xs truncate">{e.detail}</td>
                      <td className="px-3 py-1.5 text-right text-red-600">{e.debit ? e.debit.toLocaleString("en-US") : ""}</td>
                      <td className="px-3 py-1.5 text-right text-green-600">{e.credit ? e.credit.toLocaleString("en-US") : ""}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{(typeof e.balance === "number" && !isNaN(e.balance)) ? e.balance.toLocaleString("en-US") : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
