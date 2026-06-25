"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { applyPendingBankLedger } from "@/lib/offline-bank-ledger";
import { PageHeader, DataTable, Modal, formatDate, formatNumber, RowActionMenu, PaginationBar } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import * as XLSX from "xlsx";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";

const BANK_ACCOUNTS_READ_CACHE_KEY = "mrf-bank-accounts-read-cache-v1";
const LEDGER_FETCH_LIMIT = 10000;
const todayIso = () => new Date().toISOString().split("T")[0];

type SendKind = "" | "supplier" | "intermediary" | "shipping" | "clearing" | "customs";

type BankAccountsReadSnapshot = {
  accounts: any[];
  currencies: any[];
  ledgerByAccount: Record<string, { rows: any[]; balanceByCurrency: Record<string, number> }>;
};

export default function BankAccountsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, queuedItems } = useOffline();
  const isSA = user?.role === "super_admin";

  const [accounts, setAccounts] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ bankName: "", accountNumber: "", cityId: "", accountKind: "bank" as "bank" | "cash" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerAllRows, setLedgerAllRows] = useState<any[]>([]);
  const [ledgerBalanceByCurrency, setLedgerBalanceByCurrency] = useState<Record<string, number>>({});
  const [ledgerAccount, setLedgerAccount] = useState<any>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerTotalPages, setLedgerTotalPages] = useState(1);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [sendKind, setSendKind] = useState<SendKind>("");
  const [cashActionError, setCashActionError] = useState("");
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [cashRefsLoaded, setCashRefsLoaded] = useState(false);
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [shippingLines, setShippingLines] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [receiveForm, setReceiveForm] = useState({ receiptDate: todayIso(), intermediaryId: 0, amount: "", notes: "" });
  const [sendForm, setSendForm] = useState({
    paymentDate: todayIso(),
    amount: "",
    supplierId: 0,
    intermediaryId: 0,
    shippingLineId: 0,
    agentId: 0,
    cityId: 0,
    lotId: 0,
    exchangeRate: "",
    reference: "",
    notes: "",
  });

  const isHajiCashLedger = isSA && ledgerAccount?.accountKind === "cash";
  const cashCurrencyCode = String(ledgerAccount?.currency?.code || "").toUpperCase();

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<BankAccountsReadSnapshot>(BANK_ACCOUNTS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<BankAccountsReadSnapshot>) => {
    const existing = readSnapshot()?.data || { accounts: [], currencies: [], ledgerByAccount: {} };
    writeOfflineReadSnapshot<BankAccountsReadSnapshot>(BANK_ACCOUNTS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      ledgerByAccount: { ...(existing.ledgerByAccount || {}), ...(partial.ledgerByAccount || {}) },
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/bank-accounts", {
      params: isSA ? { scope: "super_admin" } : undefined,
    });
    if (r.success) {
      setAccounts(r.data as any[]);
      mergeSnapshot({ accounts: r.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.accounts?.length) {
        setAccounts(snapshot.accounts);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, isSA, mergeSnapshot, readSnapshot]);

  useEffect(() => { load(); }, [load]);

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
    if (isSA) {
      apiCall("/api/v1/currencies").then(r => {
        if (r.success) {
          setCurrencies(r.data as any[]);
          mergeSnapshot({ currencies: r.data as any[] });
          setShowOfflineSnapshot(false);
        } else if (!isOnline) {
          const snapshot = readSnapshot()?.data;
          if (snapshot?.currencies?.length) {
            setCurrencies(snapshot.currencies);
            setShowOfflineSnapshot(true);
          }
        }
      });
    }
  }, [isOnline, isSA, mergeSnapshot, readSnapshot]);

  const openCreate = () => {
    setForm({
      bankName: "",
      accountNumber: "",
      cityId: isSA ? (currencies[0]?.id?.toString() || "") : "",
      accountKind: "bank",
    });
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.bankName.trim()) { setError("Account name is required"); return; }
    if (isSA && !form.cityId) { setError("Currency is required"); return; }
    setSubmitting(true);
    const body: any = { bankName: form.bankName, accountNumber: form.accountNumber };
    if (isSA) {
      body.currencyId = Number(form.cityId);
      body.accountKind = form.accountKind;
    }
    const r = await apiCall("/api/v1/bank-accounts", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (acc: any) => {
    setSelected(acc);
    setForm({
      bankName: acc.bankName,
      accountNumber: acc.accountNumber || "",
      cityId: isSA ? String(acc.currencyId || "") : (acc.cityId?.toString() || ""),
      accountKind: acc.accountKind === "cash" ? "cash" : "bank",
    });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    if (!form.bankName.trim()) { setError("Bank name is required"); return; }
    setSubmitting(true);
    const body: any = { bankName: form.bankName, accountNumber: form.accountNumber };
    if (isSA) body.currencyId = Number(form.cityId);
    const r = await apiCall(`/api/v1/bank-accounts/${selected.id}`, { method: "PATCH", body });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const toggleActive = async (acc: any) => {
    if (!confirm(`${acc.isActive ? "Deactivate" : "Reactivate"} "${acc.bankName}"?`)) return;
    const body: any = { isActive: !acc.isActive };
    if (isSA) {
      body.bankName = acc.bankName;
      body.accountNumber = acc.accountNumber;
      body.currencyId = acc.currencyId;
    }
    await apiCall(`/api/v1/bank-accounts/${acc.id}`, { method: "PATCH", body });
    load();
  };

  const loadLedger = useCallback(async (acc: any) => {
    setLedgerLoading(true);
    const r = await apiCall(`/api/v1/bank-accounts/${acc.id}`, {
      params: { view: "ledger", page: 1, limit: LEDGER_FETCH_LIMIT },
    });
    if (r.success) {
      const payload: any = r.data || {};
      const baseRows = payload.ledger || [];
      const baseBalance = payload.balanceByCurrency || {};
      const merged = !isOnline
        ? applyPendingBankLedger(baseRows, baseBalance, queuedItems as any, Number(acc.id))
        : { rows: baseRows, balanceByCurrency: baseBalance };
      const rows = merged.rows || [];
      setLedgerAllRows(rows);
      setLedgerBalanceByCurrency(merged.balanceByCurrency || {});
      setLedgerTotal(rows.length);
      setLedgerTotalPages(Math.max(1, Math.ceil(rows.length / DEFAULT_LIST_PAGE_SIZE)));
      mergeSnapshot({
        ledgerByAccount: {
          [String(acc.id)]: {
            rows,
            balanceByCurrency: merged.balanceByCurrency || {},
          },
        },
      });
      setShowOfflineSnapshot(false);
    } else {
      const snapshot = readSnapshot()?.data;
      const cachedLedger = snapshot?.ledgerByAccount?.[String(acc.id)];
      if (!isOnline && cachedLedger) {
        const merged = applyPendingBankLedger(
          cachedLedger.rows || [],
          cachedLedger.balanceByCurrency || {},
          queuedItems as any,
          Number(acc.id)
        );
        const rows = merged.rows || [];
        setLedgerAllRows(rows);
        setLedgerBalanceByCurrency(merged.balanceByCurrency || {});
        setLedgerTotal(rows.length);
        setLedgerTotalPages(Math.max(1, Math.ceil(rows.length / DEFAULT_LIST_PAGE_SIZE)));
        setShowOfflineSnapshot(true);
      } else {
        setLedgerAllRows([]);
        setLedgerBalanceByCurrency({});
        setLedgerTotal(0);
        setLedgerTotalPages(1);
        setError(r.error || "Failed to load ledger");
      }
    }
    setLedgerLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot]);

  const ledgerRows = useMemo(() => {
    const start = (ledgerPage - 1) * DEFAULT_LIST_PAGE_SIZE;
    return ledgerAllRows.slice(start, start + DEFAULT_LIST_PAGE_SIZE);
  }, [ledgerAllRows, ledgerPage]);

  const openLedger = (acc: any) => {
    setLedgerAccount(acc);
    setLedgerPage(1);
    setError("");
    const cached = readSnapshot()?.data?.ledgerByAccount?.[String(acc.id)];
    if (cached?.rows?.length) {
      setLedgerAllRows(cached.rows);
      setLedgerBalanceByCurrency(cached.balanceByCurrency || {});
      setLedgerTotal(cached.rows.length);
      setLedgerTotalPages(Math.max(1, Math.ceil(cached.rows.length / DEFAULT_LIST_PAGE_SIZE)));
    } else {
      setLedgerAllRows([]);
      setLedgerBalanceByCurrency({});
      setLedgerTotal(0);
      setLedgerTotalPages(1);
    }
    setShowLedger(true);
  };

  useEffect(() => {
    if (!showLedger || !ledgerAccount) return;
    void loadLedger(ledgerAccount);
  }, [showLedger, ledgerAccount, loadLedger]);

  const unwrapList = (payload: any) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  };

  const loadCashActionRefs = useCallback(async () => {
    if (cashRefsLoaded) return;
    const [intRes, supRes, slRes, agRes, lotRes, cityRes] = await Promise.all([
      apiCall("/api/v1/intermediaries"),
      apiCall("/api/v1/suppliers", { params: { limit: 500 } }),
      apiCall("/api/v1/shipping-lines"),
      apiCall("/api/v1/agents", { params: { limit: 500 } }),
      apiCall("/api/v1/lots", { params: { limit: 500 } }),
      apiCall("/api/v1/cities"),
    ]);
    if (intRes.success) setIntermediaries(unwrapList(intRes.data));
    if (supRes.success) setSuppliers(unwrapList(supRes.data));
    if (slRes.success) setShippingLines(unwrapList(slRes.data));
    if (agRes.success) setAgents(unwrapList(agRes.data));
    if (lotRes.success) setLots(unwrapList(lotRes.data));
    if (cityRes.success) setCities(Array.isArray(cityRes.data) ? cityRes.data : []);
    setCashRefsLoaded(true);
  }, [cashRefsLoaded]);

  const resetSendForm = () => {
    setSendForm({
      paymentDate: todayIso(),
      amount: "",
      supplierId: 0,
      intermediaryId: 0,
      shippingLineId: 0,
      agentId: 0,
      cityId: 0,
      lotId: 0,
      exchangeRate: "",
      reference: "",
      notes: "",
    });
  };

  const openReceiveModal = () => {
    setCashActionError("");
    setReceiveForm({ receiptDate: todayIso(), intermediaryId: 0, amount: "", notes: "" });
    void loadCashActionRefs();
    setShowReceive(true);
  };

  const openSendModal = (kind: SendKind) => {
    setCashActionError("");
    resetSendForm();
    void loadCashActionRefs();
    setSendKind(kind);
  };

  const parseCashAmount = (value: string) => {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  };

  const refreshCashLedger = async () => {
    if (!ledgerAccount) return;
    await loadLedger(ledgerAccount);
    load();
  };

  const handleReceive = async () => {
    if (!ledgerAccount) return;
    const amount = parseCashAmount(receiveForm.amount);
    if (!receiveForm.intermediaryId) { setCashActionError("Select an intermediary"); return; }
    if (!amount) { setCashActionError("Enter a valid amount"); return; }
    setCashSubmitting(true);
    setCashActionError("");
    const r = await apiCall("/api/v1/haji-cash-receipts", {
      method: "POST",
      body: {
        superAdminCashAccountId: ledgerAccount.id,
        intermediaryId: receiveForm.intermediaryId,
        receiptDate: receiveForm.receiptDate,
        amount,
        notes: receiveForm.notes || null,
      },
    });
    setCashSubmitting(false);
    if (r.success) {
      setShowReceive(false);
      await refreshCashLedger();
    } else {
      setCashActionError(r.error || "Failed to record receipt");
    }
  };

  const handleSend = async () => {
    if (!ledgerAccount || !sendKind) return;
    const amount = parseCashAmount(sendForm.amount);
    if (!amount) { setCashActionError("Enter a valid amount"); return; }
    setCashSubmitting(true);
    setCashActionError("");

    let r: { success: boolean; error?: string };
    if (sendKind === "intermediary") {
      if (!sendForm.intermediaryId) { setCashActionError("Select an intermediary"); setCashSubmitting(false); return; }
      r = await apiCall(`/api/v1/intermediaries/${sendForm.intermediaryId}/deposits`, {
        method: "POST",
        body: {
          depositDate: sendForm.paymentDate,
          amount,
          currencyId: ledgerAccount.currencyId,
          superAdminCashAccountId: ledgerAccount.id,
          notes: sendForm.notes || null,
        },
      });
    } else if (sendKind === "supplier") {
      if (!sendForm.supplierId) { setCashActionError("Select a supplier"); setCashSubmitting(false); return; }
      const body: any = {
        supplierId: sendForm.supplierId,
        lotId: sendForm.lotId || null,
        paymentDate: sendForm.paymentDate,
        paymentMethod: "cash",
        superAdminCashAccountId: ledgerAccount.id,
        reference: sendForm.reference || null,
        notes: sendForm.notes || null,
        amountUsd: amount,
      };
      if (cashCurrencyCode !== "USD") body.amountLocal = amount;
      r = await apiCall("/api/v1/supplier-payments", { method: "POST", body });
    } else if (sendKind === "shipping") {
      if (!sendForm.shippingLineId) { setCashActionError("Select a shipping line"); setCashSubmitting(false); return; }
      const needsRate = cashCurrencyCode !== "USD" && cashCurrencyCode !== "PKR";
      if (needsRate && !(Number(sendForm.exchangeRate) > 0)) {
        setCashActionError("Exchange rate is required");
        setCashSubmitting(false);
        return;
      }
      r = await apiCall("/api/v1/shipping-line-payments", {
        method: "POST",
        body: {
          shippingLineId: sendForm.shippingLineId,
          lotId: sendForm.lotId || null,
          paymentDate: sendForm.paymentDate,
          amountUsd: amount,
          settlementCurrency: cashCurrencyCode,
          exchangeRate: cashCurrencyCode === "PKR" ? null : (Number(sendForm.exchangeRate) || null),
          superAdminCashAccountId: ledgerAccount.id,
          reference: sendForm.reference || null,
          notes: sendForm.notes || null,
        },
      });
    } else {
      if (!sendForm.agentId) { setCashActionError("Select an agent"); setCashSubmitting(false); return; }
      const agent = agents.find((a) => a.id === sendForm.agentId);
      const cityId = sendForm.cityId || agent?.city?.id || agent?.cityId || cities[0]?.id;
      if (!cityId) { setCashActionError("Select a city"); setCashSubmitting(false); return; }
      r = await apiCall("/api/v1/agent-payments", {
        method: "POST",
        body: {
          agentId: sendForm.agentId,
          cityId,
          paymentDate: sendForm.paymentDate,
          amount,
          currencyCode: cashCurrencyCode,
          paymentMethod: "cash",
          superAdminCashAccountId: ledgerAccount.id,
          reference: sendForm.reference || null,
          notes: sendForm.notes || null,
        },
      });
    }

    setCashSubmitting(false);
    if (r.success) {
      setSendKind("");
      await refreshCashLedger();
    } else {
      setCashActionError(r.error || "Failed to record payment");
    }
  };

  const clearingAgents = agents.filter((a) => a.agentType !== "customs" && a.isActive !== false);
  const customsAgents = agents.filter((a) => a.agentType === "customs" && a.isActive !== false);
  const sendModalTitle =
    sendKind === "supplier" ? "Send to Supplier"
    : sendKind === "intermediary" ? "Send to Intermediary"
    : sendKind === "shipping" ? "Send to Shipping Line"
    : sendKind === "clearing" ? "Send to Clearing Agent"
    : sendKind === "customs" ? "Send to Customs Agent"
    : "";

  useEffect(() => {
    if (!showLedger) {
      setShowReceive(false);
      setSendKind("");
      setCashActionError("");
    }
  }, [showLedger]);

  const fetchFullLedgerRows = async () => {
    if (ledgerAllRows.length > 0) return ledgerAllRows;
    if (!ledgerAccount) return [];
    const r = await apiCall(`/api/v1/bank-accounts/${ledgerAccount.id}`, {
      params: { view: "ledger", page: 1, limit: LEDGER_FETCH_LIMIT },
    });
    if (!r.success) return ledgerAllRows;
    const payload: any = r.data || {};
    const merged = !isOnline
      ? applyPendingBankLedger(payload.ledger || [], payload.balanceByCurrency || {}, queuedItems as any, Number(ledgerAccount.id))
      : { rows: payload.ledger || [], balanceByCurrency: payload.balanceByCurrency || {} };
    return merged.rows || [];
  };

  const escHtml = (value: any) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const exportLedgerXlsx = async () => {
    if (!ledgerAccount) return;
    const exportRows = await fetchFullLedgerRows();
    const rows: any[][] = [];
    rows.push(["Bank Ledger", ledgerAccount.bankName || ""]);
    rows.push(["Generated", new Date().toISOString().split("T")[0]]);
    rows.push([]);
    rows.push(["Date", "Type", "Detail", "Ref", "Credit", "Debit", "Running"]);
    for (const row of exportRows) {
      rows.push([
        formatDate(row.date),
        row.type,
        row.detail,
        row.reference || "",
        row.credit > 0 ? row.credit : "",
        row.debit > 0 ? row.debit : "",
        row.runningBalance ?? "",
      ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Bank Ledger");
    const wbout = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bank_ledger_${String(ledgerAccount.bankName || "account").replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportLedgerPdf = async () => {
    if (!ledgerAccount) return;
    const exportRows = await fetchFullLedgerRows();
    const balances = Object.entries(ledgerBalanceByCurrency || {})
      .map(([code, amt]) => `${code} ${formatNumber(Number(amt || 0))}`)
      .join(" · ");
    const rowsHtml = exportRows.map((row: any) => `
      <tr>
        <td>${escHtml(formatDate(row.date))}</td>
        <td>${escHtml(row.type)}</td>
        <td>${escHtml(row.detail)}</td>
        <td>${escHtml(row.reference || "")}</td>
        <td style="text-align:right;">${row.credit > 0 ? escHtml(formatNumber(row.credit)) : "—"}</td>
        <td style="text-align:right;">${row.debit > 0 ? escHtml(formatNumber(row.debit)) : "—"}</td>
        <td style="text-align:right;">${escHtml(formatNumber(row.runningBalance || 0))}</td>
      </tr>
    `).join("");
    const html = `
      <html><head><title>Bank Ledger</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
        h1 { margin: 0 0 8px 0; font-size: 20px; }
        .meta { margin: 0 0 14px 0; color: #555; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #e2e2e2; padding: 7px; font-size: 12px; text-align: left; }
        th { background: #f6f6f6; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; color: #666; }
      </style></head><body>
        <h1>Bank Ledger - ${escHtml(ledgerAccount.bankName || "")}</h1>
        <p class="meta">Generated: ${escHtml(new Date().toISOString().split("T")[0])}<br/>Balance: ${escHtml(balances || "0")}</p>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Detail</th><th>Ref</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Running</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="7">No ledger entries</td></tr>`}</tbody>
        </table>
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

  const columns: any[] = [
    ...(isSA ? [{
      key: "accountKind", label: "Type",
      render: (acc: any) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${acc.accountKind === "cash" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"}`}>
          {acc.accountKind === "cash" ? "Cash" : "Bank"}
        </span>
      ),
    }] : []),
    ...(isSA ? [{
      key: "currency", label: "Currency",
      render: (acc: any) => <span className="text-sm text-gray-600 font-medium">{acc.currency?.code} {acc.currency?.symbol}</span>,
    }] : []),
    {
      key: "bankName", label: t("bank_name"),
      render: (acc: any) => (
        <div>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); openLedger(acc); }}
            className="font-medium text-primary-700 hover:underline"
          >
            {acc.bankName}
          </button>
          {!acc.isActive && <span className="ml-2 text-xs text-gray-400">(inactive)</span>}
        </div>
      ),
    },
    {
      key: "accountNumber", label: t("account_number"),
      render: (acc: any) => acc.accountNumber
        ? <span className="font-mono text-sm text-gray-600">{acc.accountNumber}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      key: "balance", label: "Running Balance",
      render: (acc: any) => (
        <div className="text-sm font-medium text-gray-700 space-y-0.5">
          {isSA ? (
            <span>{acc.currency?.code} {Number(acc.runningBalance || 0).toLocaleString("en-US")}</span>
          ) : acc.runningBalanceByCurrency && Object.keys(acc.runningBalanceByCurrency).length > 0 ? (
            Object.entries(acc.runningBalanceByCurrency).map(([currencyCode, amount]: [string, any]) => (
              <div key={currencyCode}>{currencyCode} {Number(amount).toLocaleString("en-US")}</div>
            ))
          ) : (
            <span className="text-gray-300">0</span>
          )}
        </div>
      ),
    },
    {
      key: "status", label: t("status"),
      render: (acc: any) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${acc.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {acc.isActive ? t("active") : t("inactive")}
        </span>
      ),
    },
    {
      key: "actions", label: "",
      render: (acc: any) => (
        <RowActionMenu
          open={openActionId === acc.id}
          onOpenChange={(open) => setOpenActionId(open ? acc.id : null)}
        >
          <button onClick={() => { setOpenActionId(null); openEdit(acc); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("edit")}</button>
          <button onClick={() => { setOpenActionId(null); toggleActive(acc); }} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-gray-50 sm:py-2 sm:text-xs ${acc.isActive ? "text-gray-600" : "text-green-700 hover:bg-green-50"}`}>
            {acc.isActive ? t("deactivate") : t("reactivate")}
          </button>
        </RowActionMenu>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("bank_accounts")}
        action={<button onClick={openCreate} className="btn-primary text-sm">+ {t("new_bank_account")}</button>}
      />
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached bank-account data for this device.
        </div>
      )}

      <DataTable
        columns={columns}
        data={accounts}
        loading={loading}
      />

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_bank_account")} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isSA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account type *</label>
              <select
                value={form.accountKind}
                onChange={e => setForm(f => ({ ...f, accountKind: e.target.value as "bank" | "cash" }))}
                className="select-field"
              >
                <option value="bank">Bank account</option>
                <option value="cash">Cash account (treasury pot)</option>
              </select>
            </div>
          )}
          {isSA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency *</label>
              <select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} className="select-field">
                <option value="">Select currency…</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.symbol}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isSA && form.accountKind === "cash" ? "Account label" : t("bank_name")} *
            </label>
            <input
              value={form.bankName}
              onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
              className="input-field"
              placeholder={isSA && form.accountKind === "cash" ? "e.g. SA Cash AFN" : "e.g. HBL, MCB, UBL"}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("account_number")}{" "}
              <span className="text-gray-400 font-normal">
                ({isSA && form.accountKind === "cash" ? "not used for cash" : "optional"})
              </span>
            </label>
            <input
              value={form.accountNumber}
              onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
              className="input-field font-mono"
              placeholder="e.g. 1234-5678901234"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit — ${selected?.bankName}`} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          {isSA && selected && (
            <div className="text-sm text-gray-500 bg-gray-50 rounded px-3 py-2 space-y-1">
              <div>Currency: <strong className="text-gray-700">{selected.currency?.code} {selected.currency?.symbol}</strong></div>
              <div>Type: <strong className="text-gray-700">{selected.accountKind === "cash" ? "Cash" : "Bank"}</strong></div>
            </div>
          )}
          {isSA && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency *</label>
              <select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))} className="select-field">
                <option value="">Select currency…</option>
                {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.symbol}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("bank_name")} *</label>
            <input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("account_number")} <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} className="input-field font-mono" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

      <Modal open={showLedger} onClose={() => { setShowLedger(false); setLedgerAllRows([]); }} title={`Ledger — ${ledgerAccount?.bankName || ""}`} size="xl">
        <div className="space-y-4">
          <div className="rounded-xl border border-[#d4d4d8] bg-[#f4f4f5]/90 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
              {Object.keys(ledgerBalanceByCurrency || {}).length > 0 ? (
                Object.entries(ledgerBalanceByCurrency).map(([code, amount]) => (
                  <span key={code} className="rounded-lg border border-[#d4d4d8] bg-white px-2.5 py-1 font-medium text-[#2A0608]">
                    {code} {formatNumber(Number(amount || 0))}
                  </span>
                ))
              ) : (
                <span className="text-gray-500">No balance</span>
              )}
              </div>
              <div className="flex items-center gap-2">
                {isHajiCashLedger && (
                  <>
                    <button type="button" onClick={openReceiveModal} className="glass-btn px-3 py-1.5 text-sm font-medium text-emerald-800">Receive</button>
                    <select
                      onChange={(e) => { const v = e.target.value as SendKind; if (v) openSendModal(v); }}
                      className="glass-btn px-3 py-1.5 text-sm font-medium text-rose-800 bg-white cursor-pointer"
                      defaultValue=""
                    >
                      <option value="" disabled>Send to…</option>
                      <option value="supplier">Supplier</option>
                      <option value="intermediary">Intermediary</option>
                      <option value="shipping">Shipping Line</option>
                      <option value="clearing">Clearing Agent</option>
                      <option value="customs">Customs Agent</option>
                    </select>
                  </>
                )}
                <button onClick={exportLedgerXlsx} className="glass-btn glass-btn-xlsx px-3 py-1.5">Export XLSX</button>
                <button onClick={exportLedgerPdf} className="glass-btn glass-btn-pdf px-3 py-1.5">Export PDF</button>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#f4f4f5]">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Date</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Type</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Detail</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ref</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Credit</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Debit</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Running</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerLoading && ledgerAllRows.length === 0 && (
                    <tr><td colSpan={7} className="py-10 text-center text-gray-500">Loading ledger…</td></tr>
                  )}
                  {!ledgerLoading && ledgerAllRows.length === 0 && (
                    <tr><td colSpan={7} className="py-10 text-center text-gray-400">No ledger entries</td></tr>
                  )}
                  {ledgerAllRows.length > 0 && ledgerRows.map((row: any) => (
                    <tr key={row.key} className="border-t border-[#e4e4e7]">
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-600">{formatDate(row.date)}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-gray-700">{row.type}</td>
                      <td className="px-3 py-2.5 text-sm text-gray-800">{row.detail}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{row.reference || "—"}</td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-emerald-700 tabular-nums">{row.credit > 0 ? formatNumber(row.credit) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-sm font-medium text-rose-700 tabular-nums">{row.debit > 0 ? formatNumber(row.debit) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-sm font-semibold text-gray-800 tabular-nums">{formatNumber(row.runningBalance || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ledgerTotal > 0 && (
              <PaginationBar
                bordered={false}
                className="border-t border-gray-200"
                pagination={{
                  page: ledgerPage,
                  totalPages: ledgerTotalPages,
                  total: ledgerTotal,
                  pageSize: DEFAULT_LIST_PAGE_SIZE,
                  onPageChange: setLedgerPage,
                }}
              />
            )}
          </div>
        </div>
      </Modal>

      <Modal open={showReceive} onClose={() => setShowReceive(false)} title={`Receive — ${ledgerAccount?.bankName || ""}`} size="sm">
        {cashActionError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{cashActionError}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={receiveForm.receiptDate} onChange={(e) => setReceiveForm((f) => ({ ...f, receiptDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Intermediary</label>
              <select value={receiveForm.intermediaryId || 0} onChange={(e) => setReceiveForm((f) => ({ ...f, intermediaryId: parseInt(e.target.value) || 0 }))} className="select-field">
                <option value={0}>Select…</option>
                {intermediaries.filter((i) => i.isActive !== false).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input value={receiveForm.amount} onChange={(e) => setReceiveForm((f) => ({ ...f, amount: e.target.value }))} className="input-field" placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <input value={cashCurrencyCode} readOnly className="input-field bg-gray-50 text-gray-600" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={receiveForm.notes} onChange={(e) => setReceiveForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button type="button" onClick={() => setShowReceive(false)} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={handleReceive} disabled={cashSubmitting} className="btn-primary text-sm">{cashSubmitting ? "..." : "Record Receive"}</button>
        </div>
      </Modal>

      <Modal open={!!sendKind} onClose={() => { setSendKind(""); setCashActionError(""); }} title={`${sendModalTitle} — ${ledgerAccount?.bankName || ""}`} size="sm">
        {cashActionError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{cashActionError}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={sendForm.paymentDate} onChange={(e) => setSendForm((f) => ({ ...f, paymentDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              {sendKind === "supplier" && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                  <select value={sendForm.supplierId || 0} onChange={(e) => setSendForm((f) => ({ ...f, supplierId: parseInt(e.target.value) || 0 }))} className="select-field">
                    <option value={0}>Select…</option>
                    {suppliers.filter((s) => s.isActive !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </>
              )}
              {sendKind === "intermediary" && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Intermediary</label>
                  <select value={sendForm.intermediaryId || 0} onChange={(e) => setSendForm((f) => ({ ...f, intermediaryId: parseInt(e.target.value) || 0 }))} className="select-field">
                    <option value={0}>Select…</option>
                    {intermediaries.filter((i) => i.isActive !== false).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </>
              )}
              {sendKind === "shipping" && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Line</label>
                  <select value={sendForm.shippingLineId || 0} onChange={(e) => setSendForm((f) => ({ ...f, shippingLineId: parseInt(e.target.value) || 0 }))} className="select-field">
                    <option value={0}>Select…</option>
                    {shippingLines.filter((s) => s.isActive !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </>
              )}
              {(sendKind === "clearing" || sendKind === "customs") && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{sendKind === "customs" ? "Customs Agent" : "Clearing Agent"}</label>
                  <select value={sendForm.agentId || 0} onChange={(e) => {
                    const agentId = parseInt(e.target.value) || 0;
                    const agent = (sendKind === "customs" ? customsAgents : clearingAgents).find((a) => a.id === agentId);
                    setSendForm((f) => ({ ...f, agentId, cityId: agent?.city?.id || agent?.cityId || f.cityId }));
                  }} className="select-field">
                    <option value={0}>Select…</option>
                    {(sendKind === "customs" ? customsAgents : clearingAgents).map((a) => <option key={a.id} value={a.id}>{a.name}{a.city?.name ? ` (${a.city.name})` : ""}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>
          {(sendKind === "supplier" || sendKind === "shipping") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lot <span className="text-gray-400 font-normal">(optional)</span></label>
              <select value={sendForm.lotId || 0} onChange={(e) => setSendForm((f) => ({ ...f, lotId: parseInt(e.target.value) || 0 }))} className="select-field">
                <option value={0}>None</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.lotNumber || l.name || `Lot #${l.id}`}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input value={sendForm.amount} onChange={(e) => setSendForm((f) => ({ ...f, amount: e.target.value }))} className="input-field" placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <input value={cashCurrencyCode} readOnly className="input-field bg-gray-50 text-gray-600" />
            </div>
          </div>
          {sendKind === "shipping" && cashCurrencyCode !== "USD" && cashCurrencyCode !== "PKR" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{cashCurrencyCode} → PKR rate</label>
              <input value={sendForm.exchangeRate} onChange={(e) => setSendForm((f) => ({ ...f, exchangeRate: e.target.value }))} className="input-field" placeholder="e.g. 280" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reference <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={sendForm.reference} onChange={(e) => setSendForm((f) => ({ ...f, reference: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={sendForm.notes} onChange={(e) => setSendForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button type="button" onClick={() => { setSendKind(""); setCashActionError(""); }} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={handleSend} disabled={cashSubmitting} className="btn-primary text-sm">{cashSubmitting ? "..." : "Record Send"}</button>
        </div>
      </Modal>
    </div>
  );
}
