"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";
import * as XLSX from "xlsx";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingSuppliers } from "@/lib/offline-queue-overlays";

const SUPPLIERS_READ_CACHE_KEY = "mrf-suppliers-read-cache-v1";

type SuppliersReadSnapshot = {
  suppliers: any[];
  lots: any[];
  bankAccounts: any[];
  intermediaries: any[];
  ledgerBySupplier: Record<string, any>;
};

export default function SuppliersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, queuedItems } = useOffline();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [paymentForm, setPaymentForm] = useState({
    lotId: 0,
    paymentDate: new Date().toISOString().split("T")[0],
    amountUsd: 0,
    exchangeRate: 0,
    amountLocal: 0,
    paymentMethod: "bank_transfer",
    paidVia: "bank",
    bankAccountId: 0,
    intermediaryId: 0,
    reference: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");

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
    const r = await apiCall("/api/v1/suppliers", { params: { limit: 100 } });
    if (r.success) {
      const nextRows = [...getPendingSuppliers(queuedItems as any), ...((r.data as any[]) || [])];
      setSuppliers(nextRows);
      mergeSnapshot({ suppliers: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.suppliers?.length) {
        setSuppliers(snapshot.suppliers);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot]);
  useEffect(() => { load(); }, [load]);

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
    setDeleting(true);
    const r = await apiCall(`/api/v1/suppliers/${selected.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.success) { setShowDeleteConfirm(false); setSelected(null); load(); }
    else { alert(r.error || "Failed to delete"); }
  };

  const openLedger = async (s: any) => {
    setSelected(s);
    setShowLedger(true);
    setLedgerData(null);
    const [r, lotR, bankR, intR] = await Promise.all([
      apiCall(`/api/v1/suppliers/${s.id}`),
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/bank-accounts"),
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
      setBankAccounts(bankR.data as any[]);
      mergeSnapshot({ bankAccounts: bankR.data as any[] });
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

  const exportSupplierLedgerXlsx = () => {
    if (!selected || !ledgerData) return;

    const statementRows: any[][] = [];
    statementRows.push(["Supplier Ledger", selected.name || ""]);
    statementRows.push(["Generated", new Date().toISOString().split("T")[0]]);
    statementRows.push([]);
    statementRows.push(["Lot-wise Statement"]);
    statementRows.push(["#", "Invoice", "Country", "Order Details", "Qty (Tons)", "Amount (USD)", "Deposit (USD)", "Remaining (USD)", "Running Balance (USD)", "Status", "Receipts"]);
    for (const row of ledgerData.statement || []) {
      statementRows.push([
        row.itemNo,
        row.invoiceNumber || "",
        row.marketCountry || "",
        row.orderDetails || "",
        Number(row.quantityTons || 0),
        Number(row.amountUsd || 0),
        Number(row.depositUsd || 0),
        Number(row.lotBalanceUsd || 0),
        Number(row.runningBalanceUsd || 0),
        row.status === "settled" ? "Settled" : "Pending",
        row.receiptNotes || "",
      ]);
    }

    const chronologicalRows: any[][] = [];
    chronologicalRows.push(["Date", "Type", "Description", "Debit (USD)", "Credit (USD)", "Balance (USD)"]);
    for (const entry of ledgerData.ledger || []) {
      chronologicalRows.push([
        entry.date ? String(entry.date).split("T")[0] : "",
        entry.type || "",
        entry.description || "",
        entry.debit || 0,
        entry.credit || 0,
        entry.balance || 0,
      ]);
    }

    const workbook = XLSX.utils.book_new();
    const statementSheet = XLSX.utils.aoa_to_sheet(statementRows);
    const chronologicalSheet = XLSX.utils.aoa_to_sheet(chronologicalRows);
    XLSX.utils.book_append_sheet(workbook, statementSheet, "Statement");
    XLSX.utils.book_append_sheet(workbook, chronologicalSheet, "Chronological");

    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `supplier_ledger_${String(selected.name || "ledger").replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
    if (paymentForm.paidVia === "bank" && !paymentForm.bankAccountId) {
      setError("Please select a bank account");
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
    if (paymentForm.lotId) body.lotId = paymentForm.lotId;
    if (paymentForm.paidVia === "bank") {
      body.bankAccountId = paymentForm.bankAccountId;
      body.exchangeRate = paymentForm.exchangeRate;
      body.amountLocal = paymentForm.amountLocal;
    } else {
      if (paymentForm.exchangeRate > 0) body.exchangeRate = paymentForm.exchangeRate;
      if (paymentForm.amountLocal > 0) body.amountLocal = paymentForm.amountLocal;
      body.intermediaryId = paymentForm.intermediaryId;
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
        subtitle={t("payments_to_supplier_subtitle")}
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
              <button onClick={() => openLedger(s)} className="font-medium text-primary-600 hover:underline">
                {s.name}
              </button>
            ),
          },
          { key: "country", label: t("country"), render: (s: any) => s.country || "-" },
          { key: "totalPurchases", label: t("purchases"), render: (s: any) => `$${formatNumber(Number(s.totalPurchases || 0))}` },
          { key: "totalPayments", label: t("payments"), render: (s: any) => `$${formatNumber(Number(s.totalPayments || 0))}` },
          ...(isSuperAdmin ? [{
            key: "actions", label: "",
            render: (s: any) => (
              <div className="relative" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} data-action-menu-root="true">
                <button
                  type="button"
                  onPointerDown={(event) => { event.stopPropagation(); }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActionMenuDirection("down");
                    const actionKey = `supplier-${s.id}`;
                    setOpenActionId((current) => current === actionKey ? null : actionKey);
                  }}
                  className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
                  aria-label="Open actions"
                >
                  ⋯
                </button>
                {openActionId === `supplier-${s.id}` && (
                  <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                    <button
                      onClick={() => { setOpenActionId(null); openEdit(s); }}
                      className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50"
                    >
                      {t("edit")}
                    </button>
                    <button
                      onClick={() => { setOpenActionId(null); openDelete(s); }}
                      className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
                    >
                      {t("delete")}
                    </button>
                  </div>
                )}
              </div>
            ),
          }] : []),
        ]}
        data={suppliers}
        loading={loading}
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
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatsCard title={t("total_purchased")} value={`$${formatNumber(ledgerData.totalPurchasedUsd)}`} icon="📦" color="blue" />
            <StatsCard title={t("total_paid")} value={`$${formatNumber(ledgerData.totalPaidUsd)}`} icon="💰" color="green" />
            <StatsCard title={t("balance_owed")} value={`$${formatNumber(ledgerData.balanceOwed)}`} icon={ledgerData.balanceOwed > 0 ? "⚠️" : "✅"} color={ledgerData.balanceOwed > 0 ? "red" : "green"} />
          </div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-500">Supplier Statement (Lot-wise)</h4>
            <div className="flex items-center gap-3">
              <button onClick={exportSupplierLedgerXlsx} className="text-xs text-emerald-700 hover:underline font-medium">
                Export XLSX
              </button>
              {isSuperAdmin && (
                <button onClick={openPaymentCreate} className="text-xs text-primary-600 hover:underline font-medium">
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
                    <td className="px-2 py-2 align-top text-gray-600">{row.receiptNotes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-500">{t("ledger")} (Chronological)</h4>
          </div>
          <DataTable columns={[
            { key: "date", label: t("date") },
            { key: "type", label: t("type"), render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "purchase" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{e.type}</span> },
            { key: "description", label: t("description") },
            { key: "debit", label: t("debit_usd"), render: (e: any) => e.debit ? <span className="text-red-600">${e.debit.toLocaleString("en-US")}</span> : "" },
            { key: "credit", label: t("credit_usd"), render: (e: any) => e.credit ? <span className="text-green-600">${e.credit.toLocaleString("en-US")}</span> : "" },
            { key: "balance", label: t("balance"), render: (e: any) => <span className="font-medium">${e.balance.toLocaleString("en-US")}</span> },
            ...(isSuperAdmin ? [{
              key: "actions", label: "",
              render: (e: any) => {
                if (e.type !== "payment") return null;
                const payment = (ledgerData?.payments || []).find((p: any) => p.id === e.sourceId);
                if (!payment) return null;
                return (
                  <div className="relative" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} data-action-menu-root="true">
                    <button
                      type="button"
                      onPointerDown={(event) => { event.stopPropagation(); }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActionMenuDirection("down");
                        const actionKey = `supplier-payment-${payment.id}`;
                        setOpenActionId((current) => current === actionKey ? null : actionKey);
                      }}
                      className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
                      aria-label="Open actions"
                    >
                      ⋯
                    </button>
                    {openActionId === `supplier-payment-${payment.id}` && (
                      <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                        <button onClick={() => { setOpenActionId(null); openPaymentEdit(payment); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("edit")}</button>
                        <button onClick={() => { setOpenActionId(null); handlePaymentDelete(payment); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("delete")}</button>
                      </div>
                    )}
                  </div>
                );
              },
            }] : []),
          ]} data={ledgerData.ledger || []} loading={false} />
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
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("lot_optional")}</label>
              <select value={paymentForm.lotId} onChange={(e) => setPaymentForm((f) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("general_not_linked")}</option>
                {lots.map((l: any) => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("date")} *</label><input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("amount_usd")} *</label><input type="number" step="0.01" value={paymentForm.amountUsd || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, amountUsd: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("method")} *</label><select value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value }))} className="select-field">{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("exchange_rate")} {paymentForm.paidVia === "bank" ? "*" : ""}</label><input type="number" step="0.01" value={paymentForm.exchangeRate || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, exchangeRate: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("local_amount")}</label><input type="number" step="0.01" value={paymentForm.amountLocal || ""} onChange={(e) => setPaymentForm((f) => ({ ...f, amountLocal: parseFloat(e.target.value) || 0 }))} className="input-field" readOnly={paymentForm.paidVia === "bank"} onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="mb-1 block text-sm font-medium text-gray-700">{t("reference")}</label><input value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} className="input-field" /></div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Paid Via *</label>
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => setPaymentForm((f) => ({ ...f, paidVia: "bank", intermediaryId: 0 }))} className={`rounded border px-3 py-1 text-sm ${paymentForm.paidVia === "bank" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-600"}`}>Bank Account</button>
              <button type="button" onClick={() => setPaymentForm((f) => ({ ...f, paidVia: "intermediary", bankAccountId: 0 }))} className={`rounded border px-3 py-1 text-sm ${paymentForm.paidVia === "intermediary" ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-600"}`}>Intermediary</button>
            </div>
            {paymentForm.paidVia === "bank" ? (
              <select value={paymentForm.bankAccountId} onChange={(e) => setPaymentForm((f) => ({ ...f, bankAccountId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("select")}</option>
                {bankAccounts.filter((b: any) => b.isActive !== false).map((b: any) => <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` - ${b.accountNumber}` : ""}</option>)}
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
