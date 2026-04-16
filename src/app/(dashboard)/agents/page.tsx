"use client";
import React, { useEffect, useState, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";

const TYPES = [
  { value: "customs", label: "Customs Agent" },
  { value: "transport", label: "Transport" },
  { value: "freight", label: "Legacy Freight" },
  { value: "other", label: "Other" },
];

export default function AgentsPage() {
  const { t } = useLang();
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [form, setForm] = useState({ name: "", agentType: "customs", cityId: 0, phone: "" });
  const [payForm, setPayForm] = useState({ agentId: 0, cityId: 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, currencyCode: "PKR", paymentMethod: "cash", reference: "", paidFrom: "city_cash", bankAccountId: "", intermediaryId: "" });
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [intermediaries, setIntermediaries] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");
  const filteredBankAccounts = bankAccounts.filter((b: any) => !payForm.cityId || b.cityId === payForm.cityId);
  const agentTypeFilter = String(searchParams.get("agentType") || "").toLowerCase();
  const showOnlyCustomAgents = agentTypeFilter === "customs";
  const showOnlyClearingAgents = agentTypeFilter === "clearing";
  const visibleAgents = agents.filter((agent: any) => {
    const type = String(agent.agentType || "").toLowerCase();
    if (showOnlyCustomAgents) return type === "customs";
    if (showOnlyClearingAgents) return type !== "customs";
    return true;
  });
  const pageTitle = showOnlyCustomAgents ? "Custom Agents" : showOnlyClearingAgents ? "Clearing Agents" : t("agents");
  const pageSubtitle = showOnlyCustomAgents ? "Custom-agent liabilities and settlements" : t("agents_subtitle");

  const load = useCallback(async () => {
    setLoading(true);
    const [aR, cR] = await Promise.all([apiCall("/api/v1/agents", { params: { limit: 100 } }), apiCall("/api/v1/cities", { params: { all: "true" } })]);
    if (aR.success) setAgents(aR.data as any[]);
    if (cR.success) setCities(cR.data as any[]);
    setLoading(false);
  }, []);
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
    setSelected(a); setShowLedger(true); setLedgerData(null);
    const r = await apiCall(`/api/v1/agents/${a.id}`);
    if (r.success) setLedgerData(r.data);
  };

  const openPayment = async (a: any) => {
    setSelected(a);
    setPayForm({ agentId: a.id, cityId: a.city?.id || cities[0]?.id || 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, currencyCode: "PKR", paymentMethod: "cash", reference: "", paidFrom: "city_cash", bankAccountId: "", intermediaryId: "" });
    setShowPayment(true); setError("");
    const [baRes, intRes] = await Promise.all([
      bankAccounts.length ? Promise.resolve({ success: true, data: bankAccounts }) : apiCall("/api/v1/bank-accounts", { params: { limit: 100 } }),
      intermediaries.length ? Promise.resolve({ success: true, data: intermediaries }) : apiCall("/api/v1/intermediaries"),
    ]);
    if (baRes.success) setBankAccounts((baRes.data as any).items || baRes.data as any[]);
    if (intRes.success) setIntermediaries(intRes.data as any[]);
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
      <PageHeader title={pageTitle} subtitle={pageSubtitle} action={<button onClick={() => { setForm({ name: "", agentType: showOnlyClearingAgents ? "transport" : "customs", cityId: 0, phone: "" }); setShowCreate(true); setError(""); }} className="btn-primary text-sm">+ {t("new_agent")}</button>} />
      <DataTable columns={[
        { key: "name", label: t("name"), render: (a: any) => <button onClick={() => openLedger(a)} className="font-medium text-primary-600 hover:underline">{a.name}</button> },
        { key: "agentType", label: t("type"), render: (a: any) => <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">{TYPES.find(ty => ty.value === a.agentType)?.label || a.agentType}</span> },
        { key: "city", label: t("city"), render: (a: any) => a.city?.name || "-" },
        { key: "balance", label: t("balance_owed"), render: (a: any) => <div>{Object.entries(a.balance || {}).map(([cc, bal]: [string, any]) => <div key={cc} className={`text-sm font-medium ${bal > 0 ? "text-red-600" : "text-green-600"}`}>{cc} {bal.toLocaleString("en-US")}</div>)}</div> },
        {
          key: "actions", label: "", render: (a: any) => (
            <div className="relative" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} data-action-menu-root="true">
              <button
                type="button"
                onPointerDown={(event) => { event.stopPropagation(); }}
                onClick={(event) => {
                  event.stopPropagation();
                  setActionMenuDirection("down");
                  setOpenActionId((current) => current === a.id ? null : a.id);
                }}
                className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
                aria-label="Open actions"
              >
                ⋯
              </button>
              {openActionId === a.id && (
                <div className={`absolute right-0 z-50 w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`}>
                  <button onClick={() => { setOpenActionId(null); openLedger(a); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">Open Ledger</button>
                  <button onClick={() => { setOpenActionId(null); openPayment(a); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-green-700 hover:bg-green-50">{t("pay_agent")}</button>
                </div>
              )}
            </div>
          ),
        },
      ]} data={visibleAgents} loading={loading} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_agent")} size="md">
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
