"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";

export default function GodownsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [godowns, setGodowns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", cityId: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall("/api/v1/godowns", { params: { limit: 100, is_active: "true" } });
    if (result.success) setGodowns(result.data as any[]);
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

  const openCreate = async () => {
    if (user?.role === "super_admin") { const cityRes = await apiCall("/api/v1/cities"); if (cityRes.success) setCities(cityRes.data as any[]); }
    setForm({ name: "", cityId: user?.cityId || 0 }); setShowCreate(true); setFormError("");
  };
  const handleCreate = async () => {
    if (!form.name.trim()) { setFormError(t("name") + " " + t("reason_required").toLowerCase()); return; }
    setSubmitting(true);
    const result = await apiCall("/api/v1/godowns", { method: "POST", body: form });
    setSubmitting(false);
    if (result.success) { setShowCreate(false); load(); } else { setFormError(result.error || "Failed"); }
  };
  const openEdit = (g: any) => { setSelected(g); setForm({ name: g.name, cityId: g.cityId }); setShowEdit(true); setFormError(""); };
  const handleEdit = async () => {
    setSubmitting(true);
    const result = await apiCall(`/api/v1/godowns/${selected.id}`, { method: "PUT", body: { name: form.name } });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };
  const handleDeactivate = async (g: any) => {
    if (!confirm(`"${g.name}": ${t("confirm_deactivate_godown")}`)) return;
    await apiCall(`/api/v1/godowns/${g.id}`, { method: "PUT", body: { isActive: false } });
    load();
  };
  const handleDeleteGodown = async (g: any) => {
    if (!confirm(`"${g.name}": ${t("confirm_delete_godown")}`)) return;
    const r = await apiCall(`/api/v1/godowns/${g.id}`, { method: "DELETE" });
    if (r.success) load(); else alert(r.error || "Cannot delete - godown may have stock");
  };

  return (
    <div>
      <PageHeader title={t("godowns")} subtitle={`${godowns.length} ${t("godowns").toLowerCase()}`} action={<button onClick={openCreate} className="btn-primary text-sm">+ {t("new_godown")}</button>} />
      <DataTable columns={[
        { key: "name", label: t("godown_name"), render: (g: any) => <span className="font-medium">{g.name}</span> },
        { key: "cityName", label: t("city") },
        { key: "countryName", label: t("country") },
        { key: "isActive", label: t("status"), render: (g: any) => <span className={g.isActive ? "badge-active" : "badge-cancelled"}>{g.isActive ? t("active") : t("inactive")}</span> },
        { key: "actions", label: "", render: (g: any) => (
          <div className="relative" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} data-action-menu-root="true">
            <button
              type="button"
              onPointerDown={(event) => { event.stopPropagation(); }}
              onClick={(event) => {
                event.stopPropagation();
                setActionMenuDirection("down");
                setOpenActionId((current) => current === g.id ? null : g.id);
              }}
              className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
            >
              ⋯
            </button>
            {openActionId === g.id && (
              <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`} data-action-menu-root="true">
                <button onClick={() => { setOpenActionId(null); openEdit(g); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">{t("edit")}</button>
                {g.isActive ? (
                  <button onClick={() => { setOpenActionId(null); handleDeactivate(g); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("deactivate")}</button>
                ) : (
                  <button onClick={() => { setOpenActionId(null); handleDeleteGodown(g); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">{t("delete")}</button>
                )}
              </div>
            )}
          </div>
        )},
      ]} data={godowns} loading={loading} />
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_godown")} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" /></div>
          {user?.role === "super_admin" && <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("city")} *</label><select value={form.cityId} onChange={(e) => setForm((f) => ({ ...f, cityId: parseInt(e.target.value) }))} className="select-field"><option value={0}>{t("select")}</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.name || ""}`} size="md">
        {formError && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{formError}</div>}
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")}</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </div>
  );
}
