"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber, formatDate } from "@/components/ui";
import { useLang } from "@/lib/lang";


const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  cash_office:    { label: "Cash from Office", icon: "💵", color: "bg-green-50 text-green-700" },
  cheque:         { label: "Cheque",            icon: "🧾", color: "bg-blue-50 text-blue-700"  },
  bank_transfer:  { label: "Bank Transfer",     icon: "🏦", color: "bg-purple-50 text-purple-700" },
  // legacy
  from_in_hand:   { label: "Cash from Office", icon: "💵", color: "bg-green-50 text-green-700" },
  direct:         { label: "Bank Transfer",     icon: "🏦", color: "bg-purple-50 text-purple-700" },
};

export default function HajiTransfersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [lots, setLots] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [inHandCheques, setInHandCheques] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    lotId: 0, transferDate: new Date().toISOString().split("T")[0],
    amount: 0, currencyId: 0, detail: "", sourceType: "cash_office",
    bankAccountId: 0, chequePaymentId: 0, transferredTo: "", notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showSummary, setShowSummary] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params: any = { page, limit: 20 };
    if (filterFrom) params.date_from = filterFrom;
    if (filterTo) params.date_to = filterTo;
    const r = await apiCall("/api/v1/haji-transfers", { params });
    if (r.success) { setItems(r.data as any[]); setTotalPages((r.pagination as any)?.totalPages || 1); setTotal((r.pagination as any)?.total || 0); }
    setLoading(false);
  }, [page, filterFrom, filterTo]);
  useEffect(() => { load(); }, [load]);

  // Group totals by transferredTo person
  const personTotals = items.reduce((acc: Record<string, Record<string, number>>, tr: any) => {
    const name = tr.transferredTo || "—";
    if (!acc[name]) acc[name] = {};
    const cc = tr.currency?.code || "?";
    acc[name][cc] = (acc[name][cc] || 0) + Number(tr.amount);
    return acc;
  }, {});

  const openCreate = async () => {
    const [lR, cR, baR, chR] = await Promise.all([
      apiCall("/api/v1/lots", { params: { limit: 100 } }),
      apiCall("/api/v1/cities"),
      apiCall("/api/v1/bank-accounts"),
      apiCall("/api/v1/finance/combined", { params: { type: "payment", limit: 100 } }),
    ]);
    if (lR.success) setLots(lR.data as any[]);
    if (cR.success && user?.cityId) {
      const city = (cR.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { setCurrencies(city.currencies); setForm((f: any) => ({ ...f, currencyId: city.currencies[0].id })); }
    }
    if (baR.success) setBankAccounts(baR.data as any[]);
    if (chR.success) {
      const cheques = (chR.data as any[]).filter((item: any) =>
        item.type === "payment" && item.raw?.paymentMethod === "cheque" && item.raw?.chequeStatus === "in_hand"
      );
      setInHandCheques(cheques);
    }
    setForm((f: any) => ({
      ...f, transferDate: new Date().toISOString().split("T")[0],
      amount: 0, detail: "", sourceType: "cash_office",
      bankAccountId: 0, chequePaymentId: 0, transferredTo: "", notes: "", lotId: 0,
    }));
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.detail) { setError(t("detail") + " required"); return; }
    if (form.sourceType !== "cheque" && !form.amount) { setError(t("amount") + " required"); return; }
    if (form.sourceType === "cheque" && !form.chequePaymentId) { setError("Please select a cheque"); return; }
    if (form.sourceType === "bank_transfer" && !form.bankAccountId) { setError("Please select a bank account"); return; }

    setSubmitting(true);
    // Build body with backward compat transferType
    const body: any = {
      ...form,
      sourceType: form.sourceType,
      transferType: form.sourceType === "cash_office" ? "from_in_hand"
        : form.sourceType === "bank_transfer" ? "direct"
        : "from_in_hand",
    };
    if (!body.lotId) delete body.lotId;
    if (!body.currencyId) delete body.currencyId;
    if (!body.transferredTo) delete body.transferredTo;
    if (body.sourceType !== "bank_transfer") delete body.bankAccountId;
    if (body.sourceType !== "cheque") delete body.chequePaymentId;
    // For cheque: amount comes from selected cheque
    if (form.sourceType === "cheque" && form.chequePaymentId) {
      const sel = inHandCheques.find((c: any) => c.id === Number(form.chequePaymentId));
      if (sel) body.amount = sel.amount;
    }

    const r = await apiCall("/api/v1/haji-transfers", { method: "POST", body });
    if (r.success) {
      setShowCreate(false); load();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  const openEdit = (item: any) => {
    setSelected(item);
    // Map legacy transferType → sourceType
    let sourceType = item.sourceType || (
      item.transferType === "direct" ? "bank_transfer" :
      item.transferType === "from_in_hand" ? "cash_office" : "cash_office"
    );
    setForm({
      lotId: item.lotId, transferDate: item.transferDate, amount: item.amount,
      currencyId: item.currencyId || 0, detail: item.detail,
      sourceType, transferType: item.transferType || "from_in_hand",
      bankAccountId: item.bankAccountId || 0, chequePaymentId: item.chequePaymentId || 0,
      transferredTo: item.transferredTo || "", notes: item.notes || "",
    });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const body: any = {
      amount: form.amount, detail: form.detail,
      sourceType: form.sourceType,
      transferType: form.sourceType === "cash_office" ? "from_in_hand" : form.sourceType === "bank_transfer" ? "direct" : "from_in_hand",
      transferredTo: form.transferredTo || null, notes: form.notes,
    };
    if (form.sourceType === "bank_transfer" && form.bankAccountId) body.bankAccountId = form.bankAccountId;
    const r = await apiCall(`/api/v1/haji-transfers/${selected.id}`, { method: "PUT", body });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`${t("confirm_delete")} "${item.detail}"?`)) return;
    await apiCall(`/api/v1/haji-transfers/${item.id}`, { method: "DELETE" });
    load();
  };

  const getSourceType = (tr: any) => tr.sourceType || (tr.transferType === "direct" ? "bank_transfer" : "cash_office");

  return (
    <div>
      <PageHeader
        title={t("haji_transfers")}
        subtitle={`${total} ${t("records").toLowerCase()}`}
        action={user?.role === "city_admin" ? (
          <div className="flex gap-2 items-center">
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="input-field w-auto text-xs" placeholder="From" />
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="input-field w-auto text-xs" placeholder="To" />
            <button onClick={openCreate} className="btn-primary text-sm">+ {t("record_haji_transfer")}</button>
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="input-field w-auto text-xs" />
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="input-field w-auto text-xs" />
          </div>
        )}
      />

      {/* Person totals summary */}
      {Object.keys(personTotals).length > 0 && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-blue-800">💸 Transferred To — Summary</p>
            <button onClick={() => setShowSummary(v => !v)} className="text-xs text-blue-600">{showSummary ? "Hide" : "Show"}</button>
          </div>
          {showSummary && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(personTotals).map(([name, totByCurr]) => (
                <div key={name} className="bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-sm">
                  <span className="font-semibold text-blue-800">{name}</span>
                  {Object.entries(totByCurr).map(([cc, amt]) => (
                    <span key={cc} className="ml-2 text-blue-600">{cc} {formatNumber(amt)}</span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DataTable columns={[
        { key: "transferDate", label: t("date"), render: (tr: any) => formatDate(tr.transferDate) },
        {
          key: "detail", label: t("detail"),
          render: (tr: any) => (
            <div>
              <span>{tr.detail}</span>
              {tr.transferredTo && <p className="text-xs text-blue-600 mt-0.5">→ {tr.transferredTo}</p>}
            </div>
          ),
        },
        { key: "amount", label: t("amount"), render: (tr: any) => <span className="font-medium text-orange-600">{tr.currency?.symbol || ""} {tr.amount?.toLocaleString("en-US")}</span> },
        {
          key: "sourceType", label: t("type"),
          render: (tr: any) => {
            const st = getSourceType(tr);
            const cfg = SOURCE_CONFIG[st] || SOURCE_CONFIG.cash_office;
            return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</span>;
          },
        },
        { key: "lotNumber", label: t("lot"), render: (tr: any) => tr.lot?.lotNumber || tr.lotNumber || "-" },
        {
          key: "actions", label: "",
          render: (tr: any) => (
            <div className="flex gap-2">
              {user?.role === "city_admin" && <button onClick={() => openEdit(tr)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>}
              {user?.role === "city_admin" && <button onClick={() => handleDelete(tr)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>}
            </div>
          ),
        },
      ]} data={items} loading={loading} pagination={{ page, totalPages, total, onPageChange: setPage }} />

      {/* CREATE MODAL */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("record_haji_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
              <input type="date" value={form.transferDate} onChange={e => setForm((f: any) => ({ ...f, transferDate: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("source_of_funds")} *</label>
              <select value={form.sourceType} onChange={e => setForm((f: any) => ({ ...f, sourceType: e.target.value, chequePaymentId: 0, bankAccountId: 0 }))} className="select-field">
                <option value="cash_office">💵 {t("cash_from_office")}</option>
                <option value="cheque">🧾 {t("cheque")}</option>
                <option value="bank_transfer">🏦 {t("bank_transfer")}</option>
              </select>
            </div>
          </div>

          {/* Cheque selector */}
          {form.sourceType === "cheque" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("select_cheques")} *</label>
              {inHandCheques.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">No cheques in hand. Record a cheque payment first.</div>
              ) : (
                <select
                  value={form.chequePaymentId || 0}
                  onChange={e => {
                    const id = parseInt(e.target.value);
                    const sel = inHandCheques.find((c: any) => c.id === id);
                    setForm((f: any) => ({ ...f, chequePaymentId: id, amount: sel ? sel.amount : f.amount }));
                  }}
                  className="select-field"
                >
                  <option value={0}>— Select a cheque —</option>
                  {inHandCheques.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      #{c.raw?.chequeNumber || c.id} · {c.person} · {c.currencySymbol} {c.amount?.toLocaleString("en-US")}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Bank account selector */}
          {form.sourceType === "bank_transfer" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("bank_account")} *</label>
              {bankAccounts.length === 0 ? (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">{t("no_bank_accounts")}. Add one in Settings → Bank Accounts.</div>
              ) : (
                <select value={form.bankAccountId || 0} onChange={e => setForm((f: any) => ({ ...f, bankAccountId: parseInt(e.target.value) }))} className="select-field">
                  <option value={0}>— Select bank account —</option>
                  {bankAccounts.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.bankName}{b.accountNumber ? ` (${b.accountNumber})` : ""}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transferred To <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input value={form.transferredTo} onChange={e => setForm((f: any) => ({ ...f, transferredTo: e.target.value }))} className="input-field" placeholder="Person or account name" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("amount")} {form.sourceType === "cheque" ? <span className="text-gray-400 font-normal">(auto from cheque)</span> : "*"}
              </label>
              <input
                type="number" value={form.amount || ""}
                onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                className="input-field"
                readOnly={form.sourceType === "cheque" && !!form.chequePaymentId}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label>
              <select value={form.lotId} onChange={e => setForm((f: any) => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field">
                <option value={0}>{t("auto_fifo")}</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>

        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("source_of_funds")}</label>
            <select value={form.sourceType} onChange={e => setForm((f: any) => ({ ...f, sourceType: e.target.value }))} className="select-field">
              <option value="cash_office">💵 {t("cash_from_office")}</option>
              <option value="cheque">🧾 {t("cheque")}</option>
              <option value="bank_transfer">🏦 {t("bank_transfer")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transferred To</label>
            <input value={form.transferredTo} onChange={e => setForm((f: any) => ({ ...f, transferredTo: e.target.value }))} className="input-field" placeholder="Person or account name" />
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail} onChange={e => setForm((f: any) => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm((f: any) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>

    </div>
  );
}
