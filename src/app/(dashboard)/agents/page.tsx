"use client";
import React, { useEffect, useState, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber, RowActionMenu } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingAgents } from "@/lib/offline-queue-overlays";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";

const AGENTS_READ_CACHE_KEY = "mrf-agents-read-cache-v1";

type AgentsReadSnapshot = {
  agents: any[];
  cities: any[];
  ledgerByAgent: Record<string, any>;
  bankAccounts: any[];
  intermediaries: any[];
};

function applyQueuedMutationsToAgents(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/agents/")) continue;
    const match = url.match(/^\/api\/v1\/agents\/([^/?#]+)/);
    const agentId = match?.[1];
    if (!agentId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== agentId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === agentId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            agentType: patch?.agentType ?? row?.agentType,
            cityId: patch?.cityId ?? row?.cityId,
            phone: patch?.phone ?? row?.phone,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

const TYPES = [
  { value: "customs", label: "Customs Agent" },
  { value: "transport", label: "Transport" },
  { value: "freight", label: "Legacy Freight" },
  { value: "other", label: "Other" },
];

export default function AgentsPage() {
  const { t } = useLang();
  const { isOnline, queuedItems, discardQueuedItem } = useOffline();
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [form, setForm] = useState({ name: "", agentType: "customs", cityId: 0, phone: "" });
  const [payForm, setPayForm] = useState({ agentId: 0, cityId: 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, currencyCode: "PKR", paymentMethod: "cash", reference: "", paidFrom: "city_cash", bankAccountId: "", intermediaryId: "" });
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const filteredBankAccounts = bankAccounts.filter((b: any) => !payForm.cityId || b.cityId === payForm.cityId);
  const agentTypeFilter = String(searchParams.get("agentType") || "").toLowerCase();
  const showOnlyCustomAgents = agentTypeFilter === "customs";
  const showOnlyClearingAgents = agentTypeFilter === "clearing";
  const createAgentLabel = showOnlyCustomAgents ? "New Agent" : t("new_agent");
  const visibleAgents = agents;
  const pageTitle = showOnlyCustomAgents ? "Custom Agents" : showOnlyClearingAgents ? "Clearing Agents" : t("agents");
  const getPendingQueueId = (id: unknown) => {
    const str = String(id || "");
    if (!str.startsWith("pending-")) return null;
    return str.replace("pending-", "");
  };

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<AgentsReadSnapshot>(AGENTS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<AgentsReadSnapshot>) => {
    const existing = readSnapshot()?.data || { agents: [], cities: [], ledgerByAgent: {}, bankAccounts: [], intermediaries: [] };
    writeOfflineReadSnapshot<AgentsReadSnapshot>(AGENTS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
      ledgerByAgent: { ...(existing.ledgerByAgent || {}), ...(partial.ledgerByAgent || {}) },
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string | number> = { page, limit: DEFAULT_LIST_PAGE_SIZE };
    if (showOnlyCustomAgents) params.agentType = "customs";
    else if (showOnlyClearingAgents) params.agentType = "clearing";
    const [aR, cR] = await Promise.all([apiCall("/api/v1/agents", { params }), apiCall("/api/v1/cities", { params: { all: "true" } })]);
    if (aR.success) {
      let nextRows = [...getPendingAgents(queuedItems as any), ...((aR.data as any[]) || [])];
      nextRows = applyQueuedMutationsToAgents(nextRows, queuedItems as any[]);
      setAgents(nextRows);
      setTotalPages((aR.pagination as any)?.totalPages || 1);
      setTotal((aR.pagination as any)?.total || 0);
      mergeSnapshot({ agents: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.agents?.length) {
        const cleanedAgents = pruneStalePendingRows(snapshot.agents as any[], queuedItems as any[], "/agents");
        const mergedSnapshotAgents = applyQueuedMutationsToAgents(cleanedAgents, queuedItems as any[]);
        setAgents(mergedSnapshotAgents);
        setTotalPages(1);
        setTotal(mergedSnapshotAgents.length);
        setShowOfflineSnapshot(true);
      }
    }
    if (cR.success) {
      setCities(cR.data as any[]);
      mergeSnapshot({ cities: cR.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.cities?.length) {
        setCities(snapshot.cities);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, page, queuedItems, readSnapshot, showOnlyClearingAgents, showOnlyCustomAgents]);
  useEffect(() => { setPage(1); }, [showOnlyCustomAgents, showOnlyClearingAgents]);
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

  const handleCreate = async () => {
    if (!form.name) { setError(t("name") + " required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/agents", { method: "POST", body: { ...form, cityId: form.cityId || null } });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openLedger = async (a: any) => {
    if (getPendingQueueId(a?.id)) {
      setError("Pending agent is not synced yet. Please sync first.");
      return;
    }
    setSelected(a); setShowLedger(true); setLedgerData(null);
    const r = await apiCall(`/api/v1/agents/${a.id}`);
    if (r.success) {
      setLedgerData(r.data);
      mergeSnapshot({ ledgerByAgent: { [String(a.id)]: r.data } });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      const cachedLedger = snapshot?.ledgerByAgent?.[String(a.id)];
      if (cachedLedger) {
        setLedgerData(cachedLedger);
        setShowOfflineSnapshot(true);
      }
    }
  };

  const openPayment = async (a: any) => {
    if (getPendingQueueId(a?.id)) {
      setError("Pending agent is not synced yet. Please sync first.");
      return;
    }
    setSelected(a);
    setPayForm({ agentId: a.id, cityId: a.city?.id || cities[0]?.id || 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, currencyCode: "PKR", paymentMethod: "cash", reference: "", paidFrom: "city_cash", bankAccountId: "", intermediaryId: "" });
    setShowPayment(true); setError("");
    const [baRes, intRes] = await Promise.all([
      bankAccounts.length ? Promise.resolve({ success: true, data: bankAccounts }) : apiCall("/api/v1/bank-accounts", { params: { limit: 100 } }),
      intermediaries.length ? Promise.resolve({ success: true, data: intermediaries }) : apiCall("/api/v1/intermediaries"),
    ]);
    if (baRes.success) {
      const loadedBanks = (baRes.data as any).items || baRes.data as any[];
      setBankAccounts(loadedBanks);
      mergeSnapshot({ bankAccounts: loadedBanks });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.bankAccounts?.length) {
        setBankAccounts(snapshot.bankAccounts);
        setShowOfflineSnapshot(true);
      }
    }
    if (intRes.success) {
      setIntermediaries(intRes.data as any[]);
      mergeSnapshot({ intermediaries: intRes.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.intermediaries?.length) {
        setIntermediaries(snapshot.intermediaries);
        setShowOfflineSnapshot(true);
      }
    }
  };

  const handlePayment = async () => {
    if (!payForm.amount) { setError(t("amount") + " required"); return; }
    if (payForm.paidFrom === "bank" && !payForm.bankAccountId) { setError("Select a bank account"); return; }
    if (payForm.paidFrom === "intermediary" && !payForm.intermediaryId) { setError("Select an intermediary"); return; }
    setSubmitting(true);
    const body: any = { ...payForm };
    body.bankAccountId = payForm.paidFrom === "bank" && payForm.bankAccountId ? Number(payForm.bankAccountId) : null;
    body.intermediaryId = payForm.paidFrom === "intermediary" && payForm.intermediaryId ? Number(payForm.intermediaryId) : null;
    const r = await apiCall("/api/v1/agent-payments", { method: "POST", body });
    setSubmitting(false);
    if (r.success) { setShowPayment(false); load(); } else { setError(r.error || "Failed"); }
  };

  return (
    <div>
      <PageHeader title={pageTitle} action={<button onClick={() => { setForm({ name: "", agentType: showOnlyClearingAgents ? "transport" : "customs", cityId: 0, phone: "" }); setShowCreate(true); setError(""); }} className="btn-primary text-sm">+ {createAgentLabel}</button>} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}
      <DataTable columns={[
        { key: "name", label: t("name"), render: (a: any) => (
          getPendingQueueId(a?.id) ? (
            <span className="font-medium text-gray-500">{a.name}</span>
          ) : (
            <button onClick={() => openLedger(a)} className="font-medium text-primary-600 hover:underline">{a.name}</button>
          )
        ) },
        { key: "agentType", label: t("type"), render: (a: any) => <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">{TYPES.find(ty => ty.value === a.agentType)?.label || a.agentType}</span> },
        { key: "city", label: t("city"), render: (a: any) => a.city?.name || "-" },
        { key: "balance", label: t("balance_owed"), render: (a: any) => <div>{Object.entries(a.balance || {}).map(([cc, bal]: [string, any]) => <div key={cc} className={`text-sm font-medium ${bal > 0 ? "text-red-600" : "text-green-600"}`}>{cc} {bal.toLocaleString("en-US")}</div>)}</div> },
        {
          key: "actions", label: "", render: (a: any) => (
            <RowActionMenu
              open={openActionId === a.id}
              onOpenChange={(open) => setOpenActionId(open ? a.id : null)}
            >
              <button onClick={() => { setOpenActionId(null); openLedger(a); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">Open Ledger</button>
              <button onClick={() => { setOpenActionId(null); openPayment(a); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-green-700 hover:bg-green-50 sm:py-2 sm:text-xs">{t("pay_agent")}</button>
              {getPendingQueueId(a?.id) && (
                <button
                  onClick={async () => {
                    setOpenActionId(null);
                    const queueId = getPendingQueueId(a?.id);
                    if (!queueId) return;
                    await discardQueuedItem(queueId);
                    setAgents((prev) => prev.filter((row: any) => row.id !== a.id));
                  }}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-700 hover:bg-red-50 sm:py-2 sm:text-xs"
                >
                  Delete Pending
                </button>
              )}
            </RowActionMenu>
          ),
        },
      ]} data={visibleAgents} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={createAgentLabel} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label>
              <select value={form.agentType} onChange={e => setForm(f => ({ ...f, agentType: e.target.value }))} className="select-field">
                {TYPES.filter((ty) => {
                  if (ty.value === "freight") return false;
                  if (showOnlyCustomAgents) return ty.value === "customs";
                  if (showOnlyClearingAgents) return ty.value !== "customs";
                  return true;
                }).map(ty => <option key={ty.value} value={ty.value}>{ty.label}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("city_port")}</label><select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: parseInt(e.target.value) }))} className="select-field"><option value={0}>None</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("phone")}</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`Agent Ledger: ${selected?.name || ""}`} size="lg">
        {!ledgerData ? <div className="py-8 text-center text-gray-400">{t("loading")}</div> : <>
          <DataTable columns={[
            { key: "date", label: t("date") },
            { key: "type", label: "Entry Type", render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "charge" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{e.type === "charge" ? "Charge" : "Settlement"}</span> },
            { key: "description", label: "Particulars" },
            { key: "debit", label: "Debit", render: (e: any) => e.debit ? <span className="text-red-600">{e.currency} {e.debit.toLocaleString("en-US")}</span> : "" },
            { key: "credit", label: "Credit", render: (e: any) => e.credit ? <span className="text-green-600">{e.currency} {e.credit.toLocaleString("en-US")}</span> : "" },
            { key: "balance", label: "Closing Balance", render: (e: any) => <span className="font-medium">{e.balance.toLocaleString("en-US")}</span> },
          ]} data={ledgerData.ledger || []} loading={false} />
        </>}
      </Modal>

      <Modal open={showPayment} onClose={() => setShowPayment(false)} title={`Record Settlement: ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" value={payForm.amount || ""} onChange={e => setPayForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" onWheel={e => e.currentTarget.blur()} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label><select value={payForm.currencyCode} onChange={e => setPayForm(f => ({ ...f, currencyCode: e.target.value }))} className="select-field"><option value="PKR">PKR</option><option value="USD">USD</option><option value="AFN">AFN</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label><input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("city")}</label><select value={payForm.cityId} onChange={e => setPayForm(f => ({ ...f, cityId: parseInt(e.target.value), bankAccountId: "" }))} className="select-field">{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          {/* Paid From */}
          <div className="border rounded-lg p-3 bg-blue-50 border-blue-200 space-y-2">
            <label className="block text-sm font-semibold text-blue-800">Settlement Source *</label>
            <div className="flex gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="agentPaidFrom" value="city_cash" checked={payForm.paidFrom === "city_cash"} onChange={() => setPayForm(f => ({ ...f, paidFrom: "city_cash", bankAccountId: "", intermediaryId: "" }))} />
                Cash Office
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="agentPaidFrom" value="bank" checked={payForm.paidFrom === "bank"} onChange={() => setPayForm(f => ({ ...f, paidFrom: "bank", intermediaryId: "" }))} />
                Bank Ledger
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="agentPaidFrom" value="intermediary" checked={payForm.paidFrom === "intermediary"} onChange={() => setPayForm(f => ({ ...f, paidFrom: "intermediary", bankAccountId: "" }))} />
                Intermediary Ledger
              </label>
            </div>
            {payForm.paidFrom === "bank" && (
              <select value={payForm.bankAccountId} onChange={e => setPayForm(f => ({ ...f, bankAccountId: e.target.value }))} className="select-field text-sm">
                <option value="">Select bank account</option>
                {filteredBankAccounts.map((b: any) => <option key={b.id} value={b.id}>{b.bankName} {b.accountNumber || ""}</option>)}
              </select>
            )}
            {payForm.paidFrom === "intermediary" && (
              <select value={payForm.intermediaryId} onChange={e => setPayForm(f => ({ ...f, intermediaryId: e.target.value }))} className="select-field text-sm">
                <option value="">Select intermediary</option>
                {intermediaries.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Reference</label><input value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} className="input-field" placeholder="Receipt / instrument reference" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handlePayment} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Record Settlement"}</button></div>
      </Modal>
    </div>
  );
}
