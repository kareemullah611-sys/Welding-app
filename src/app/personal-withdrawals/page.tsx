"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function PersonalWithdrawalsPage() {
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
  const [cashPosition, setCashPosition] = useState<any>(null);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [form, setForm] = useState({ withdrawalDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", withdrawnBy: "", notes: "", currencyId: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [approvingId, setApprovingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [result, cashRes] = await Promise.all([
      apiCall("/api/v1/personal-withdrawals", { params: { page, limit: 20 } }),
      apiCall("/api/v1/cash-position"),
    ]);
    if (result.success) {
      setItems(result.data as any[]);
      setTotalPages((result.pagination as any)?.totalPages || 1);
      setTotal((result.pagination as any)?.total || 0);
    }
    if (cashRes.success) setCashPosition(cashRes.data);
    setLoading(false);
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    const cityRes = await apiCall("/api/v1/cities");
    if (cityRes.success && user?.cityId) {
      const city = (cityRes.data as any[]).find((c: any) => c.id === user.cityId);
      if (city?.currencies?.length) { setCurrencies(city.currencies); setForm((f) => ({ ...f, currencyId: city.currencies[0].id })); }
    }
    setForm((f) => ({ ...f, withdrawalDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", withdrawnBy: "", notes: "" }));
    setShowCreate(true); setFormError("");
  };

  const handleCreate = async () => {
    if (!form.amount || !form.detail) { setFormError(t("amount") + " " + t("and") + " " + t("detail") + " required"); return; }
    setSubmitting(true);
    const result = await apiCall("/api/v1/personal-withdrawals", { method: "POST", body: form });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const openEdit = (w: any) => {
    setSelected(w);
    setForm({ withdrawalDate: w.withdrawalDate, amount: w.amount, detail: w.detail, withdrawnBy: w.withdrawnBy || "", notes: w.notes || "", currencyId: 0 });
    setShowEdit(true); setFormError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const result = await apiCall(`/api/v1/personal-withdrawals/${selected.id}`, {
      method: "PUT",
      body: { amount: form.amount, detail: form.detail, withdrawnBy: form.withdrawnBy, notes: form.notes },
    });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };

  const handleDelete = async (w: any) => {
    if (!confirm(`${t("confirm_delete")} "${w.detail}"?`)) return;
    await apiCall(`/api/v1/personal-withdrawals/${w.id}`, { method: "DELETE" });
    load();
  };

  const handleApprove = async (w: any) => {
    const label = w.withdrawnBy ? `"${w.withdrawnBy}"` : `"${w.detail}"`;
    if (!confirm(`Approve withdrawal of ${w.currency?.symbol} ${w.amount?.toLocaleString()} by ${label}?\n\nThis will create a Haji Transfer automatically.`)) return;
    setApprovingId(w.id);
    const result = await apiCall(`/api/v1/personal-withdrawals/${w.id}/approve`, { method: "POST" });
    setApprovingId(null);
    if (result.success) { load(); } else { alert(result.error || "Approval failed"); }
  };

  // Summary of pending withdrawals grouped by person
  const pendingItems = items.filter((w) => !w.approvedAt);
  const personTotals = pendingItems.reduce((acc: Record<string, number>, w) => {
    const name = w.withdrawnBy || "—";
    acc[name] = (acc[name] || 0) + Number(w.amount);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title={t("personal_withdrawals")}
        subtitle={`${total} ${t("records").toLowerCase()}`}
        action={user?.role === "city_admin" ? (
          <button onClick={openCreate} className="btn-primary text-sm">+ {t("record_withdrawal")}</button>
        ) : undefined}
      />

      {cashPosition && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          💰 {t("cash_in_hand")}: <strong>{formatNumber(cashPosition.netCashInHand)}</strong>
          {" — "}{t("total_withdrawn")}: <strong>{formatNumber(cashPosition.outgoing?.personalWithdrawals || 0)}</strong>
        </div>
      )}

      {/* Pending approvals summary for super admin */}
      {user?.role === "super_admin" && pendingItems.length > 0 && (
        <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-xl">
          <p className="text-sm font-semibold text-orange-800 mb-2">⏳ Pending Approval — {pendingItems.length} withdrawal(s)</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(personTotals).map(([name, tot]) => (
              <span key={name} className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-2.5 py-1 rounded-full font-medium">
                {name}: {formatNumber(tot)}
              </span>
            ))}
          </div>
        </div>
      )}

      <DataTable
        columns={[
          { key: "withdrawalDate", label: t("date") },
          {
            key: "withdrawnBy",
            label: "Withdrawn By",
            render: (w: any) => (
              <div>
                <span className="font-medium text-gray-800">{w.withdrawnBy || <span className="text-gray-400 italic text-xs">not specified</span>}</span>
                <p className="text-xs text-gray-500 mt-0.5">{w.detail}</p>
              </div>
            ),
          },
          {
            key: "amount",
            label: t("amount"),
            render: (w: any) => <span className="font-medium text-red-600">{w.currency?.symbol} {w.amount?.toLocaleString()}</span>,
          },
          {
            key: "status",
            label: "Status",
            render: (w: any) => w.approvedAt ? (
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
                  ✓ Approved
                </span>
                <p className="text-xs text-gray-400 mt-0.5">by {w.approvedBy?.fullName}</p>
              </div>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                ⏳ Pending
              </span>
            ),
          },
          { key: "notes", label: t("notes"), render: (w: any) => w.notes || "-" },
          {
            key: "actions",
            label: "",
            render: (w: any) => (
              <div className="flex gap-2 items-center flex-wrap">
                {!w.approvedAt && (
                  <>
                    <button onClick={() => openEdit(w)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
                    {user?.role === "super_admin" && (
                      <button
                        onClick={() => handleApprove(w)}
                        disabled={approvingId === w.id}
                        className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded font-semibold disabled:opacity-50"
                      >
                        {approvingId === w.id ? "Approving..." : "Approve → Haji"}
                      </button>
                    )}
                    <button onClick={() => handleDelete(w)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>
                  </>
                )}
                {w.approvedAt && w.hajiTransferId && (
                  <span className="text-xs text-gray-400">Haji #{w.hajiTransferId}</span>
                )}
              </div>
            ),
          },
        ]}
        data={items}
        loading={loading}
        pagination={{ page, totalPages, total, onPageChange: setPage }}
      />

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("record_withdrawal")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Withdrawn By <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              value={form.withdrawnBy}
              onChange={(e) => setForm((f) => ({ ...f, withdrawnBy: e.target.value }))}
              className="input-field"
              placeholder="e.g. Ali, Rehman"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label>
            <input type="date" value={form.withdrawalDate} onChange={(e) => setForm((f) => ({ ...f, withdrawalDate: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label>
            <input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label>
            <input type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
          ⏳ This withdrawal stays <strong>pending</strong> until super admin approves it — then it automatically becomes a Haji Transfer.
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button>
        </div>
      </Modal>

      {/* EDIT */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_withdrawal")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Withdrawn By</label>
            <input value={form.withdrawnBy} onChange={(e) => setForm((f) => ({ ...f, withdrawnBy: e.target.value }))} className="input-field" placeholder="e.g. Ali, Rehman" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label>
            <input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label>
            <input type="number" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label>
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="input-field" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
