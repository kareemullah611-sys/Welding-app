"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { useSearchParams } from "next/navigation";

export default function CustomersPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
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
  const [prefillHandled, setPrefillHandled] = useState(false);
  const closeEmbed = useCallback(() => {
    if (typeof window !== "undefined" && window.parent !== window) {
      window.parent.postMessage({ type: "dashboard-quick-close" }, window.location.origin);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall("/api/v1/customers", { params: { page, limit: 20 } });
    if (result.success) { setCustomers(result.data as any[]); setTotalPages((result.pagination as any)?.totalPages || 1); setTotal((result.pagination as any)?.total || 0); }
    setLoading(false);
  }, [page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (prefillHandled || user?.role !== "city_admin") return;
    if (searchParams.get("create") !== "1") return;
    setPrefillHandled(true);
    openCreate();
    window.history.replaceState({}, "", "/customers");
  }, [prefillHandled, searchParams, user?.role]);

  const openCreate = () => { setForm({ name: "", phone: "", address: "", cityId: user?.cityId || 0 }); setShowCreate(true); setFormError(""); };
  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError("Name required"); return; }
    setSubmitting(true);
    const result = await apiCall("/api/v1/customers", { method: "POST", body: form });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); if (isEmbed) closeEmbed(); load(); } else { setFormError(result.error || "Failed"); }
  };

  const openEdit = (c: any) => { setSelected(c); setForm({ name: c.name, phone: c.phone || "", address: c.address || "", cityId: c.cityId }); setShowEdit(true); setFormError(""); };
  const handleEdit = async () => {
    setSubmitting(true);
    const result = await apiCall(`/api/v1/customers/${selected.id}`, { method: "PUT", body: form });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const handleDelete = async (c: any) => {
    if (!confirm(`${c.name}: ${t("confirm_deactivate_customer")}`)) return;
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
    await apiCall(`/api/v1/customers/${c.id}`, { method: "PUT", body: { isActive: true } });
    load();
  };

  const openLedger = async (c: any) => {
    setSelected(c); setShowLedger(true); setLedgerData(null);
    const result = await apiCall(`/api/v1/customers/${c.id}`);
    if (result.success) setLedgerData(result.data);
  };

  return (
    <div>
      {!isEmbed && <PageHeader title={t("customers")} subtitle={`${total} ${t("customers").toLowerCase()}`} />}
      {!isEmbed && <DataTable columns={[
        { key: "name", label: t("name"), render: (c: any) => (
          <div className="flex items-center gap-2">
            <button onClick={() => openLedger(c)} className="font-medium text-primary-600 hover:underline">{c.name}</button>
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
          <div className="flex gap-2">
            {c.isActive && <button onClick={() => openEdit(c)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>}
            {c.isActive
              ? <button onClick={() => handleDelete(c)} className="text-xs text-red-600 hover:underline">{t("deactivate")}</button>
              : <button onClick={() => handleReactivate(c)} className="text-xs text-green-600 hover:underline">{t("reactivate")}</button>
            }
            {user?.role === "super_admin" && (
              <button onClick={() => openHardDelete(c)} className="text-xs text-red-800 font-semibold hover:underline">{t("hard_delete")}</button>
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
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      {/* EDIT */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.name || ""}`} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("phone")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("address")}</label><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
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
