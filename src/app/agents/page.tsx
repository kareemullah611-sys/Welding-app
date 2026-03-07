"use client";
import React, { useEffect, useState, useCallback } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, StatsCard, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

const TYPES = [{ value: "customs", label: "Customs Agent" }, { value: "transport", label: "Transport" }, { value: "freight", label: "Freight/Shipping" }, { value: "other", label: "Other" }];

export default function AgentsPage() {
  const { t } = useLang();
  const [agents, setAgents] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [form, setForm] = useState({ name: "", agentType: "customs", cityId: 0, phone: "" });
  const [payForm, setPayForm] = useState({ agentId: 0, cityId: 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, currencyCode: "PKR", paymentMethod: "cash", reference: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [aR, cR] = await Promise.all([apiCall("/api/v1/agents", { params: { limit: 100 } }), apiCall("/api/v1/cities", { params: { all: "true" } })]);
    if (aR.success) setAgents(aR.data as any[]);
    if (cR.success) setCities(cR.data as any[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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

  const openPayment = (a: any) => {
    setSelected(a);
    setPayForm({ agentId: a.id, cityId: a.city?.id || cities[0]?.id || 0, paymentDate: new Date().toISOString().split("T")[0], amount: 0, currencyCode: "PKR", paymentMethod: "cash", reference: "" });
    setShowPayment(true); setError("");
  };

  const handlePayment = async () => {
    if (!payForm.amount) { setError(t("amount") + " required"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/agent-payments", { method: "POST", body: payForm });
    setSubmitting(false);
    if (r.success) { setShowPayment(false); load(); } else { setError(r.error || "Failed"); }
  };

  return (
    <div>
      <PageHeader title={t("agents")} subtitle={t("agents_subtitle")} action={<button onClick={() => { setForm({ name: "", agentType: "customs", cityId: 0, phone: "" }); setShowCreate(true); setError(""); }} className="btn-primary text-sm">+ {t("new_agent")}</button>} />
      <DataTable columns={[
        { key: "name", label: t("name"), render: (a: any) => <button onClick={() => openLedger(a)} className="font-medium text-primary-600 hover:underline">{a.name}</button> },
        { key: "agentType", label: t("type"), render: (a: any) => <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">{TYPES.find(ty => ty.value === a.agentType)?.label || a.agentType}</span> },
        { key: "city", label: t("city"), render: (a: any) => a.city?.name || "-" },
        { key: "balance", label: t("balance_owed"), render: (a: any) => <div>{Object.entries(a.balance || {}).map(([cc, bal]: [string, any]) => <div key={cc} className={`text-sm font-medium ${bal > 0 ? "text-red-600" : "text-green-600"}`}>{cc} {bal.toLocaleString()}</div>)}</div> },
        { key: "actions", label: "", render: (a: any) => <button onClick={() => openPayment(a)} className="text-xs text-green-600 hover:underline">{t("pay_agent")}</button> },
      ]} data={agents} loading={loading} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_agent")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label><select value={form.agentType} onChange={e => setForm(f => ({ ...f, agentType: e.target.value }))} className="select-field">{TYPES.map(ty => <option key={ty.value} value={ty.value}>{ty.label}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("city_port")}</label><select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: parseInt(e.target.value) }))} className="select-field"><option value={0}>None</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("phone")}</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      <Modal open={showLedger} onClose={() => setShowLedger(false)} title={`${t("agent")}: ${selected?.name || ""}`} size="lg">
        {!ledgerData ? <div className="py-8 text-center text-gray-400">{t("loading")}</div> : <>
          <DataTable columns={[
            { key: "date", label: t("date") },
            { key: "type", label: t("type"), render: (e: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${e.type === "charge" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{e.type}</span> },
            { key: "description", label: t("description") },
            { key: "debit", label: t("charged"), render: (e: any) => e.debit ? <span className="text-red-600">{e.currency} {e.debit.toLocaleString()}</span> : "" },
            { key: "credit", label: t("paid"), render: (e: any) => e.credit ? <span className="text-green-600">{e.currency} {e.credit.toLocaleString()}</span> : "" },
            { key: "balance", label: t("balance"), render: (e: any) => <span className="font-medium">{e.balance.toLocaleString()}</span> },
          ]} data={ledgerData.ledger || []} loading={false} />
        </>}
      </Modal>

      <Modal open={showPayment} onClose={() => setShowPayment(false)} title={`${t("pay_agent")}: ${selected?.name || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" value={payForm.amount || ""} onChange={e => setPayForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("currency")}</label><select value={payForm.currencyCode} onChange={e => setPayForm(f => ({ ...f, currencyCode: e.target.value }))} className="select-field"><option value="PKR">PKR</option><option value="USD">USD</option><option value="AFN">AFN</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")}</label><input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("city")}</label><select value={payForm.cityId} onChange={e => setPayForm(f => ({ ...f, cityId: parseInt(e.target.value) }))} className="select-field">{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("reference")}</label><input value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} className="input-field" placeholder="Receipt/Ref no." /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowPayment(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handlePayment} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record_payment")}</button></div>
      </Modal>
    </div>
  );
}
