"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, formatNumber, formatDate, RowActionMenu } from "@/components/ui";
import * as XLSX from "xlsx";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingIntermediaries } from "@/lib/offline-queue-overlays";
import { applyPendingIntermediaryLedger } from "@/lib/offline-intermediary-ledger";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";

const INTERMEDIARIES_READ_CACHE_KEY = "mrf-intermediaries-read-cache-v1";

type IntermediariesReadSnapshot = {
  intermediaries: any[];
  currencies: any[];
  superAdminBankAccounts: any[];
  ledgerByIntermediary: Record<string, any>;
};

function applyQueuedMutationsToIntermediaries(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/intermediaries/")) continue;
    const match = url.match(/^\/api\/v1\/intermediaries\/([^/?#]+)/);
    const intermediaryId = match?.[1];
    if (!intermediaryId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== intermediaryId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === intermediaryId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            notes: patch?.notes ?? row?.notes,
            isActive: typeof patch?.isActive === "boolean" ? patch.isActive : row?.isActive,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

const EMPTY_DEPOSIT = {
  depositDate: new Date().toISOString().split("T")[0],
  amount: "",
  currencyId: "",
  superAdminBankAccountId: "",
  notes: "",
};

const EMPTY_EXCHANGE = {
  exchangeDate: new Date().toISOString().split("T")[0],
  baseCurrencyId: "",
  quoteCurrencyId: "",
  fromCurrencyId: "",
  fromAmount: "",
  toCurrencyId: "",
  exchangeRate: "",
  notes: "",
};

function parseAmountInput(raw: string): number | null {
  const normalized = String(raw || "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function calculateToAmount(
  fromAmount: string,
  exchangeRate: string,
  baseCurrencyId: string,
  quoteCurrencyId: string,
  fromCurrencyId: string,
  toCurrencyId: string,
): { toAmount: number; operation: "multiply" | "divide" | null; isPairValid: boolean } {
  const from = parseAmountInput(fromAmount);
  const rate = parseAmountInput(exchangeRate);
  if (!from || !rate || !baseCurrencyId || !quoteCurrencyId || !fromCurrencyId || !toCurrencyId) {
    return { toAmount: 0, operation: null, isPairValid: true };
  }
  if (fromCurrencyId === baseCurrencyId && toCurrencyId === quoteCurrencyId) {
    return { toAmount: Math.round((from * rate) * 100) / 100, operation: "multiply", isPairValid: true };
  }
  if (fromCurrencyId === quoteCurrencyId && toCurrencyId === baseCurrencyId) {
    return { toAmount: Math.round((from / rate) * 100) / 100, operation: "divide", isPairValid: true };
  }
  return { toAmount: 0, operation: null, isPairValid: false };
}

function compactLedgerDescription(entry: { description?: string; type?: string }) {
  const d = String(entry.description || "").trim();
  if (!d) return "—";
  if (entry.type === "deposit") {
    return d
      .replace(/^Deposit\s*/i, "Dep ")
      .replace(/\s*via\s+/g, " · ")
      .replace(/\([^)]+\)\s*/g, "")
      .trim();
  }
  if (entry.type === "payment") {
    return d.replace(/^Supplier payment — /i, "Pay · ");
  }
  if (entry.type === "exchange_out" || entry.type === "exchange_in") {
    return d;
  }
  return d.length > 42 ? `${d.slice(0, 40)}…` : d;
}

export default function IntermediariesPage() {
  const { user } = useAuth();
  const { isOnline, queuedItems, updateQueuedItem, discardQueuedItem } = useOffline();
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ name: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [showLedger, setShowLedger] = useState(false);
  const [ledger, setLedger] = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const [showExchange, setShowExchange] = useState(false);

  const [showDeposit, setShowDeposit] = useState(false);
  const [depositForm, setDepositForm] = useState({ ...EMPTY_DEPOSIT });
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositError, setDepositError] = useState("");

  const [showEditDeposit, setShowEditDeposit] = useState(false);
  const [editDepositId, setEditDepositId] = useState<number | null>(null);
  const [editDepositForm, setEditDepositForm] = useState({ ...EMPTY_DEPOSIT });
  const [editDepositSubmitting, setEditDepositSubmitting] = useState(false);
  const [editDepositError, setEditDepositError] = useState("");

  const [exchangeForm, setExchangeForm] = useState({ ...EMPTY_EXCHANGE });
  const [exchangeSubmitting, setExchangeSubmitting] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [showEditExchange, setShowEditExchange] = useState(false);
  const [editExchangeId, setEditExchangeId] = useState<number | null>(null);
  const [editExchangeForm, setEditExchangeForm] = useState({ ...EMPTY_EXCHANGE });
  const [editExchangeSubmitting, setEditExchangeSubmitting] = useState(false);
  const [editExchangeError, setEditExchangeError] = useState("");

  const [currencies, setCurrencies] = useState<any[]>([]);
  const [superAdminBankAccounts, setSuperAdminBankAccounts] = useState<any[]>([]);

  const [ledgerCurrencyFilter, setLedgerCurrencyFilter] = useState<string>("");
  const [ledgerDateFilter, setLedgerDateFilter] = useState<string>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [openLedgerActionId, setOpenLedgerActionId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<IntermediariesReadSnapshot>(INTERMEDIARIES_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<IntermediariesReadSnapshot>) => {
    const existing = readSnapshot()?.data || { intermediaries: [], currencies: [], superAdminBankAccounts: [], ledgerByIntermediary: {} };
    writeOfflineReadSnapshot<IntermediariesReadSnapshot>(INTERMEDIARIES_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      ledgerByIntermediary: { ...(existing.ledgerByIntermediary || {}), ...(partial.ledgerByIntermediary || {}) },
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/intermediaries");
    if (r.success) {
      let nextRows = [...getPendingIntermediaries(queuedItems as any), ...((r.data as any[]) || [])];
      nextRows = applyQueuedMutationsToIntermediaries(nextRows, queuedItems as any[]);
      setIntermediaries(nextRows);
      mergeSnapshot({ intermediaries: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.intermediaries?.length) {
        const cleanedIntermediaries = pruneStalePendingRows(snapshot.intermediaries as any[], queuedItems as any[], "/intermediaries");
        const mergedSnapshotIntermediaries = applyQueuedMutationsToIntermediaries(cleanedIntermediaries, queuedItems as any[]);
        setIntermediaries(mergedSnapshotIntermediaries);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot]);
  useEffect(() => { load(); }, [load]);

  const loadRefData = async () => {
    const [c, saBanks] = await Promise.all([
      apiCall("/api/v1/currencies"),
      apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }),
    ]);
    if (c.success) {
      const loadedCurrencies = c.data as any[];
      setCurrencies(loadedCurrencies);
      mergeSnapshot({ currencies: loadedCurrencies });
      setShowOfflineSnapshot(false);
      if (loadedCurrencies.length >= 2) {
        setExchangeForm((prev) => ({
          ...prev,
          baseCurrencyId: prev.baseCurrencyId || String(loadedCurrencies[0].id),
          quoteCurrencyId: prev.quoteCurrencyId || String(loadedCurrencies[1].id),
          fromCurrencyId: prev.fromCurrencyId || String(loadedCurrencies[0].id),
          toCurrencyId: prev.toCurrencyId || String(loadedCurrencies[1].id),
        }));
      }
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.currencies?.length) {
        setCurrencies(snapshot.currencies);
        setShowOfflineSnapshot(true);
      }
    }
    if (saBanks.success) {
      setSuperAdminBankAccounts(saBanks.data as any[]);
      mergeSnapshot({ superAdminBankAccounts: saBanks.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.superAdminBankAccounts?.length) {
        setSuperAdminBankAccounts(snapshot.superAdminBankAccounts);
        setShowOfflineSnapshot(true);
      }
    }
  };

  const openLedger = async (item: any) => {
    if (getPendingQueueId(item?.id)) {
      setFormError("Pending intermediary is not synced yet. Please sync first.");
      return;
    }
    setLedgerCurrencyFilter("");
    setLedgerDateFilter("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setLedgerPage(1);
    setOpenLedgerActionId(null);
    setExchangeForm({ ...EMPTY_EXCHANGE });
    setExchangeError("");
    await loadRefData();
    setSelected(item);
    setShowLedger(true);
    setLedgerLoading(true);
    const params = buildLedgerParams(item.id, 1);
    const r = await apiCall(`/api/v1/intermediaries/${item.id}`, { params });
    if (r.success) {
      const ledgerPayload = applyPendingIntermediaryLedger(r.data as any, queuedItems as any, item.id, currencies as any);
      setLedger(ledgerPayload);
      setTotalPages((ledgerPayload?.pagination as any)?.totalPages || 1);
      setTotal((ledgerPayload?.pagination as any)?.total || 0);
      mergeSnapshot({ ledgerByIntermediary: { [String(item.id)]: ledgerPayload } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cachedLedger = snapshot?.ledgerByIntermediary?.[String(item.id)];
      if (cachedLedger) {
        const mergedCached = applyPendingIntermediaryLedger(cachedLedger, queuedItems as any, item.id, currencies as any);
        setLedger(mergedCached);
        setTotalPages((cachedLedger?.pagination as any)?.totalPages || 1);
        setTotal((cachedLedger?.pagination as any)?.total || 0);
        setShowOfflineSnapshot(true);
      }
    }
    setLedgerLoading(false);
  };

  const buildLedgerParams = (id: number, page: number) => {
    const params: any = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    const dateFilter = ledgerDateFilter;
    if (dateFilter === "custom" && customStartDate && customEndDate) {
      params.startDate = customStartDate;
      params.endDate = customEndDate;
    } else if (dateFilter === "7days") {
      const d7 = new Date(); d7.setDate(d7.getDate() - 7);
      params.startDate = d7.toISOString().split("T")[0];
      params.endDate = new Date().toISOString().split("T")[0];
    } else if (dateFilter === "month") {
      const d = new Date();
      params.startDate = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
      params.endDate = new Date().toISOString().split("T")[0];
    }
    return params;
  };

  const handleLedgerPageChange = async (newPage: number) => {
    if (!selected?.id) return;
    setLedgerPage(newPage);
    setLedgerLoading(true);
    const params = buildLedgerParams(selected.id, newPage);
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}`, { params });
    if (r.success) {
      const ledgerPayload = applyPendingIntermediaryLedger(r.data as any, queuedItems as any, selected.id, currencies as any);
      setLedger(ledgerPayload);
      setTotalPages((ledgerPayload?.pagination as any)?.totalPages || 1);
      setTotal((ledgerPayload?.pagination as any)?.total || 0);
    }
    setLedgerLoading(false);
  };

  const openDeposit = async () => {
    await loadRefData();
    setDepositForm({ ...EMPTY_DEPOSIT });
    setDepositError("");
    setShowDeposit(true);
  };

  const openExchangeModal = async () => {
    await loadRefData();
    setExchangeForm({ ...EMPTY_EXCHANGE });
    setExchangeError("");
    setShowExchange(true);
  };

  const handleDeposit = async () => {
    const parsedAmount = parseAmountInput(depositForm.amount);
    if (!parsedAmount) { setDepositError("Enter a valid amount greater than 0"); return; }
    if (!depositForm.currencyId) { setDepositError("Currency is required"); return; }
    if (!depositForm.superAdminBankAccountId) { setDepositError("Super admin bank account is required"); return; }
    setDepositSubmitting(true);
    const body: any = {
      depositDate: depositForm.depositDate,
      amount: parsedAmount,
      currencyId: Number(depositForm.currencyId),
      superAdminBankAccountId: Number(depositForm.superAdminBankAccountId),
      notes: depositForm.notes || null,
    };
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}/deposits`, { method: "POST", body });
    setDepositSubmitting(false);
    if (r.success) { setShowDeposit(false); openLedger(selected); } else { setDepositError(r.error || "Failed"); }
  };

  const openEditDeposit = async (entry: any) => {
    await loadRefData();
    setEditDepositId(entry.id);
    setEditDepositForm({
      depositDate: entry.date?.split("T")[0] || "",
      amount: String(entry.debit),
      currencyId: String(entry.currencyId || ""),
      superAdminBankAccountId: String(entry.superAdminBankAccountId || ""),
      notes: String(entry.notes || ""),
    });
    setEditDepositError("");
    setShowEditDeposit(true);
  };

  const handleEditDeposit = async () => {
    if (!editDepositId) return;
    const parsedAmount = parseAmountInput(editDepositForm.amount);
    if (!parsedAmount) { setEditDepositError("Enter a valid amount greater than 0"); return; }
    if (!editDepositForm.superAdminBankAccountId) { setEditDepositError("Super admin bank account is required"); return; }
    setEditDepositSubmitting(true);
    const body: any = {
      depositDate: editDepositForm.depositDate,
      amount: parsedAmount,
      notes: editDepositForm.notes || null,
    };
    if (editDepositForm.currencyId) body.currencyId = Number(editDepositForm.currencyId);
    if (editDepositForm.superAdminBankAccountId) body.superAdminBankAccountId = Number(editDepositForm.superAdminBankAccountId);
    const r = await apiCall(`/api/v1/intermediary-deposits/${editDepositId}`, { method: "PUT", body });
    setEditDepositSubmitting(false);
    if (r.success) { setShowEditDeposit(false); openLedger(selected); } else { setEditDepositError(r.error || "Failed"); }
  };

  const handleDeleteDeposit = async (id: number) => {
    if (!confirm("Delete this deposit? The journal entry will be reversed.")) return;
    await apiCall(`/api/v1/intermediary-deposits/${id}`, { method: "DELETE" });
    openLedger(selected);
  };

  const handleExchange = async () => {
    if (!selected?.id) return;
    const fromAmount = parseAmountInput(exchangeForm.fromAmount);
    const exchangeRate = parseAmountInput(exchangeForm.exchangeRate);
    if (!exchangeForm.baseCurrencyId || !exchangeForm.quoteCurrencyId) { setExchangeError("Select base and quote currencies for the rate"); return; }
    if (exchangeForm.baseCurrencyId === exchangeForm.quoteCurrencyId) { setExchangeError("Base and quote currencies must be different"); return; }
    if (!exchangeForm.fromCurrencyId || !exchangeForm.toCurrencyId) { setExchangeError("Select both currencies"); return; }
    if (exchangeForm.fromCurrencyId === exchangeForm.toCurrencyId) { setExchangeError("From and To currencies must be different"); return; }
    if (!fromAmount) { setExchangeError("Enter a valid from amount"); return; }
    if (!exchangeRate) { setExchangeError("Enter a valid exchange rate"); return; }
    const exchangeCalc = calculateToAmount(exchangeForm.fromAmount, exchangeForm.exchangeRate, exchangeForm.baseCurrencyId, exchangeForm.quoteCurrencyId, exchangeForm.fromCurrencyId, exchangeForm.toCurrencyId);
    if (!exchangeCalc.isPairValid) { setExchangeError("From/To must match selected base/quote pair"); return; }
    setExchangeSubmitting(true);
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}/exchanges`, {
      method: "POST",
      body: {
        exchangeDate: exchangeForm.exchangeDate,
        baseCurrencyId: Number(exchangeForm.baseCurrencyId),
        quoteCurrencyId: Number(exchangeForm.quoteCurrencyId),
        fromCurrencyId: Number(exchangeForm.fromCurrencyId),
        fromAmount,
        toCurrencyId: Number(exchangeForm.toCurrencyId),
        exchangeRate,
        notes: exchangeForm.notes || null,
      },
    });
    setExchangeSubmitting(false);
    if (r.success) { setShowExchange(false); setExchangeForm({ ...EMPTY_EXCHANGE }); setExchangeError(""); openLedger(selected); } else { setExchangeError(r.error || "Failed to execute exchange"); }
  };

  const openEditExchange = async (exchange: any) => {
    await loadRefData();
    setEditExchangeId(exchange.id);
    setEditExchangeForm({
      exchangeDate: String(exchange.exchangeDate || "").split("T")[0] || new Date().toISOString().split("T")[0],
      baseCurrencyId: String(exchange.baseCurrencyId || exchange.fromCurrencyId || ""),
      quoteCurrencyId: String(exchange.quoteCurrencyId || exchange.toCurrencyId || ""),
      fromCurrencyId: String(exchange.fromCurrencyId || ""),
      fromAmount: String(exchange.fromAmount || ""),
      toCurrencyId: String(exchange.toCurrencyId || ""),
      exchangeRate: String(exchange.exchangeRate || ""),
      notes: exchange.notes || "",
    });
    setEditExchangeError("");
    setShowEditExchange(true);
  };

  const handleEditExchange = async () => {
    if (!editExchangeId) return;
    const fromAmount = parseAmountInput(editExchangeForm.fromAmount);
    const exchangeRate = parseAmountInput(editExchangeForm.exchangeRate);
    if (!editExchangeForm.baseCurrencyId || !editExchangeForm.quoteCurrencyId) { setEditExchangeError("Select base and quote currencies for the rate"); return; }
    if (editExchangeForm.baseCurrencyId === editExchangeForm.quoteCurrencyId) { setEditExchangeError("Base and quote currencies must be different"); return; }
    if (!editExchangeForm.fromCurrencyId || !editExchangeForm.toCurrencyId) { setEditExchangeError("Select both currencies"); return; }
    if (editExchangeForm.fromCurrencyId === editExchangeForm.toCurrencyId) { setEditExchangeError("From and To currencies must be different"); return; }
    if (!fromAmount) { setEditExchangeError("Enter a valid from amount"); return; }
    if (!exchangeRate) { setEditExchangeError("Enter a valid exchange rate"); return; }
    const exchangeCalc = calculateToAmount(editExchangeForm.fromAmount, editExchangeForm.exchangeRate, editExchangeForm.baseCurrencyId, editExchangeForm.quoteCurrencyId, editExchangeForm.fromCurrencyId, editExchangeForm.toCurrencyId);
    if (!exchangeCalc.isPairValid) { setEditExchangeError("From/To must match selected base/quote pair"); return; }
    setEditExchangeSubmitting(true);
    const r = await apiCall(`/api/v1/intermediary-exchanges/${editExchangeId}`, {
      method: "PUT",
      body: {
        exchangeDate: editExchangeForm.exchangeDate,
        baseCurrencyId: Number(editExchangeForm.baseCurrencyId),
        quoteCurrencyId: Number(editExchangeForm.quoteCurrencyId),
        fromCurrencyId: Number(editExchangeForm.fromCurrencyId),
        fromAmount,
        toCurrencyId: Number(editExchangeForm.toCurrencyId),
        exchangeRate,
        notes: editExchangeForm.notes || null,
      },
    });
    setEditExchangeSubmitting(false);
    if (r.success) { setShowEditExchange(false); setEditExchangeId(null); openLedger(selected); } else { setEditExchangeError(r.error || "Failed to update exchange"); }
  };

  const handleDeleteExchange = async (exchangeId: number) => {
    if (!confirm("Delete this exchange? The journal entries will be reversed.")) return;
    const r = await apiCall(`/api/v1/intermediary-exchanges/${exchangeId}`, { method: "DELETE" });
    if (!r.success) { setExchangeError(r.error || "Failed to delete exchange"); return; }
    openLedger(selected);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError("Name required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/intermediaries", { method: "POST", body: form });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setFormError(r.error || "Failed"); }
  };

  const getPendingQueueId = (id: unknown) => {
    if (typeof id !== "string" || !id.startsWith("pending-")) return null;
    return id.replace("pending-", "");
  };

  const openEdit = (item: any) => {
    setSelected(item);
    setForm({ name: item.name, notes: item.notes || "" });
    setFormError("");
    setShowEdit(true);
  };

  const handleEdit = async () => {
    const pendingQueueId = getPendingQueueId(selected?.id);
    if (pendingQueueId) {
      const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(form) });
      if (!ok) { setFormError("Unable to update pending entry"); return; }
      const nextRows = intermediaries.map((row) => row.id === selected.id ? { ...row, ...form } : row);
      setIntermediaries(nextRows);
      mergeSnapshot({ intermediaries: nextRows });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const r = await apiCall(`/api/v1/intermediaries/${selected.id}`, { method: "PUT", body: form });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setFormError(r.error || "Failed"); }
  };

  const handleToggleActive = async (item: any) => {
    const action = item.isActive ? "deactivate" : "reactivate";
    if (!confirm(`Do you want to ${action} intermediary "${item.name}"?`)) return;
    const pendingQueueId = getPendingQueueId(item.id);
    if (pendingQueueId) {
      if (item.isActive) {
        const ok = await discardQueuedItem(pendingQueueId);
        if (!ok) { setFormError("Unable to remove pending intermediary"); return; }
        const nextRows = intermediaries.filter((row) => row.id !== item.id);
        setIntermediaries(nextRows);
        mergeSnapshot({ intermediaries: nextRows });
        return;
      }
      setFormError("Pending intermediary cannot be reactivated until it is synced.");
      return;
    }
    const r = await apiCall(`/api/v1/intermediaries/${item.id}`, { method: "PUT", body: { isActive: !item.isActive } });
    if (!r.success) { setFormError(r.error || "Failed"); return; }
    if (selected?.id === item.id) { setSelected((prev: any) => prev ? { ...prev, isActive: !item.isActive } : prev); }
    load();
  };

  const escHtml = (value: any) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const exportIntermediaryLedgerXlsx = () => {
    if (!selected || !ledger?.ledger) return;
    const rows: any[][] = [];
    rows.push(["Intermediary Ledger", selected.name || ""]);
    rows.push(["Generated", new Date().toISOString().split("T")[0]]);
    rows.push([]);
    rows.push(["Date", "Particulars", "Debit", "Credit", "Running Balance"]);
    for (const entry of ledger.ledger || []) {
      rows.push([
        formatDate(entry.date),
        entry.description || "",
        entry.debit > 0 ? entry.debit : "",
        entry.credit > 0 ? entry.credit : "",
        entry.balance ?? "",
      ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Intermediary Ledger");
    const wbout = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intermediary_ledger_${String(selected.name || "ledger").replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportIntermediaryLedgerPdf = () => {
    if (!selected || !ledger?.ledger) return;
    const balanceRows = Object.entries(ledger.balances || {}).map(([code, amount]) => {
      const bal = Number(amount || 0);
      return `
        <div class="balance-card ${bal >= 0 ? "positive" : "negative"}">
          <span class="currency">${localCurrencyName(code)}</span>
          <span class="amount">${formatNumber(bal)}</span>
        </div>
      `;
    }).join("");
    
    const rowsHtml = (ledger.ledger || []).map((entry: any) => `
      <tr>
        <td>${escHtml(formatDate(entry.date))}</td>
        <td>${escHtml(entry.description || "")}</td>
        <td class="num">${entry.debit > 0 ? escHtml(formatNumber(entry.debit)) : "—"}</td>
        <td class="num">${entry.credit > 0 ? escHtml(formatNumber(entry.credit)) : "—"}</td>
        <td class="num ${entry.balance >= 0 ? "pos" : "neg"}">${escHtml(formatNumber(entry.balance))}</td>
      </tr>
    `).join("");
    
    const totalEntries = ledger.ledger?.length || 0;
    const html = `
      <!DOCTYPE html>
      <html><head><title>Intermediary Ledger - ${escHtml(selected.name || "")}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 0; color: #1a1a1a; background: #fff; }
        .header { background: linear-gradient(135deg, #1a0505 0%, #3d0808 100%); color: #fff; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .shield { width: 42px; height: 48px; }
        .brand-text h1 { font-family: Georgia, serif; font-size: 18px; font-weight: bold; letter-spacing: 2px; margin: 0; }
        .brand-text span { font-size: 9px; letter-spacing: 3px; opacity: 0.7; text-transform: uppercase; }
        .meta { text-align: right; font-size: 12px; opacity: 0.85; line-height: 1.6; }
        .title-section { padding: 20px 32px 12px; border-bottom: 2px solid #D4AF37; }
        .title-section h2 { font-size: 22px; color: #1a0505; margin-bottom: 4px; }
        .title-section p { font-size: 12px; color: #666; }
        
        .balances { padding: 20px 32px; background: #fafafa; display: flex; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid #e5e5e5; }
        .balance-card { flex: 1; min-width: 120px; padding: 14px 18px; border-radius: 8px; background: #fff; border: 1px solid #e5e5e5; display: flex; flex-direction: column; gap: 4px; }
        .balance-card.positive { border-left: 3px solid #16a34a; }
        .balance-card.negative { border-left: 3px solid #dc2626; }
        .balance-card .currency { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
        .balance-card .amount { font-size: 18px; font-weight: 600; color: #1a1a1a; }
        .balance-card.positive .amount { color: #16a34a; }
        .balance-card.negative .amount { color: #dc2626; }
        
        .table-wrapper { padding: 20px 32px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        thead { background: #f5f0e8; }
        th { padding: 10px 12px; text-align: left; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #444; border-bottom: 2px solid #D4AF37; }
        th.num { text-align: right; }
        td { padding: 9px 12px; border-bottom: 1px solid #eee; color: #333; }
        td.num { text-align: right; font-family: 'Consolas', monospace; }
        td.pos { color: #16a34a; font-weight: 500; }
        td.neg { color: #dc2626; font-weight: 500; }
        tr:hover { background: #fafafa; }
        
        .footer { padding: 16px 32px; background: #fafafa; font-size: 10px; color: #888; display: flex; justify-content: space-between; border-top: 1px solid #e5e5e5; }
      </style></head><body>
        <div class="header">
          <div class="brand">
            <svg class="shield" viewBox="0 0 50 55" fill="none"><path d="M25 2L45 9V33C45 48 25 54 25 54S5 48 5 33V9L25 2Z" fill="#6B0F1A"/><path d="M25 2L45 9V33C45 48 25 54 25 54S5 48 5 33V9L25 2Z" stroke="#D4AF37" stroke-width="1.5"/></svg>
            <div class="brand-text">
              <h1>MRF HARDWARE</h1>
              <span>Management System</span>
            </div>
          </div>
          <div class="meta">
            Intermediary Ledger Report<br/>
            Generated: ${escHtml(new Date().toISOString().split("T")[0])}
          </div>
        </div>
        
        <div class="title-section">
          <h2>${escHtml(selected.name || "Intermediary")}</h2>
          <p>${totalEntries} transaction${totalEntries !== 1 ? "s" : ""} · Running Balance Statement</p>
        </div>
        
        <div class="balances">
          ${balanceRows || '<div class="balance-card"><span class="currency">No balances</span></div>'}
        </div>
        
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th class="num">Debit</th>
                <th class="num">Credit</th>
                <th class="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#888;">No ledger entries</td></tr>'}
            </tbody>
          </table>
        </div>
        
        <div class="footer">
          <span>MRF Hardware Management System</span>
          <span>Page 1 of 1</span>
        </div>
      </body></html>
    `;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => { if (document.body.contains(iframe)) document.body.removeChild(iframe); }, 2000);
    }, 200);
  };

  const currencyCodeById = useCallback((id: string) => {
    if (!id) return "";
    return currencies.find((c: any) => String(c.id) === String(id))?.code || "";
  }, [currencies]);

  const localCurrencyName = (code: string) => {
    const map: Record<string, string> = { AFN: "افغانی", PKR: "کلداری", AED: "درھم", USD: "ڈالر" };
    return map[code] || code;
  };

  const isSA = user?.role === "super_admin";
  if (!isSA) return <div className="p-8 text-center text-gray-400">Access restricted to Super Admin.</div>;

  const columns = [
    {
      key: "name", label: "Name",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {!getPendingQueueId(row?.id) ? (
            <button type="button" onClick={() => openLedger(row)} className="font-medium text-primary-600 hover:underline text-left">
              {row.name}
            </button>
          ) : (
            <span className="font-medium">{row.name}</span>
          )}
          {!row.isActive && <span className="badge-cancelled text-xs">Inactive</span>}
        </div>
      ),
    },
    { key: "notes", label: "Notes", render: (row: any) => <span className="text-gray-500 text-sm">{row.notes || "—"}</span> },
    {
      key: "actions", label: "",
      render: (row: any) => (
        <div className="flex items-center gap-3">
          <button onClick={() => openEdit(row)} className="text-amber-600 hover:underline text-sm">Edit</button>
          <button onClick={() => handleToggleActive(row)} className={`hover:underline text-sm ${row.isActive ? "text-red-600" : "text-green-600"}`}>
            {row.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      ),
    },
  ];

  const exchangePreview = calculateToAmount(exchangeForm.fromAmount, exchangeForm.exchangeRate, exchangeForm.baseCurrencyId, exchangeForm.quoteCurrencyId, exchangeForm.fromCurrencyId, exchangeForm.toCurrencyId);
  const editExchangePreview = calculateToAmount(editExchangeForm.fromAmount, editExchangeForm.exchangeRate, editExchangeForm.baseCurrencyId, editExchangeForm.quoteCurrencyId, editExchangeForm.fromCurrencyId, editExchangeForm.toCurrencyId);

  return (
    <div>
      <PageHeader
        title="Intermediaries"
        action={isSA && (
          <button onClick={() => { setForm({ name: "", notes: "" }); setFormError(""); setShowCreate(true); }} className="btn-primary text-sm">
            + Add Intermediary
          </button>
        )}
      />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      <DataTable columns={columns} data={intermediaries} loading={loading} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Intermediary" size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="Enter intermediary name" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field" rows={3} placeholder="Optional remarks" />
          </div>
          {formError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Intermediary" size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field" rows={3} />
          </div>
          {formError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showLedger} onClose={() => { setShowLedger(false); setOpenLedgerActionId(null); }} title={`Ledger — ${selected?.name}`} size="lg">
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[#d4d4d8] bg-[#f4f4f5]/90 px-3 py-2">
            <div className="flex flex-col items-start gap-1">
              {ledger && Object.keys(ledger.balances || {}).length > 0 ? (
                Object.entries(ledger.balances || {}).map(([code, amount]) => {
                  const bal = Number(amount || 0);
                  return (
                    <span
                      key={code}
                      className={`rounded border px-2 py-0.5 text-xs font-medium tabular-nums ${bal >= 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
                    >
                      {code} {formatNumber(bal)}
                    </span>
                  );
                })
              ) : (
                <span className="text-xs text-gray-500">No balance</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={exportIntermediaryLedgerXlsx} className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100">XLSX</button>
              <button onClick={exportIntermediaryLedgerPdf} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100">PDF</button>
              <button onClick={openExchangeModal} className="rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700">+ FX</button>
              <button onClick={openDeposit} className="btn-primary px-2 py-1 text-[11px]">+ Deposit</button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-gray-200 bg-gray-50/60 px-2.5 py-1.5 text-xs">
            <label className="flex items-center gap-1.5 text-gray-600">
              <span className="font-medium">Date</span>
              <select
                value={ledgerDateFilter}
                onChange={async (e) => {
                  setLedgerDateFilter(e.target.value);
                  setLedgerPage(1);
                  setLedgerLoading(true);
                  const params = buildLedgerParams(selected?.id, 1);
                  if (e.target.value === "custom") {
                    if (customStartDate && customEndDate) {
                      params.startDate = customStartDate;
                      params.endDate = customEndDate;
                    }
                  }
                  const r = await apiCall(`/api/v1/intermediaries/${selected?.id}`, { params });
                  if (r.success) {
                    const ledgerPayload = applyPendingIntermediaryLedger(r.data as any, queuedItems as any, Number(selected?.id || 0), currencies as any);
                    setLedger(ledgerPayload);
                    setTotalPages((ledgerPayload?.pagination as any)?.totalPages || 1);
                    setTotal((ledgerPayload?.pagination as any)?.total || 0);
                  }
                  setLedgerLoading(false);
                }}
                className="select-field py-0.5 text-xs"
              >
                <option value="all">All</option>
                <option value="7days">7d</option>
                <option value="month">Month</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {ledgerDateFilter === "custom" && (
              <>
                <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="input-field w-32 py-0.5 text-xs" />
                <span className="text-gray-400">–</span>
                <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="input-field w-32 py-0.5 text-xs" />
              </>
            )}
            <label className="flex items-center gap-1.5 text-gray-600">
              <span className="font-medium">Ccy</span>
              <select
                value={ledgerCurrencyFilter}
                onChange={e => setLedgerCurrencyFilter(e.target.value)}
                className="select-field py-0.5 text-xs"
              >
                <option value="">All</option>
                {currencies.map((c: any) => (
                  <option key={c.id} value={c.code}>{c.code}</option>
                ))}
              </select>
            </label>
            {ledgerCurrencyFilter && (
              <button onClick={() => setLedgerCurrencyFilter("")} className="text-gray-500 hover:text-gray-700 underline">
                Clear
              </button>
            )}
            <span className="ml-auto text-gray-400">
              {total > 0 && `${ledgerPage}/${totalPages} · ${total}`}
            </span>
            {ledgerPage > 1 && (
              <button onClick={() => handleLedgerPageChange(ledgerPage - 1)} className="text-gray-600 hover:text-gray-800">←</button>
            )}
            {ledgerPage < totalPages && (
              <button onClick={() => handleLedgerPageChange(ledgerPage + 1)} className="text-gray-600 hover:text-gray-800">→</button>
            )}
          </div>

          {ledgerLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : ledger ? (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-[76px]" />
                    <col />
                    <col className="w-[40px]" />
                    <col className="w-[68px]" />
                    <col className="w-[68px]" />
                    <col className="w-[76px]" />
                    <col className="w-[52px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#f4f4f5] text-[10px] uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Detail</th>
                      <th className="px-1 py-1.5 text-center font-semibold">Ccy</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Dr</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Cr</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Bal</th>
                      <th className="px-1 py-1.5 text-center font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!ledger.ledger || ledger.ledger.length === 0) && (
                      <tr><td colSpan={7} className="py-6 text-center text-gray-400">No ledger entries</td></tr>
                    )}
                    {(ledgerCurrencyFilter ? ledger.ledger?.filter((e: any) => e.currencyCode === ledgerCurrencyFilter) : ledger.ledger)?.map((entry: any, i: number) => (
                      <tr key={i} className="border-t border-[#e4e4e7] hover:bg-[#f5e8eb]">
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{formatDate(entry.date)}</td>
                        <td className="px-2 py-1.5 text-gray-800 truncate" title={entry.description}>
                          {compactLedgerDescription(entry)}
                        </td>
                        <td className="px-1 py-1.5 text-center text-[10px] font-semibold text-gray-600">{entry.currencyCode}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-green-700">{entry.debit > 0 ? formatNumber(entry.debit) : "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{entry.credit > 0 ? formatNumber(entry.credit) : "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-800">{formatNumber(entry.balance)}</td>
                        <td className="px-1 py-1.5 text-center">
                          {entry.type === "deposit" && !entry._pending && (() => {
                            const actionKey = `deposit-${entry.id}`;
                            return (
                              <RowActionMenu
                                open={openLedgerActionId === actionKey}
                                onOpenChange={(open) => setOpenLedgerActionId(open ? actionKey : null)}
                              >
                                <button
                                  type="button"
                                  onClick={() => { setOpenLedgerActionId(null); void openEditDeposit(entry); }}
                                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setOpenLedgerActionId(null); void handleDeleteDeposit(entry.id); }}
                                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs"
                                >
                                  Delete
                                </button>
                              </RowActionMenu>
                            );
                          })()}
                          {entry.type === "exchange_out" && !entry._pending && (() => {
                            const exch = ledger?.exchangeHistory?.find((ex: any) => ex.id === entry.id);
                            if (!exch) return null;
                            const actionKey = `exchange-${entry.id}`;
                            return (
                              <RowActionMenu
                                open={openLedgerActionId === actionKey}
                                onOpenChange={(open) => setOpenLedgerActionId(open ? actionKey : null)}
                              >
                                <button
                                  type="button"
                                  onClick={() => { setOpenLedgerActionId(null); void openEditExchange(exch); }}
                                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setOpenLedgerActionId(null); void handleDeleteExchange(exch.id); }}
                                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs"
                                >
                                  Delete
                                </button>
                              </RowActionMenu>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-gray-400">No data available</div>
          )}
        </div>
      </Modal>

      <Modal open={showDeposit} onClose={() => setShowDeposit(false)} title={`Record Deposit — ${selected?.name || "Intermediary"}`} size="md">
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Transfer Route</p>
            <p className="text-sm text-gray-700">
              <span className="font-medium">🏦 {superAdminBankAccounts.find((b: any) => String(b.id) === depositForm.superAdminBankAccountId)?.bankName || "Select Bank"}</span>
              <span className="text-gray-400 mx-2">→</span>
              <span className="font-medium">👤 {selected?.name}</span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={depositForm.depositDate} onChange={e => setDepositForm(prev => ({ ...prev, depositDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={depositForm.amount} onChange={e => setDepositForm(prev => ({ ...prev, amount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Currency</label>
            <select value={depositForm.currencyId} onChange={e => setDepositForm(prev => ({ ...prev, currencyId: e.target.value, superAdminBankAccountId: "" }))} className="select-field">
              <option value="">Select currency</option>
              {currencies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account</label>
            <select value={depositForm.superAdminBankAccountId} onChange={e => setDepositForm(prev => ({ ...prev, superAdminBankAccountId: e.target.value }))} className="select-field">
              <option value="">Select bank account</option>
              {superAdminBankAccounts.filter((b: any) => b.isActive && (!depositForm.currencyId || String(b.currencyId) === String(depositForm.currencyId))).map((b: any) => (
                <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` - ${b.accountNumber}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={depositForm.notes} onChange={e => setDepositForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" placeholder="Optional note" />
          </div>
          {depositError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{depositError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowDeposit(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleDeposit} disabled={depositSubmitting} className="btn-primary text-sm">{depositSubmitting ? "Saving..." : "Record Deposit"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showExchange} onClose={() => setShowExchange(false)} title={`Execute Exchange — ${selected?.name || "Intermediary"}`} size="md">
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-xs font-semibold text-amber-900 uppercase tracking-wider mb-2">Exchange Between Currencies</p>
            <p className="text-sm text-amber-800">
              Exchanging for{" "}
              <span className="font-medium">👤 {selected?.name}</span>
              {exchangeForm.fromCurrencyId && exchangeForm.toCurrencyId ? (
                <span>
                  {" "}—{" "}
                  <span className="font-semibold">{exchangePreview.operation === "multiply" ? "Multiply" : "Divide"} by rate</span>
                </span>
              ) : null}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={exchangeForm.exchangeDate} onChange={e => setExchangeForm(prev => ({ ...prev, exchangeDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Exchange Rate</label>
              <input type="text" inputMode="decimal" value={exchangeForm.exchangeRate} onChange={e => setExchangeForm(prev => ({ ...prev, exchangeRate: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Base Currency (Numerator)</label>
              <select value={exchangeForm.baseCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, baseCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Quote Currency (Denominator)</label>
              <select value={exchangeForm.quoteCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, quoteCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">From Currency</label>
              <select value={exchangeForm.fromCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, fromCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To Currency</label>
              <select value={exchangeForm.toCurrencyId} onChange={e => setExchangeForm(prev => ({ ...prev, toCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={exchangeForm.fromAmount} onChange={e => setExchangeForm(prev => ({ ...prev, fromAmount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To Amount (Calculated)</label>
              <input type="text" value={exchangePreview.toAmount.toLocaleString("en-US")} className="input-field bg-gray-50" readOnly />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={exchangeForm.notes} onChange={e => setExchangeForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" placeholder="Optional note" />
          </div>
          {exchangeError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{exchangeError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowExchange(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleExchange} disabled={exchangeSubmitting} className="btn-primary text-sm">{exchangeSubmitting ? "Executing..." : "Execute Exchange"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showEditDeposit} onClose={() => setShowEditDeposit(false)} title="Edit Deposit" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={editDepositForm.depositDate} onChange={e => setEditDepositForm(prev => ({ ...prev, depositDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={editDepositForm.amount} onChange={e => setEditDepositForm(prev => ({ ...prev, amount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Currency</label>
            <select value={editDepositForm.currencyId} onChange={e => setEditDepositForm(prev => ({ ...prev, currencyId: e.target.value, superAdminBankAccountId: "" }))} className="select-field">
              <option value="">Select currency</option>
              {currencies.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account</label>
            <select value={editDepositForm.superAdminBankAccountId} onChange={e => setEditDepositForm(prev => ({ ...prev, superAdminBankAccountId: e.target.value }))} className="select-field">
              <option value="">Select bank account</option>
              {superAdminBankAccounts.filter((b: any) => b.isActive && (!editDepositForm.currencyId || String(b.currencyId) === String(editDepositForm.currencyId))).map((b: any) => (
                <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` - ${b.accountNumber}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={editDepositForm.notes} onChange={e => setEditDepositForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" placeholder="Optional note" />
          </div>
          {editDepositError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editDepositError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowEditDeposit(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEditDeposit} disabled={editDepositSubmitting} className="btn-primary text-sm">{editDepositSubmitting ? "Saving..." : "Save Changes"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={showEditExchange} onClose={() => setShowEditExchange(false)} title="Edit Exchange" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={editExchangeForm.exchangeDate} onChange={e => setEditExchangeForm(prev => ({ ...prev, exchangeDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Exchange Rate</label>
              <input type="text" inputMode="decimal" value={editExchangeForm.exchangeRate} onChange={e => setEditExchangeForm(prev => ({ ...prev, exchangeRate: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Base Currency</label>
              <select value={editExchangeForm.baseCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, baseCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Quote Currency</label>
              <select value={editExchangeForm.quoteCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, quoteCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">From Currency</label>
              <select value={editExchangeForm.fromCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, fromCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To Currency</label>
              <select value={editExchangeForm.toCurrencyId} onChange={e => setEditExchangeForm(prev => ({ ...prev, toCurrencyId: e.target.value }))} className="select-field">
                <option value="">Select</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input type="text" inputMode="decimal" value={editExchangeForm.fromAmount} onChange={e => setEditExchangeForm(prev => ({ ...prev, fromAmount: e.target.value }))} className="input-field" placeholder="0.00" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">To Amount</label>
              <input type="text" value={editExchangePreview.toAmount.toLocaleString("en-US")} className="input-field bg-gray-50" readOnly />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input type="text" value={editExchangeForm.notes} onChange={e => setEditExchangeForm(prev => ({ ...prev, notes: e.target.value }))} className="input-field" />
          </div>
          {editExchangeError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editExchangeError}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => setShowEditExchange(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleEditExchange} disabled={editExchangeSubmitting} className="btn-primary text-sm">{editExchangeSubmitting ? "Saving..." : "Save Exchange"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
