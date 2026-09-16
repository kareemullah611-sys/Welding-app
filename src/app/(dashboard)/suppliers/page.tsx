"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber, formatDate, RowActionMenu } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { exportSupplierLedgerXlsx } from "@/lib/ledger-export";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingSuppliers } from "@/lib/offline-queue-overlays";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { openSuperAdminTransaction } from "@/lib/superadmin-transactions";

const SUPPLIERS_READ_CACHE_KEY = "mrf-suppliers-read-cache-v1";

type SuppliersReadSnapshot = {
  suppliers: any[];
  lots: any[];
  bankAccounts: any[];
  intermediaries: any[];
  ledgerBySupplier: Record<string, any>;
};

function applyQueuedMutationsToSuppliers(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/suppliers/")) continue;
    const match = url.match(/^\/api\/v1\/suppliers\/([^/?#]+)/);
    const supplierId = match?.[1];
    if (!supplierId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== supplierId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === supplierId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            country: patch?.country ?? row?.country,
            contact: patch?.contact ?? row?.contact,
            notes: patch?.notes ?? row?.notes,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

export default function SuppliersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const deepLinkHandled = useRef(false);
  const { isOnline, queuedItems, updateQueuedItem, discardQueuedItem } = useOffline();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPaymentCreate, setShowPaymentCreate] = useState(false);
  const [showPaymentEdit, setShowPaymentEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", country: "", contact: "", notes: "" });
  const [ledgerTab, setLedgerTab] = useState<"schedule" | "running">("schedule");
  const [paymentForm, setPaymentForm] = useState({
    lotId: 0,
    paymentDate: new Date().toISOString().split("T")[0],
    amountUsd: 0,
    exchangeRate: 0,
    amountLocal: 0,
    paymentMethod: "bank_transfer",
    paidVia: "bank",
    bankAccountId: 0,
    superAdminBankAccountId: 0,
    intermediaryId: 0,
    reference: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const isPendingSupplier = (supplier: any) => String(supplier?.id || "").startsWith("pending-");

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<SuppliersReadSnapshot>(SUPPLIERS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<SuppliersReadSnapshot>) => {
    const existing = readSnapshot()?.data || { suppliers: [], lots: [], bankAccounts: [], intermediaries: [], ledgerBySupplier: {} };
    writeOfflineReadSnapshot<SuppliersReadSnapshot>(SUPPLIERS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      ledgerBySupplier: { ...(existing.ledgerBySupplier || {}), ...(partial.ledgerBySupplier || {}) },
    });
  }, [readSnapshot]);

  useEffect(() => {
    if (!openActionId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-action-menu-root='true']")) return;
      setOpenActionId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenActionId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [openActionId]);

  const METHODS = [
    { value: "bank_transfer", label: t("bank_transfer") },
    { value: "tt", label: t("tt_payment") },
    { value: "lc", label: t("lc_payment") },
    { value: "cash", label: t("cash") },
    { value: "other", label: t("other") },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/suppliers", { params: { page, limit: DEFAULT_LIST_PAGE_SIZE } });
    if (r.success) {
      let nextRows = [...getPendingSuppliers(queuedItems as any), ...((r.data as any[]) || [])];
      nextRows = applyQueuedMutationsToSuppliers(nextRows, queuedItems as any[]);
      setSuppliers(nextRows);
      setTotalPages((r.pagination as any)?.totalPages || 1);
      setTotal((r.pagination as any)?.total || 0);
      mergeSnapshot({ suppliers: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.suppliers?.length) {
        const cleanedSuppliers = pruneStalePendingRows(snapshot.suppliers as any[], queuedItems as any[], "/suppliers");
        const mergedSnapshotSuppliers = applyQueuedMutationsToSuppliers(cleanedSuppliers, queuedItems as any[]);
        setSuppliers(mergedSnapshotSuppliers);
        setTotalPages(1);
        setTotal(mergedSnapshotSuppliers.length);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, page, queuedItems, readSnapshot]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (deepLinkHandled.current || loading || suppliers.length === 0) return;
    const supplierId = searchParams.get("supplier_id");
    if (!supplierId) return;
    const supplier = suppliers.find((row) => String(row.id) === supplierId);
    if (!supplier || isPendingSupplier(supplier)) return;
    deepLinkHandled.current = true;
    void openLedger(supplier, { openPayment: searchParams.get("create") === "1" });
  }, [loading, suppliers, searchParams]);

  const handleCreate = async () => {
    if (!form.name.trim()) { setError(t("name") + " required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/suppliers", { method: "POST", body: form });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (s: any) => {
    setSelected(s);
    setForm({ name: s.name || "", country: s.country || "", contact: s.contact || "", notes: s.notes || "" });
    setError("");
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!form.name.trim()) { setError(t("name") + " required"); return; }
    const pendingId = String(selected?.id || "");
    if (pendingId.startsWith("pending-")) {
      const queueId = pendingId.replace("pending-", "");
      const ok = await updateQueuedItem(queueId, { body: JSON.stringify(form) });
      if (!ok) {
        setError("Queued supplier entry not found. Retry from Activity.");
        return;
      }
      setSuppliers((prev) => {
        const next = prev.map((row: any) => (row.id === selected.id ? { ...row, ...form, _pending: true } : row));
        mergeSnapshot({ suppliers: next });
        return next;
      });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/suppliers/${selected.id}`, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openDelete = (s: any) => {
    setSelected(s);
    setShowDeleteConfirm(true);
  };

  const handleDelete = async () => {
    if (!selected) return;
    const pendingId = String(selected?.id || "");
    if (pendingId.startsWith("pending-")) {
      const queueId = pendingId.replace("pending-", "");
      await discardQueuedItem(queueId);
      setSuppliers((prev) => {
        const next = prev.filter((row: any) => row.id !== selected.id);
        mergeSnapshot({ suppliers: next });
        return next;
      });
      setShowDeleteConfirm(false);
      setSelected(null);
      return;
    }
    setDeleting(true);
    const r = await apiCall(`/api/v1/suppliers/${selected.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.success) { setShowDeleteConfirm(false); setSelected(null); load(); }
    else { alert(r.error || "Failed to delete"); }
  };

  const openLedger = async (s: any, opts?: { openPayment?: boolean }) => {
    if (isPendingSupplier(s)) {
      setError("Pending supplier is not synced yet. Please sync first.");
      return;
    }
    setSelected(s);
    setShowLedger(true);
    setLedgerData(null);
    const [r, lotR, bankR, intR] = await Promise.all([
      apiCall(`/api/v1/suppliers/${s.id}`),
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/super-admin-liabilities/options"),
      apiCall("/api/v1/intermediaries"),
    ]);
    if (r.success) {
      setLedgerData(r.data);
      mergeSnapshot({ ledgerBySupplier: { [String(s.id)]: r.data } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cachedLedger = snapshot?.ledgerBySupplier?.[String(s.id)];
      if (cachedLedger) {
        setLedgerData(cachedLedger);
        setShowOfflineSnapshot(true);
      }
    }
    if (lotR.success) {
      setLots(lotR.data as any[]);
      mergeSnapshot({ lots: lotR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.lots?.length) {
        setLots(snapshot.lots);
        setShowOfflineSnapshot(true);
      }
    }
    if (bankR.success) {
      const sourceOptions: any = bankR.data || {};
      const loadedAccounts = [
        ...(sourceOptions.superAdminAccounts || []).map((account: any) => ({ ...account, accountScope: "super_admin" })),
        ...(sourceOptions.cities || []).flatMap((city: any) => (city.bankAccounts || []).map((account: any) => ({ ...account, cityId: city.id, cityName: city.name, accountScope: "city", accountKind: "bank", currency: { code: "PKR" } }))),
      ];
      setBankAccounts(loadedAccounts);
      mergeSnapshot({ bankAccounts: loadedAccounts });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.bankAccounts?.length) {
        setBankAccounts(snapshot.bankAccounts);
        setShowOfflineSnapshot(true);
      }
    }
    if (intR.success) {
      setIntermediaries(intR.data as any[]);
      mergeSnapshot({ intermediaries: intR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.intermediaries?.length) {
        setIntermediaries(snapshot.intermediaries);
        setShowOfflineSnapshot(true);
      }
    }
    if (opts?.openPayment) {
      setPaymentForm({
        lotId: 0,
        paymentDate: new Date().toISOString().split("T")[0],
        amountUsd: 0,
        exchangeRate: 0,
        amountLocal: 0,
        paymentMethod: "bank_transfer",
        paidVia: "bank",
        bankAccountId: 0,
        superAdminBankAccountId: 0,
        intermediaryId: 0,
        reference: "",
        notes: "",
      });
      setError("");
      setShowPaymentCreate(true);
    }
  };

  useEffect(() => {
    if (paymentForm.paidVia !== "bank") return;
    const amountUsd = Number(paymentForm.amountUsd || 0);
    const exchangeRate = Number(paymentForm.exchangeRate || 0);
    const computedLocal = amountUsd > 0 && exchangeRate > 0
      ? Math.round(amountUsd * exchangeRate * 100) / 100
      : 0;
    setPaymentForm((prev) => (prev.amountLocal === computedLocal ? prev : { ...prev, amountLocal: computedLocal }));
  }, [paymentForm.amountUsd, paymentForm.exchangeRate, paymentForm.paidVia]);

  const refreshLedger = useCallback(async () => {
    if (!selected?.id) return;
    const r = await apiCall(`/api/v1/suppliers/${selected.id}`);
    if (r.success) setLedgerData(r.data);
    load();
  }, [selected?.id, load]);

  const exportSupplierLedger = () => {
    if (!selected || !ledgerData) return;
    exportSupplierLedgerXlsx({
      supplierName: selected.name || "Supplier",
      statement: ledgerData.statement || [],
      runningLedger: ledgerData.runningLedger || ledgerData.ledger || [],
    });
  };

  const openPaymentCreate = () => {
    setPaymentForm({
      lotId: 0,
      paymentDate: new Date().toISOString().split("T")[0],
      amountUsd: 0,
      exchangeRate: 0,
      amountLocal: 0,
      paymentMethod: "bank_transfer",
      paidVia: "bank",
      bankAccountId: 0,
      superAdminBankAccountId: 0,
      intermediaryId: 0,
      reference: "",
      notes: "",
    });
    setError("");
    setShowPaymentCreate(true);
  };

  const openPaymentEdit = (payment: any) => {
    setSelectedPayment(payment);
    setPaymentForm({
      lotId: payment.lotId || 0,
      paymentDate: payment.paymentDate,
      amountUsd: payment.amountUsd || 0,
      exchangeRate: payment.exchangeRate || 0,
      amountLocal: payment.amountLocal || 0,
      paymentMethod: payment.paymentMethod || "bank_transfer",
      paidVia: payment.intermediaryId ? "intermediary" : "bank",
      bankAccountId: payment.bankAccountId || 0,
      superAdminBankAccountId: payment.superAdminBankAccountId || 0,
      intermediaryId: payment.intermediaryId || 0,
      reference: payment.reference || "",
      notes: payment.notes || "",
    });
    setError("");
    setShowPaymentEdit(true);
  };

  const handlePaymentCreate = async () => {
    if (!selected?.id || !(paymentForm.amountUsd > 0)) {
      setError("Supplier and amount are required");
      return;
    }
    if (paymentForm.paidVia === "bank" && !paymentForm.superAdminBankAccountId) {
      setError("Please select a funding account");
      return;
    }
    if (paymentForm.paidVia === "bank" && !(paymentForm.exchangeRate > 0)) {
      setError("Exchange rate is required for bank payments");
      return;
    }
    if (paymentForm.paidVia === "intermediary" && !paymentForm.intermediaryId) {
      setError("Please select an intermediary");
      return;
    }

    setSubmitting(true);
    const body: any = {
      supplierId: selected.id,
      paymentDate: paymentForm.paymentDate,
      amountUsd: paymentForm.amountUsd,
      paymentMethod: paymentForm.paymentMethod,
      reference: paymentForm.reference || undefined,
      notes: paymentForm.notes || undefined,
    };
    if (!paymentForm.lotId) { setSubmitting(false); setError("Select the lot whose supplier liability is being paid"); return; }
    body.lotId = paymentForm.lotId;
    if (paymentForm.paidVia === "bank") {
      const selectedFundingAccount = bankAccounts.find((account: any) => account.id === paymentForm.superAdminBankAccountId);
      if (selectedFundingAccount?.accountScope === "city") body.bankAccountId = paymentForm.superAdminBankAccountId;
      else if (selectedFundingAccount?.accountKind === "cash") body.superAdminCashAccountId = paymentForm.superAdminBankAccountId;
      else body.superAdminBankAccountId = paymentForm.superAdminBankAccountId;
      body.exchangeRate = paymentForm.exchangeRate;
      body.amountLocal = paymentForm.amountLocal;
    } else {
      body.intermediaryId = paymentForm.intermediaryId;
      if (paymentForm.exchangeRate > 0) body.exchangeRate = paymentForm.exchangeRate;
    }

    const r = await apiCall("/api/v1/supplier-payments", { method: "POST", body });
    setSubmitting(false);
    if (r.success) {
      setShowPaymentCreate(false);
      await refreshLedger();
    } else {
      setError(r.error || "Failed");
    }
  };

  const handlePaymentEdit = async () => {
    if (!selectedPayment?.id) return;
    if (paymentForm.paidVia === "bank" && !(paymentForm.exchangeRate > 0)) {
      setError("Exchange rate is required for bank payments");
      return;
    }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/supplier-payments/${selectedPayment.id}`, {
      method: "PUT",
      body: {
        amountUsd: paymentForm.amountUsd,
        exchangeRate: paymentForm.exchangeRate || null,
        amountLocal: paymentForm.amountLocal || null,
        reference: paymentForm.reference,
        notes: paymentForm.notes,
      },
    });
    setSubmitting(false);
    if (r.success) {
      setShowPaymentEdit(false);
      await refreshLedger();
    } else {
      setError(r.error || "Failed");
    }
  };

  const handlePaymentDelete = async (payment: any) => {
    if (!confirm(`${t("confirm_delete_payment")} $${Number(payment.amountUsd || 0).toLocaleString("en-US")}`)) return;
    const r = await apiCall(`/api/v1/supplier-payments/${payment.id}`, { method: "DELETE" });
    if (r.success) {
      await refreshLedger();
    } else {
      alert(r.error || "Failed");
    }
  };

  const isSuperAdmin = user?.role === "super_admin";

  return (
    <div>
      <PageHeader
        title={t("suppliers")}
        action={
          <button
            onClick={() => { setForm({ name: "", country: "", contact: "", notes: "" }); setShowCreate(true); setError(""); }}
            className="btn-primary text-sm"
          >
            + {t("new_supplier")}
          </button>
        }
      />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}
      <DataTable
        columns={[
          {
            key: "name", label: t("suppliers"),
            render: (s: any) => (
              isPendingSupplier(s) ? (
                <span className="font-medium text-gray-500">{s.name}</span>
              ) : (
                <button onClick={() => openLedger(s)} className="font-medium text-primary-600 hover:underline">
                  {s.name}
                </button>
              )
            ),
          },
          { key: "country", label: t("country"), render: (s: any) => s.country || "-" },
          { key: "totalPurchases", label: t("purchases"), render: (s: any) => `$${formatNumber(Number(s.totalPurchases || 0))}` },
          { key: "totalPayments", label: t("payments"), render: (s: any) => `$${formatNumber(Number(s.totalPayments || 0))}` },
          ...(isSuperAdmin ? [{
            key: "actions", label: "",
            render: (s: any) => {
              const actionKey = `supplier-${s.id}`;
              return (
                <RowActionMenu
                  open={openActionId === actionKey}
                  onOpenChange={(open) => setOpenActionId(open ? actionKey : null)}
                >
                  <button
                    onClick={() => { setOpenActionId(null); openEdit(s); }}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs"
                  >
                    {t("edit")}
                  </button>
                  <button
                    onClick={() => { setOpenActionId(null); openDelete(s); }}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs"
                  >
                    {t("delete")}
                  </button>
                </RowActionMenu>
              );
            },
          }] : []),
        ]}
        data={suppliers}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_supplier")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("country")}</label><input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("contact")}</label><input value={form.contact} onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button>
        </div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit Supplier: ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("country")}</label><input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("contact")}</label><input value={form.contact} onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete Supplier" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <p className="font-semibold mb-1">Are you sure you want to delete this supplier?</p>
            <p>
              <span className="font-medium">{selected?.name}</span> will be removed. This action cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t">
            <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary text-sm">{t("cancel")}</button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {deleting ? "Deleting..." : "Delete Supplier"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("supplier")}: ${selected?.name || ""}`} size="lg">
        {!ledgerData ? <div className="py-8 text-center text-gray-400">{t("loading")}</div> : <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <StatsCard title={t("total_purchased")} value={`$${formatNumber(ledgerData.totalPurchasedUsd)}`} icon="📦" color="blue" />
            <StatsCard title={t("total_paid")} value={`$${formatNumber(ledgerData.totalPaidUsd)}`} icon="💰" color="green" />
            <StatsCard title={t("balance_owed")} value={`$${formatNumber(ledgerData.balanceOwed)}`} icon={ledgerData.balanceOwed > 0 ? "⚠️" : "✅"} color={ledgerData.balanceOwed > 0 ? "red" : "green"} />
          </div>
          {Object.keys(ledgerData.openingByCurrency || {}).length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-semibold">Opening balance:</span>{" "}
              {Object.entries(ledgerData.openingByCurrency).map(([code, amount]) => `${code} ${formatNumber(amount as number)}`).join(", ")}
            </div>
          )}
          {ledgerData.nextLotToPay && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">Next to pay:</span> Lot {ledgerData.nextLotToPay.invoiceNumber} — ${Number(ledgerData.nextLotToPay.lotBalanceUsd).toLocaleString("en-US")} USD remaining
            </div>
          )}
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => setLedgerTab("schedule")} className={`rounded-full px-3 py-1 text-xs font-medium ${ledgerTab === "schedule" ? "bg-[#5d4a3a] text-white" : "border border-gray-300 bg-white"}`}>Lot schedule (FIFO)</button>
            <button type="button" onClick={() => setLedgerTab("running")} className={`rounded-full px-3 py-1 text-xs font-medium ${ledgerTab === "running" ? "bg-[#5d4a3a] text-white" : "border border-gray-300 bg-white"}`}>Running balance</button>
          </div>
          {ledgerTab === "schedule" && (
          <>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-500">Supplier Statement (Lot-wise)</h4>
            <div className="flex items-center gap-3">
              <button onClick={exportSupplierLedger} className="text-xs text-emerald-700 hover:underline font-medium">
                Export XLSX
              </button>
              {isSuperAdmin && (
                <button onClick={() => openSuperAdminTransaction({ type: "supplier_payment", prefill: { partyId: Number(selected?.id || 0) }, onSuccess: refreshLedger })} className="text-xs text-primary-600 hover:underline font-medium">
                  + {t("record_payment")}
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#e8dbc9]">
            <table className="min-w-[1180px] w-full text-xs">
              <thead>
                <tr className="bg-[#f1e7da] text-[#5d4a37]">
                  <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">#</th>
                  <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">Invoice</th>
                  <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">Country</th>
                  <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">Order Details</th>
                  <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide">Qty (Tons)</th>
                  <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide">Amount (USD)</th>
                  <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide">Deposit</th>
                  <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide">Remaining</th>
                  <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide">Running Balance</th>
                  <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">Status</th>
                  <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide">Receipts</th>
                </tr>
              </thead>
              <tbody>
                {(ledgerData.statement || []).length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-sm text-gray-400">No lot statement entries</td>
                  </tr>
                )}
                {(ledgerData.statement || []).map((row: any, i: number) => (
                  <tr key={row.lotId} className={`${i % 2 === 1 ? "bg-[#fcf8f2]" : "bg-white"} border-t border-[#efe3d4]`}>
                    <td className="px-2 py-2 align-top text-gray-700">{row.itemNo}</td>
                    <td className="px-2 py-2 align-top font-semibold text-gray-800">{row.invoiceNumber}</td>
                    <td className="px-2 py-2 align-top text-gray-700">{row.marketCountry || "-"}</td>
                    <td className="px-2 py-2 align-top text-gray-700">{row.orderDetails || "-"}</td>
                    <td className="px-2 py-2 align-top text-right tabular-nums text-gray-700">{Number(row.quantityTons || 0).toLocaleString("en-US")}</td>
                    <td className="px-2 py-2 align-top text-right tabular-nums font-medium text-gray-800">${Number(row.amountUsd || 0).toLocaleString("en-US")}</td>
                    <td className="px-2 py-2 align-top text-right tabular-nums font-medium text-[#166534]">${Number(row.depositUsd || 0).toLocaleString("en-US")}</td>
                    <td className={`px-2 py-2 align-top text-right tabular-nums font-semibold ${Number(row.lotBalanceUsd || 0) > 0 ? "bg-red-600 text-white" : "text-[#166534]"}`}>
                      ${Number(row.lotBalanceUsd || 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-2 py-2 align-top text-right tabular-nums font-semibold text-[#7c2d12]">${Number(row.runningBalanceUsd || 0).toLocaleString("en-US")}</td>
                    <td className="px-2 py-2 align-top">
                      {row.status === "settled"
                        ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">Settled</span>
                        : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Pending</span>}
                    </td>
                    <td className="px-2 py-2 align-top text-gray-600">
                      {(row.appliedPayments || []).length
                        ? row.appliedPayments.map((p: any) => `$${Number(p.amountUsd).toLocaleString("en-US")} on ${formatDate(p.date)}`).join(" · ")
                        : (row.receiptNotes || "-")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
          )}

          {ledgerTab === "running" && (
          <>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-500">Running Balance Ledger (USD)</h4>
            <button onClick={exportSupplierLedger} className="text-xs text-emerald-700 hover:underline font-medium">Export XLSX</button>
          </div>
          <DataTable columns={[
            { key: "date", label: t("date") },
            { key: "particulars", label: t("description") },
            { key: "debitUsd", label: "Debit USD", render: (e: any) => e.debitUsd ? <span className="text-red-600">${Number(e.debitUsd).toLocaleString("en-US")}</span> : "" },
            { key: "creditUsd", label: "Credit USD", render: (e: any) => e.creditUsd ? <span className="text-green-600">${Number(e.creditUsd).toLocaleString("en-US")}</span> : "" },
            { key: "balanceUsd", label: "Balance USD", render: (e: any) => <span className="font-medium">${Number(e.balanceUsd).toLocaleString("en-US")}</span> },
          ]} data={ledgerData.runningLedger || ledgerData.ledger || []} loading={false} />
          </>
          )}
        </>}
      </Modal>

      <Modal open={showPaymentCreate} onClose={() => setShowPaymentCreate(false)} title={t("record_payment")} size="lg">
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("supplier")}</label>
              <input value={selected?.name || ""} className="input-field bg-gray-50 text-gray-500" disabled />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Lot *</label>
              <select value={paymentForm.lotId} onChange={(e) => setPaymentForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>Select lot</option>
                {lots.map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("date")} *</label><input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("amount_usd")} *</label><input type="number" step="0.01" value={paymentForm.amountUsd || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, amountUsd: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("method")} *</label><select value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="select-field">{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("exchange_rate")} *</label><input type="number" step="0.01" value={paymentForm.exchangeRate || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("local_amount")}</label><input type="number" step="0.01" value={paymentForm.amountLocal || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, amountLocal: parseFloat(e.target.value) || 0 }))} className="input-field" readOnly={paymentForm.paidVia === "bank"} onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("reference")}</label><input value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} className="input-field" /></div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Paid Via *</label>
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => setPaymentForm((f) => ({ ...f, paidVia: "bank", intermediaryId: 0 }))} className={`rounded border px-3 py-1 text-sm ${paymentForm.paidVia === "bank" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-600"}`}>Bank / Cash Account</button>
              <button type="button" onClick={() => setPaymentForm((f) => ({ ...f, paidVia: "intermediary", superAdminBankAccountId: 0, bankAccountId: 0 }))} className={`rounded border px-3 py-1 text-sm ${paymentForm.paidVia === "intermediary" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-600"}`}>Intermediary</button>
            </div>
            {paymentForm.paidVia === "bank" ? (
              <select value={paymentForm.superAdminBankAccountId} onChange={(e) => setPaymentForm((f) => ({ ...f, superAdminBankAccountId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("select")}</option>
                {bankAccounts.filter((b: any) => b.isActive !== false).map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.accountScope === "city" ? `${b.cityName} · ` : ""}{b.accountKind === "cash" ? "Cash · " : "Bank · "}{b.bankName}{b.accountNumber ? ` - ${b.accountNumber}` : ""}{b.currency?.code ? ` (${b.currency.code})` : ""}{b.runningBalance != null ? ` · Balance: ${Number(b.runningBalance).toLocaleString("en-US")}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <select value={paymentForm.intermediaryId} onChange={(e) => setPaymentForm((f) => ({ ...f, intermediaryId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("select")}</option>
                {intermediaries.filter((i: any) => i.isActive !== false).map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>
          <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("notes")}</label><input value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button onClick={handlePaymentCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button>
        </div>
      </Modal>

      <Modal open={showPaymentEdit} onClose={() => setShowPaymentEdit(false)} title={t("edit_payment")} size="md">
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("amount_usd")}</label><input type="number" step="0.01" value={paymentForm.amountUsd || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, amountUsd: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("exchange_rate")}</label><input type="number" step="0.01" value={paymentForm.exchangeRate || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
          </div>
          <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("reference")}</label><input value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} className="input-field" /></div>
          <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("notes")}</label><input value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button onClick={handlePaymentEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
