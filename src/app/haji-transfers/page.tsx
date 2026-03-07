"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal, formatNumber } from "@/components/ui";
import { useLang } from "@/lib/lang";

async function openAttachment(filePath: string) {
  try {
    const res = await fetch(filePath);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } catch {
    window.open(filePath, "_blank");
  }
}

async function uploadFile(file: File, entityType: string, entityId: number) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("entityType", entityType);
  fd.append("entityId", String(entityId));
  const res = await fetch("/api/v1/upload", { method: "POST", body: fd });
  return res.json();
}

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
  const [form, setForm] = useState({ lotId: 0, transferDate: new Date().toISOString().split("T")[0], amount: 0, currencyId: 0, detail: "", transferType: "from_in_hand" as string, transferredTo: "", notes: "" });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Filters for person summary
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
    const [lR, cR] = await Promise.all([apiCall("/api/v1/lots", { params: { limit: 100 } }), apiCall("/api/v1/cities")]);
    if (lR.success) setLots(lR.data as any[]);
    if (cR.success && user?.cityId) { const city = (cR.data as any[]).find((c: any) => c.id === user.cityId); if (city?.currencies?.length) { setCurrencies(city.currencies); setForm(f => ({ ...f, currencyId: city.currencies[0].id })); } }
    setForm(f => ({ ...f, transferDate: new Date().toISOString().split("T")[0], amount: 0, detail: "", transferredTo: "", notes: "", lotId: 0 }));
    setPendingFile(null);
    setShowCreate(true); setError("");
  };

  const handleCreate = async () => {
    if (!form.amount || !form.detail) { setError(t("amount") + " " + t("and") + " " + t("detail") + " required"); return; }
    setSubmitting(true);
    const body: any = { ...form };
    if (!body.lotId) delete body.lotId;
    if (!body.currencyId) delete body.currencyId;
    if (!body.transferredTo) delete body.transferredTo;
    const r = await apiCall("/api/v1/haji-transfers", { method: "POST", body });
    if (r.success) {
      if (pendingFile && r.data?.id) await uploadFile(pendingFile, "haji_transfer", r.data.id);
      setShowCreate(false); load();
    } else { setError(r.error || "Failed"); }
    setSubmitting(false);
  };

  const openEdit = (item: any) => {
    setSelected(item);
    setForm({ lotId: item.lotId, transferDate: item.transferDate, amount: item.amount, currencyId: item.currencyId || 0, detail: item.detail, transferType: item.transferType, transferredTo: item.transferredTo || "", notes: item.notes || "" });
    setShowEdit(true); setError("");
  };

  const handleEdit = async () => {
    setSubmitting(true);
    const r = await apiCall(`/api/v1/haji-transfers/${selected.id}`, { method: "PUT", body: { amount: form.amount, detail: form.detail, transferType: form.transferType, transferredTo: form.transferredTo || null, notes: form.notes } });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`${t("confirm_delete")} "${item.detail}"?`)) return;
    await apiCall(`/api/v1/haji-transfers/${item.id}`, { method: "DELETE" });
    load();
  };

  const handleInlineUpload = async (item: any, file: File) => {
    setUploadingFor(item.id);
    await uploadFile(file, "haji_transfer", item.id);
    setUploadingFor(null);
    load();
  };

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
        { key: "transferDate", label: t("date") },
        {
          key: "detail", label: t("detail"),
          render: (tr: any) => (
            <div>
              <span>{tr.detail}</span>
              {tr.transferredTo && <p className="text-xs text-blue-600 mt-0.5">→ {tr.transferredTo}</p>}
            </div>
          ),
        },
        { key: "amount", label: t("amount"), render: (tr: any) => <span className="font-medium text-orange-600">{tr.currency?.symbol || ""} {tr.amount?.toLocaleString()}</span> },
        { key: "transferType", label: t("type"), render: (tr: any) => <span className={`text-xs px-1.5 py-0.5 rounded ${tr.transferType === "direct" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"}`}>{tr.transferType === "direct" ? t("direct_transfer") : t("from_in_hand")}</span> },
        { key: "lotNumber", label: t("lot"), render: (tr: any) => tr.lot?.lotNumber || tr.lotNumber || "-" },
        {
          key: "attachment", label: "📎",
          render: (tr: any) => (
            <div className="flex flex-col gap-1">
              {(tr.attachments || []).map((a: any) => (
                <button key={a.id} onClick={() => openAttachment(a.filePath)} className="text-xs text-primary-600 hover:underline truncate max-w-[100px] text-left">
                  {a.fileType === "pdf" ? "📄" : "🖼️"} {a.fileName}
                </button>
              ))}
              {user?.role === "city_admin" && (
                <>
                  <label className="text-xs text-gray-400 hover:text-primary-600 cursor-pointer">
                    {uploadingFor === tr.id ? "..." : "+ Attach"}
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleInlineUpload(tr, f); e.target.value = ""; }} />
                  </label>
                </>
              )}
            </div>
          ),
        },
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

      {/* CREATE */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("record_haji_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("date")} *</label><input type="date" value={form.transferDate} onChange={e => setForm(f => ({ ...f, transferDate: e.target.value }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")} *</label><select value={form.transferType} onChange={e => setForm(f => ({ ...f, transferType: e.target.value }))} className="select-field"><option value="from_in_hand">{t("from_in_hand")}</option><option value="direct">{t("direct_transfer")}</option></select></div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transferred To <span className="text-gray-400 font-normal">(optional — e.g. Shehbaz)</span>
            </label>
            <input value={form.transferredTo} onChange={e => setForm(f => ({ ...f, transferredTo: e.target.value }))} className="input-field" placeholder="Person or account name" />
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")} *</label><input value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")} *</label><input type="number" value={form.amount || ""} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("lot")}</label><select value={form.lotId} onChange={e => setForm(f => ({ ...f, lotId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("auto_fifo")}</option>{lots.map(l => <option key={l.id} value={l.id}>{l.lotNumber}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Attach File <span className="text-gray-400 font-normal">(photo or PDF, optional)</span></label>
            <input type="file" accept="image/*,.pdf" ref={uploadRef} onChange={e => setPendingFile(e.target.files?.[0] || null)} className="text-sm text-gray-600" />
            {pendingFile && <p className="text-xs text-green-600 mt-1">📎 {pendingFile.name}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("record")}</button>
        </div>
      </Modal>

      {/* EDIT */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={t("edit_transfer")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transferred To</label>
            <input value={form.transferredTo} onChange={e => setForm(f => ({ ...f, transferredTo: e.target.value }))} className="input-field" placeholder="Person or account name" />
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("detail")}</label><input value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} className="input-field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("amount")}</label><input type="number" value={form.amount || ""} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("type")}</label><select value={form.transferType} onChange={e => setForm(f => ({ ...f, transferType: e.target.value }))} className="select-field"><option value="from_in_hand">{t("from_in_hand")}</option><option value="direct">{t("direct_transfer")}</option></select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("notes")}</label><input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" /></div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t">
          <button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button>
          <button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button>
        </div>
      </Modal>
    </div>
  );
}
