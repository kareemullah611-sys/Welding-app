"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal, RowActionMenu } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingGodowns } from "@/lib/offline-queue-overlays";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";

const GODOWNS_READ_CACHE_KEY = "mrf-godowns-read-cache-v1";

type GodownsReadSnapshot = {
  godowns: any[];
  cities: any[];
};

function applyQueuedMutationsToGodowns(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/godowns/")) continue;
    const match = url.match(/^\/api\/v1\/godowns\/([^/?#]+)/);
    const godownId = match?.[1];
    if (!godownId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== godownId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === godownId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            cityId: patch?.cityId ?? row?.cityId,
            isActive: typeof patch?.isActive === "boolean" ? patch.isActive : row?.isActive,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

export default function GodownsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, queuedItems, updateQueuedItem, discardQueuedItem } = useOffline();
  const [godowns, setGodowns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", cityId: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [openActionId, setOpenActionId] = useState<number | null>(null);

  const getPendingQueueId = useCallback((id: any) => {
    const str = String(id || "");
    if (!str.startsWith("pending-")) return null;
    return str.replace("pending-", "");
  }, []);

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<GodownsReadSnapshot>(GODOWNS_READ_CACHE_KEY);
  }, []);

  const mergeSnapshot = useCallback((partial: Partial<GodownsReadSnapshot>) => {
    const existing = readSnapshot()?.data || { godowns: [], cities: [] };
    writeOfflineReadSnapshot<GodownsReadSnapshot>(GODOWNS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await apiCall("/api/v1/godowns", { params: { limit: 100, is_active: "true" } });
    if (result.success) {
      let nextRows = [...getPendingGodowns(queuedItems as any), ...((result.data as any[]) || [])];
      nextRows = applyQueuedMutationsToGodowns(nextRows, queuedItems as any[]);
      setGodowns(nextRows);
      mergeSnapshot({ godowns: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.godowns?.length) {
        const cleanedGodowns = pruneStalePendingRows(snapshot.godowns as any[], queuedItems as any[], "/godowns");
        const mergedSnapshotGodowns = applyQueuedMutationsToGodowns(cleanedGodowns, queuedItems as any[]);
        setGodowns(mergedSnapshotGodowns);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot]);
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
    if (user?.role === "super_admin") {
      const cityRes = await apiCall("/api/v1/cities");
      if (cityRes.success) {
        setCities(cityRes.data as any[]);
        mergeSnapshot({ cities: cityRes.data as any[] });
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        const snapshot = readSnapshot()?.data;
        if (snapshot?.cities?.length) {
          setCities(snapshot.cities);
          setShowOfflineSnapshot(true);
        }
      }
    }
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
    const pendingQueueId = getPendingQueueId(selected?.id);
    if (pendingQueueId) {
      const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(form) });
      if (!ok) {
        setFormError("Queued godown entry not found. Retry from Activity.");
        return;
      }
      setGodowns((prev) => {
        const next = prev.map((row: any) => (row.id === selected.id ? { ...row, name: form.name, cityId: form.cityId, _pending: true } : row));
        mergeSnapshot({ godowns: next });
        return next;
      });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    const result = await apiCall(`/api/v1/godowns/${selected.id}`, { method: "PUT", body: { name: form.name } });
    setSubmitting(false);
    if (result.success) { setShowEdit(false); load(); } else { setFormError(result.error || "Failed"); }
  };
  const handleDeactivate = async (g: any) => {
    if (!confirm(`"${g.name}": ${t("confirm_deactivate_godown")}`)) return;
    const pendingQueueId = getPendingQueueId(g?.id);
    if (pendingQueueId) {
      await discardQueuedItem(pendingQueueId);
      setGodowns((prev) => {
        const next = prev.filter((row: any) => row.id !== g.id);
        mergeSnapshot({ godowns: next });
        return next;
      });
      return;
    }
    await apiCall(`/api/v1/godowns/${g.id}`, { method: "PUT", body: { isActive: false } });
    load();
  };
  const handleDeleteGodown = async (g: any) => {
    if (!confirm(`"${g.name}": ${t("confirm_delete_godown")}`)) return;
    const pendingQueueId = getPendingQueueId(g?.id);
    if (pendingQueueId) {
      await discardQueuedItem(pendingQueueId);
      setGodowns((prev) => {
        const next = prev.filter((row: any) => row.id !== g.id);
        mergeSnapshot({ godowns: next });
        return next;
      });
      return;
    }
    const r = await apiCall(`/api/v1/godowns/${g.id}`, { method: "DELETE" });
    if (r.success) load(); else alert(r.error || "Cannot delete - godown may have stock");
  };

  return (
    <div>
      <PageHeader title={t("godowns")} subtitle={`${godowns.length} ${t("godowns").toLowerCase()}`} action={<button onClick={openCreate} className="btn-primary text-sm">+ {t("new_godown")}</button>} />
      {showOfflineSnapshot && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}
      <DataTable columns={[
        { key: "name", label: t("godown_name"), render: (g: any) => <span className="font-medium">{g.name}</span> },
        { key: "cityName", label: t("city") },
        { key: "countryName", label: t("country") },
        { key: "isActive", label: t("status"), render: (g: any) => <span className={g.isActive ? "badge-active" : "badge-cancelled"}>{g.isActive ? t("active") : t("inactive")}</span> },
        { key: "actions", label: "", render: (g: any) => (
          <RowActionMenu
            open={openActionId === g.id}
            onOpenChange={(open) => setOpenActionId(open ? g.id : null)}
          >
            <button onClick={() => { setOpenActionId(null); openEdit(g); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">{t("edit")}</button>
            {g.isActive ? (
              <button onClick={() => { setOpenActionId(null); handleDeactivate(g); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("deactivate")}</button>
            ) : (
              <button onClick={() => { setOpenActionId(null); handleDeleteGodown(g); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">{t("delete")}</button>
            )}
          </RowActionMenu>
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
