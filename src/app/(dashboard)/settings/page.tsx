"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";

type Tab = "users" | "products" | "cities" | "sessions" | "godown_access";

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("users");
  if (user?.role !== "super_admin") return <div><PageHeader title={t("settings")} /><div className="card text-center py-12 text-gray-400">{t("super_admin_only")}</div></div>;

  const tabLabels: Record<Tab, string> = {
    users: t("users"),
    products: t("products"),
    cities: t("cities"),
    sessions: t("sessions"),
    godown_access: `🏭 ${t("godown_access")}`,
  };

  return (
    <div>
      <PageHeader title={t("settings")} subtitle={t("settings_subtitle")} />
      <div className="flex flex-wrap gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(["users", "products", "cities", "sessions", "godown_access"] as Tab[]).map((tb) => (
          <button key={tb} onClick={() => setTab(tb)} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === tb ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>{tabLabels[tb]}</button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "cities" && <CitiesTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "godown_access" && <GodownAccessTab />}
    </div>
  );
}

function UsersTab() {
  const { user } = useAuth();
  const { t } = useLang();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [form, setForm] = useState({ username: "", password: "", fullName: "", role: "city_admin", cityId: 0 });
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = async () => { setLoading(true); const r = await apiCall("/api/v1/users", { params: { limit: 100 } }); if (r.success) setUsers(r.data as any[]); setLoading(false); };
  useEffect(() => { load(); }, []);

  const openCreate = async () => { const c = await apiCall("/api/v1/cities"); if (c.success) setCities(c.data as any[]); setForm({ username: "", password: "", fullName: "", role: "city_admin", cityId: 0 }); setShowCreate(true); setError(""); };
  const handleCreate = async () => {
    if (!form.username || !form.password || !form.fullName) { setError("Fill all fields"); return; }
    if (form.role === "city_admin" && !form.cityId) { setError("Select a city for city admin"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/users", { method: "POST", body: { ...form, cityId: form.role === "city_admin" ? form.cityId : null } });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (u: any) => { setSelected(u); setForm({ ...form, fullName: u.fullName, role: u.role, cityId: u.cityId || 0, username: u.username, password: "" }); setShowEdit(true); setError(""); };
  const handleEdit = async () => {
    setSubmitting(true);
    const r = await apiCall(`/api/v1/users/${selected.id}`, { method: "PUT", body: { fullName: form.fullName, isActive: true } });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openResetPw = (u: any) => { setSelected(u); setNewPassword(""); setShowResetPw(true); setError(""); };
  const handleResetPw = async () => {
    if (!newPassword || newPassword.length < 8) { setError("Min 8 characters required"); return; }
    if (!/[A-Z]/.test(newPassword)) { setError("Must include at least one uppercase letter"); return; }
    if (!/[a-z]/.test(newPassword)) { setError("Must include at least one lowercase letter"); return; }
    if (!/[0-9]/.test(newPassword)) { setError("Must include at least one number"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/auth/reset-password", { method: "PUT", body: { userId: selected.id, newPassword } });
    setSubmitting(false);
    if (r.success) { setShowResetPw(false); alert("Password reset!"); } else { setError(r.error || "Failed"); }
  };

  const toggleActive = async (u: any) => {
    if (u.id === user?.id) {
      setError("You cannot deactivate your own account");
      return;
    }
    if (!confirm(`${u.isActive ? t("deactivate") : t("activate")} ${u.fullName}?`)) return;
    const result = await apiCall(`/api/v1/users/${u.id}`, { method: "PUT", body: { isActive: !u.isActive } });
    if (!result.success) setError(result.error || "Failed");
    load();
  };

  return (
    <>
      <div className="flex justify-end mb-4"><button onClick={openCreate} className="btn-primary text-sm">+ {t("new_user")}</button></div>
      <DataTable columns={[
        { key: "fullName", label: t("name"), render: (u: any) => <span className="font-medium">{u.fullName}</span> },
        { key: "username", label: t("username") },
        { key: "role", label: t("role"), render: (u: any) => <span className={`text-xs font-medium px-2 py-0.5 rounded ${u.role === "super_admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{u.role === "super_admin" ? t("super_admin") : t("city_admin")}</span> },
        { key: "cityName", label: t("city"), render: (u: any) => u.cityName || t("all") },
        { key: "isActive", label: t("status"), render: (u: any) => <span className={u.isActive ? "badge-active" : "badge-cancelled"}>{u.isActive ? t("active") : t("inactive")}</span> },
        { key: "actions", label: "", render: (u: any) => (
          <div className="flex gap-2">
            <button onClick={() => openEdit(u)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
            <button onClick={() => openResetPw(u)} className="text-xs text-yellow-600 hover:underline">{t("reset_pw")}</button>
            {u.id === user?.id ? (
              <span className="text-xs text-gray-400 cursor-not-allowed">Current account</span>
            ) : (
              <button onClick={() => toggleActive(u)} className="text-xs text-red-600 hover:underline">{u.isActive ? t("deactivate") : t("activate")}</button>
            )}
          </div>
        )},
      ]} data={users} loading={loading} />

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_user")} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("full_name")} *</label><input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("username")} *</label><input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("password")} *</label><input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="input-field" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("role")}</label><select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="select-field"><option value="city_admin">{t("city_admin")}</option><option value="super_admin">{t("super_admin")}</option></select></div>
          {form.role === "city_admin" && <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">{t("city")} *</label><select value={form.cityId} onChange={(e) => setForm((f) => ({ ...f, cityId: parseInt(e.target.value) }))} className="select-field"><option value={0}>Select</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.countryName})</option>)}</select></div>}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.fullName || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("full_name")}</label><input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      <Modal open={showResetPw} onClose={() => setShowResetPw(false)} title={`${t("reset_password")}: ${selected?.fullName || ""}`} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <p className="text-sm text-gray-500 mb-3">{t("username")}: <strong>{selected?.username}</strong></p>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("password")} *</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input-field" placeholder="Min 8 chars, upper + lower + number" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={() => setShowResetPw(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleResetPw} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("reset_password")}</button></div>
      </Modal>
    </>
  );
}

function ProductsTab() {
  const { t } = useLang();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = async () => { setLoading(true); const r = await apiCall("/api/v1/products", { params: { limit: 100 } }); if (r.success) setProducts(r.data as any[]); setLoading(false); };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => { if (!name.trim()) return; setSubmitting(true); const r = await apiCall("/api/v1/products", { method: "POST", body: { name } }); setSubmitting(false); if (r.success) { setShowCreate(false); setName(""); load(); } };
  const openEdit = (p: any) => { setSelected(p); setName(p.name); setShowEdit(true); };
  const handleEdit = async () => { setSubmitting(true); await apiCall(`/api/v1/products/${selected.id}`, { method: "PUT", body: { name } }); setSubmitting(false); setShowEdit(false); load(); };
  const handleDelete = async (p: any) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    setDeleteError("");
    const r = await apiCall(`/api/v1/products/${p.id}`, { method: "DELETE" });
    if (r.success) { load(); } else { setDeleteError(r.error || "Could not delete product."); }
  };
  const handleToggleActive = async (p: any) => {
    await apiCall(`/api/v1/products/${p.id}`, { method: "PUT", body: { isActive: !p.isActive } });
    load();
  };

  return (
    <>
      <div className="flex justify-end mb-4"><button onClick={() => { setName(""); setShowCreate(true); }} className="btn-primary text-sm">+ {t("new_product")}</button></div>
      {deleteError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
          <span className="mt-0.5">⚠️</span>
          <div>
            <strong>{t("cannot_delete_product")}</strong>
            <p className="mt-0.5">{deleteError}</p>
          </div>
          <button onClick={() => setDeleteError("")} className="ml-auto text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}
      <DataTable columns={[
        { key: "name", label: t("name"), render: (p: any) => <span className="font-medium">{p.name}</span> },
        { key: "isActive", label: t("status"), render: (p: any) => <span className={p.isActive ? "badge-active" : "badge-cancelled"}>{p.isActive ? t("active") : t("inactive")}</span> },
        { key: "actions", label: "", render: (p: any) => (
          <div className="flex gap-2">
            <button onClick={() => openEdit(p)} className="text-xs text-primary-600 hover:underline">{t("edit")}</button>
            <button onClick={() => handleToggleActive(p)} className="text-xs text-yellow-600 hover:underline">{p.isActive ? t("deactivate") : t("activate")}</button>
            <button onClick={() => handleDelete(p)} className="text-xs text-red-600 hover:underline">{t("delete")}</button>
          </div>
        )},
      ]} data={products} loading={loading} />
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("new_product")} size="sm">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")} *</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4"><button onClick={() => setShowCreate(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.name || ""}`} size="sm">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")}</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4"><button onClick={() => setShowEdit(false)} className="btn-secondary text-sm">{t("cancel")}</button><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </>
  );
}

function CitiesTab() {
  const { t } = useLang();
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { const l = async () => { setLoading(true); const r = await apiCall("/api/v1/cities"); if (r.success) setCities(r.data as any[]); setLoading(false); }; l(); }, []);
  return <DataTable columns={[
    { key: "name", label: t("city"), render: (c: any) => <span className="font-medium">{c.name}</span> },
    { key: "countryName", label: t("country") },
    { key: "currencies", label: t("currencies"), render: (c: any) => c.currencies?.map((cur: any) => cur.code).join(", ") },
    { key: "godownsCount", label: t("godowns") },
    { key: "customersCount", label: t("customers") },
    { key: "usersCount", label: t("users") },
  ]} data={cities} loading={loading} />;
}

function GodownAccessTab() {
  const { t } = useLang();
  const [cities, setCities] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<{ fromCityId: number; toCityId: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/godown-permissions");
    if (r.success) {
      const d = r.data as any;
      setCities(d.cities || []);
      setPermissions(d.permissions || []);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const hasPermission = (fromId: number, toId: number) =>
    permissions.some((p) => p.fromCityId === fromId && p.toCityId === toId);

  const toggle = async (fromId: number, toId: number) => {
    if (fromId === toId) return;
    setSubmitting(true);
    if (hasPermission(fromId, toId)) {
      await apiCall("/api/v1/godown-permissions", { method: "DELETE", body: { fromCityId: fromId, toCityId: toId } });
    } else {
      await apiCall("/api/v1/godown-permissions", { method: "POST", body: { fromCityId: fromId, toCityId: toId } });
    }
    await load();
    setSubmitting(false);
  };

  const countries = Array.from(new Set(cities.map((c) => c.country)));

  if (loading) return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">{t("cross_city_access")}</h3>
        <p className="text-sm text-gray-500">
          Check a box to allow a city admin to use godowns from another city when recording sales.
          Each row is a city — checked columns are the cities whose godowns they can access.
        </p>
      </div>

      {countries.map((country) => {
        const countryCities = cities.filter((c) => c.country === country);
        return (
          <div key={country as string} className="card mb-4">
            <h4 className="text-sm font-semibold text-gray-500 mb-3">🌍 {country as string}</h4>
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead>
                  <tr>
                    <th className="text-left py-2 pr-4 text-gray-500 font-medium whitespace-nowrap">Admin of →<br/><span className="font-normal text-xs">Can use godowns from ↓</span></th>
                    {countryCities.map((c) => (
                      <th key={c.id} className="px-3 py-2 text-center text-gray-700 font-medium whitespace-nowrap">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {countryCities.map((fromCity) => (
                    <tr key={fromCity.id} className="border-t border-gray-100">
                      <td className="py-2 pr-4 font-medium text-gray-800 whitespace-nowrap">{fromCity.name}</td>
                      {countryCities.map((toCity) => (
                        <td key={toCity.id} className="px-3 py-2 text-center">
                          {fromCity.id === toCity.id ? (
                            <span className="text-gray-300 text-lg">—</span>
                          ) : (
                            <input
                              type="checkbox"
                              disabled={submitting}
                              checked={hasPermission(fromCity.id, toCity.id)}
                              onChange={() => toggle(fromCity.id, toCity.id)}
                              className="w-4 h-4 accent-primary-600 cursor-pointer"
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function SessionsTab() {
  const { t } = useLang();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/sessions");
    if (r.success) setSessions(r.data as any[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const revokeSession = async (id: string) => {
    if (!confirm("Revoke this session? The user will be logged out on that device.")) return;
    setRevoking(id);
    const r = await apiCall(`/api/v1/sessions/${id}`, { method: "DELETE" });
    setRevoking(null);
    if (r.success) load();
  };

  const revokeAllOthers = async () => {
    if (!confirm("Revoke all other sessions? This will log you out everywhere except here.")) return;
    setRevoking("all");
    const r = await apiCall("/api/v1/sessions/revoke-others", { method: "POST" });
    setRevoking(null);
    if (r.success) load();
  };

  if (loading) return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{sessions.length} {t("active_sessions")}</p>
        {sessions.length > 1 && (
          <button onClick={revokeAllOthers} disabled={revoking === "all"} className="text-sm text-red-600 hover:text-red-700 font-medium">
            {revoking === "all" ? t("revoking") : t("revoke_all")}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {sessions.length === 0 ? (
          <div className="card text-center py-12 text-gray-400">{t("no_sessions")}</div>
        ) : (
          sessions.map((s: any) => (
            <div key={s.id} className={`bg-white rounded-lg border px-4 py-3 flex items-center gap-4 ${s.isCurrent ? "border-primary-300 bg-primary-50/30" : "border-gray-100"}`}>
              <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-lg flex-shrink-0">
                {s.deviceInfo?.includes("Mobile") || s.deviceInfo?.includes("Android") || s.deviceInfo?.includes("iOS") ? "📱" : "💻"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-gray-900">{s.deviceInfo || "Unknown device"}</span>
                  {s.isCurrent && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                      {t("current")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                  <span>IP: {s.ipAddress || "unknown"}</span>
                  <span>Active {timeAgo(s.lastActiveAt)}</span>
                  <span>Logged in {timeAgo(s.createdAt)}</span>
                </div>
              </div>
              {!s.isCurrent && (
                <button onClick={() => revokeSession(s.id)} disabled={revoking === s.id} className="text-xs text-red-600 hover:text-red-700 font-medium flex-shrink-0">
                  {revoking === s.id ? t("revoking") : t("revoke")}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
