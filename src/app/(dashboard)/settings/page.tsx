"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { PageHeader, DataTable, Modal } from "@/components/ui";
import { useLang } from "@/lib/lang";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingProducts, getPendingUsers } from "@/lib/offline-queue-overlays";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";

type Tab = "users" | "products" | "cities" | "sessions" | "godown_access";

const SETTINGS_USERS_READ_CACHE_KEY = "mrf-settings-users-read-cache-v1";
const SETTINGS_PRODUCTS_READ_CACHE_KEY = "mrf-settings-products-read-cache-v1";
const SETTINGS_CITIES_READ_CACHE_KEY = "mrf-settings-cities-read-cache-v1";
const SETTINGS_GODOWN_ACCESS_READ_CACHE_KEY = "mrf-settings-godown-access-read-cache-v1";
const SETTINGS_SESSIONS_READ_CACHE_KEY = "mrf-settings-sessions-read-cache-v1";

type SettingsUsersReadSnapshot = {
  users: any[];
  cities: any[];
};

type SettingsProductsReadSnapshot = {
  products: any[];
};

function applyQueuedMutationsToUsers(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/users/")) continue;
    const match = url.match(/^\/api\/v1\/users\/([^/?#]+)/);
    const userId = match?.[1];
    if (!userId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== userId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === userId
        ? {
            ...row,
            fullName: patch?.fullName ?? row?.fullName,
            isActive: typeof patch?.isActive === "boolean" ? patch.isActive : row?.isActive,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

function applyQueuedMutationsToProducts(baseRows: any[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/products/")) continue;
    const match = url.match(/^\/api\/v1\/products\/([^/?#]+)/);
    const productId = match?.[1];
    if (!productId) continue;
    if (method === "DELETE") {
      next = next.filter((row: any) => String(row?.id || "") !== productId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row: any) =>
      String(row?.id || "") === productId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            isActive: typeof patch?.isActive === "boolean" ? patch.isActive : row?.isActive,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

type SettingsCitiesReadSnapshot = {
  cities: any[];
};

type SettingsGodownAccessReadSnapshot = {
  cities: any[];
  permissions: { fromCityId: number; toCityId: number }[];
  specificPermissions: { fromCityId: number; toGodownId: number }[];
  godowns: { id: number; name: string; cityId: number; cityName: string; country: string }[];
};

type SettingsSessionsReadSnapshot = {
  sessions: any[];
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("users");
  if (user?.role === "city_admin") return <CityAdminSettingsCard />;
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
      <PageHeader title={t("settings")} />
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

function CityAdminSettingsCard() {
  const { user } = useAuth();
  const { t } = useLang();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const resetPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError("");
  };

  const closeChangePassword = () => {
    setShowChangePassword(false);
    resetPasswordForm();
  };

  const handleChangePassword = async () => {
    setError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All password fields are required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password must match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError("New password must include uppercase, lowercase, and number.");
      return;
    }

    setSubmitting(true);
    const result = await apiCall("/api/v1/auth/change-password", {
      method: "PUT",
      body: { currentPassword, newPassword },
    });
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Failed to update password.");
      return;
    }

    closeChangePassword();
    setSuccess("Password changed successfully.");
  };

  return (
    <div>
      <PageHeader title={t("settings")} />
      {success && (
        <div className="mb-4 max-w-2xl rounded border border-green-200 bg-green-50 p-2 text-sm text-green-700">{success}</div>
      )}
      <div className="card max-w-2xl">
        <h2 className="text-lg font-semibold text-gray-900">Account</h2>
        <p className="mt-1 text-sm text-gray-500">Manage your city admin login credentials.</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-gray-500">{t("full_name")}</dt>
            <dd className="font-medium text-gray-900">{user?.fullName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-gray-500">{t("username")}</dt>
            <dd className="font-medium text-gray-900">{user?.username}</dd>
          </div>
          {user?.cityName && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-gray-500">{t("city")}</dt>
              <dd className="font-medium text-gray-900">{user.cityName}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4 border-t pt-4">
          <button type="button" onClick={() => { resetPasswordForm(); setShowChangePassword(true); }} className="btn-primary text-sm">
            Change Password
          </button>
        </div>
      </div>

      <Modal open={showChangePassword} onClose={closeChangePassword} title="Change Password" size="sm">
        <p className="mb-4 text-sm text-gray-500">Update your login password for this city admin account.</p>
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Current Password *</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-field pr-20"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                {showCurrentPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">New Password *</label>
            <div className="relative">
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-field pr-20"
                placeholder="Min 8 chars, upper + lower + number"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                {showNewPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Confirm New Password *</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field pr-20"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button type="button" onClick={closeChangePassword} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={handleChangePassword} disabled={submitting} className="btn-primary text-sm">
            {submitting ? "..." : "Update Password"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function UsersTab() {
  const { user } = useAuth();
  const { t } = useLang();
  const { isOnline, queuedItems } = useOffline();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showResetPw, setShowResetPw] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [cities, setCities] = useState<any[]>([]);
  const [form, setForm] = useState({ username: "", password: "", fullName: "", role: "city_admin", cityId: 0 });
  const [newPassword, setNewPassword] = useState("");
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const getPendingQueueId = (id: unknown) => {
    const str = String(id || "");
    if (!str.startsWith("pending-")) return null;
    return str.replace("pending-", "");
  };

  const readSnapshot = useCallback(
    () => readOfflineReadSnapshot<SettingsUsersReadSnapshot>(SETTINGS_USERS_READ_CACHE_KEY),
    []
  );
  const mergeSnapshot = useCallback((partial: Partial<SettingsUsersReadSnapshot>) => {
    const existing = readSnapshot()?.data || { users: [], cities: [] };
    writeOfflineReadSnapshot<SettingsUsersReadSnapshot>(SETTINGS_USERS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/users", { params: { limit: 100 } });
    if (r.success) {
      let nextRows = [...getPendingUsers(queuedItems as any), ...((r.data as any[]) || [])];
      nextRows = applyQueuedMutationsToUsers(nextRows, queuedItems as any[]);
      setUsers(nextRows);
      mergeSnapshot({ users: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.users?.length) {
        const cleanedUsers = pruneStalePendingRows(snapshot.users as any[], queuedItems as any[], "/users");
        const mergedSnapshotUsers = applyQueuedMutationsToUsers(cleanedUsers, queuedItems as any[]);
        setUsers(mergedSnapshotUsers);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot]);
  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    const c = await apiCall("/api/v1/cities");
    if (c.success) {
      setCities(c.data as any[]);
      mergeSnapshot({ cities: c.data as any[] });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.cities?.length) {
        setCities(snapshot.cities);
        setShowOfflineSnapshot(true);
      }
    }
    setForm({ username: "", password: "", fullName: "", role: "city_admin", cityId: 0 });
    setShowCreate(true);
    setShowCreatePassword(false);
    setError("");
  };
  const handleCreate = async () => {
    if (!form.username || !form.password || !form.fullName) { setError("Fill all fields"); return; }
    if (form.role === "city_admin" && !form.cityId) { setError("Select a city for city admin"); return; }
    setSubmitting(true);
    const r = await apiCall("/api/v1/users", { method: "POST", body: { ...form, cityId: form.role === "city_admin" ? form.cityId : null } });
    setSubmitting(false);
    if (r.success) { setShowCreate(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openEdit = (u: any) => {
    if (getPendingQueueId(u?.id)) { setError("Pending user is not synced yet. Please sync first."); return; }
    setSelected(u);
    setForm({ ...form, fullName: u.fullName, role: u.role, cityId: u.cityId || 0, username: u.username, password: "" });
    setShowEdit(true);
    setError("");
  };
  const handleEdit = async () => {
    setSubmitting(true);
    const r = await apiCall(`/api/v1/users/${selected.id}`, { method: "PUT", body: { fullName: form.fullName, isActive: true } });
    setSubmitting(false);
    if (r.success) { setShowEdit(false); load(); } else { setError(r.error || "Failed"); }
  };

  const openResetPw = (u: any) => {
    if (getPendingQueueId(u?.id)) { setError("Pending user is not synced yet. Please sync first."); return; }
    setSelected(u);
    setNewPassword("");
    setShowResetPassword(false);
    setShowResetPw(true);
    setError("");
  };
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
    if (getPendingQueueId(u?.id)) {
      setError("Pending user is not synced yet. Please sync first.");
      return;
    }
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
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached users/settings data for this device.
        </div>
      )}
      <div className="flex justify-end mb-4"><button onClick={openCreate} className="btn-primary text-sm">+ {t("new_user")}</button></div>
      <DataTable columns={[
        { key: "fullName", label: t("name"), render: (u: any) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{u.fullName}</span>
          </div>
        ) },
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("password")} *</label>
            <div className="relative">
              <input
                type={form.role === "city_admin" && showCreatePassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="input-field pr-20"
              />
              {form.role === "city_admin" && (
                <button
                  type="button"
                  onClick={() => setShowCreatePassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                >
                  {showCreatePassword ? "Hide" : "Show"}
                </button>
              )}
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("role")}</label><select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="select-field"><option value="city_admin">{t("city_admin")}</option><option value="super_admin">{t("super_admin")}</option></select></div>
          {form.role === "city_admin" && <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">{t("city")} *</label><select value={form.cityId} onChange={(e) => setForm((f) => ({ ...f, cityId: parseInt(e.target.value) }))} className="select-field"><option value={0}>Select</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.countryName})</option>)}</select></div>}
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.fullName || ""}`} size="md">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("full_name")}</label><input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className="input-field" /></div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>

      <Modal open={showResetPw} onClose={() => setShowResetPw(false)} title={`${t("reset_password")}: ${selected?.fullName || ""}`} size="sm">
        {error && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
        <p className="text-sm text-gray-500 mb-3">{t("username")}: <strong>{selected?.username}</strong></p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t("password")} *</label>
          <div className="relative">
            <input
              type={selected?.role === "city_admin" && showResetPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input-field pr-20"
              placeholder="Min 8 chars, upper + lower + number"
            />
            {selected?.role === "city_admin" && (
              <button
                type="button"
                onClick={() => setShowResetPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                {showResetPassword ? "Hide" : "Show"}
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t"><button onClick={handleResetPw} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("reset_password")}</button></div>
      </Modal>
    </>
  );
}

function ProductsTab() {
  const { t } = useLang();
  const { isOnline, queuedItems, updateQueuedItem, discardQueuedItem } = useOffline();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [name, setName] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState<"MT" | "PCS">("MT");
  const [defaultWeightPerCartonKg, setDefaultWeightPerCartonKg] = useState("");
  const [packetMode, setPacketMode] = useState<"nil" | "packets">("nil");
  const [packetsPerCarton, setPacketsPerCarton] = useState("");
  const [piecesPerCarton, setPiecesPerCarton] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const getPendingQueueId = (id: unknown) => {
    const str = String(id || "");
    if (!str.startsWith("pending-")) return null;
    return str.replace("pending-", "");
  };
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const readSnapshot = useCallback(
    () => readOfflineReadSnapshot<SettingsProductsReadSnapshot>(SETTINGS_PRODUCTS_READ_CACHE_KEY),
    []
  );
  const mergeSnapshot = useCallback((partial: Partial<SettingsProductsReadSnapshot>) => {
    const existing = readSnapshot()?.data || { products: [] };
    writeOfflineReadSnapshot<SettingsProductsReadSnapshot>(SETTINGS_PRODUCTS_READ_CACHE_KEY, {
      ...existing,
      ...partial,
    });
  }, [readSnapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/products", { params: { limit: 100 } });
    if (r.success) {
      let nextRows = [...getPendingProducts(queuedItems as any), ...((r.data as any[]) || [])];
      nextRows = applyQueuedMutationsToProducts(nextRows, queuedItems as any[]);
      setProducts(nextRows);
      mergeSnapshot({ products: nextRows });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.products?.length) {
        const cleanedProducts = pruneStalePendingRows(snapshot.products as any[], queuedItems as any[], "/products");
        const mergedSnapshotProducts = applyQueuedMutationsToProducts(cleanedProducts, queuedItems as any[]);
        setProducts(mergedSnapshotProducts);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, mergeSnapshot, queuedItems, readSnapshot]);
  useEffect(() => { load(); }, [load]);

  const productPayload = () => ({
    name,
    unitOfMeasure,
    defaultWeightPerCartonKg: unitOfMeasure === "MT" ? Number(defaultWeightPerCartonKg) : null,
    packetsPerCarton: unitOfMeasure === "MT" && packetMode === "packets" ? Number(packetsPerCarton) : null,
    piecesPerCarton: unitOfMeasure === "PCS" ? Number(piecesPerCarton) : null,
  });
  const resetProductForm = () => { setName(""); setUnitOfMeasure("MT"); setDefaultWeightPerCartonKg(""); setPacketMode("nil"); setPacketsPerCarton(""); setPiecesPerCarton(""); };
  const handleCreate = async () => { if (!name.trim()) return; setSubmitting(true); const r = await apiCall("/api/v1/products", { method: "POST", body: productPayload() }); setSubmitting(false); if (r.success) { setShowCreate(false); resetProductForm(); load(); } };
  const openEdit = (p: any) => { setSelected(p); setName(p.name); setUnitOfMeasure(p.unitOfMeasure || "MT"); setDefaultWeightPerCartonKg(p.defaultWeightPerCartonKg ? String(p.defaultWeightPerCartonKg) : ""); setPacketMode(p.packetsPerCarton ? "packets" : "nil"); setPacketsPerCarton(p.packetsPerCarton ? String(p.packetsPerCarton) : ""); setPiecesPerCarton(p.piecesPerCarton ? String(p.piecesPerCarton) : ""); setShowEdit(true); };
  const handleEdit = async () => {
    const pendingQueueId = getPendingQueueId(selected?.id);
    if (pendingQueueId) {
      const ok = await updateQueuedItem(pendingQueueId, { body: JSON.stringify(productPayload()) });
      if (!ok) return;
      setProducts((prev) => {
        const next = prev.map((row: any) => (row.id === selected.id ? { ...row, ...productPayload(), _pending: true } : row));
        mergeSnapshot({ products: next });
        return next;
      });
      setShowEdit(false);
      return;
    }
    setSubmitting(true);
    await apiCall(`/api/v1/products/${selected.id}`, { method: "PUT", body: productPayload() });
    setSubmitting(false);
    setShowEdit(false);
    load();
  };
  const handleDelete = async (p: any) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const pendingQueueId = getPendingQueueId(p?.id);
    if (pendingQueueId) {
      const ok = await discardQueuedItem(pendingQueueId);
      if (!ok) return;
      setProducts((prev) => {
        const next = prev.filter((row: any) => row.id !== p.id);
        mergeSnapshot({ products: next });
        return next;
      });
      return;
    }
    setDeleteError("");
    const r = await apiCall(`/api/v1/products/${p.id}`, { method: "DELETE" });
    if (r.success) { load(); } else { setDeleteError(r.error || "Could not delete product."); }
  };
  const handleToggleActive = async (p: any) => {
    const pendingQueueId = getPendingQueueId(p?.id);
    if (pendingQueueId) {
      if (p.isActive) {
        const ok = await discardQueuedItem(pendingQueueId);
        if (!ok) return;
        setProducts((prev) => {
          const next = prev.filter((row: any) => row.id !== p.id);
          mergeSnapshot({ products: next });
          return next;
        });
      }
      return;
    }
    await apiCall(`/api/v1/products/${p.id}`, { method: "PUT", body: { isActive: !p.isActive } });
    load();
  };

  return (
    <>
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached products data for this device.
        </div>
      )}
      <div className="flex justify-end mb-4"><button onClick={() => { resetProductForm(); setShowCreate(true); }} className="btn-primary text-sm">+ {t("new_product")}</button></div>
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
        { key: "unitOfMeasure", label: "Unit", render: (p: any) => <span>{p.unitOfMeasure || "MT"}</span> },
        { key: "defaultWeightPerCartonKg", label: "WT/CRT (KG)", render: (p: any) => <span>{p.unitOfMeasure === "MT" ? p.defaultWeightPerCartonKg || "—" : "—"}</span> },
        { key: "packetsPerCarton", label: "Packets/CTN", render: (p: any) => <span>{p.unitOfMeasure === "MT" ? p.packetsPerCarton || "Nil" : "—"}</span> },
        { key: "piecesPerCarton", label: "PCS/CTN", render: (p: any) => <span>{p.unitOfMeasure === "PCS" ? p.piecesPerCarton : "—"}</span> },
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
        <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label><select value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value as "MT" | "PCS")} className="select-field"><option value="MT">MT</option><option value="PCS">PCS</option></select></div>
        {unitOfMeasure === "MT" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">WT/CRT (KG) *</label><input type="number" value={defaultWeightPerCartonKg} onChange={(e) => setDefaultWeightPerCartonKg(e.target.value)} className="input-field" min="0.001" step="0.001" /></div>}
        {unitOfMeasure === "MT" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">Packets</label><select value={packetMode} onChange={(e) => setPacketMode(e.target.value as "nil" | "packets")} className="select-field"><option value="nil">Nil</option><option value="packets">Has packets</option></select></div>}
        {unitOfMeasure === "MT" && packetMode === "packets" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">Packets/CTN *</label><input type="number" value={packetsPerCarton} onChange={(e) => setPacketsPerCarton(e.target.value)} className="input-field" min="1" step="1" /></div>}
        {unitOfMeasure === "PCS" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">PCS/CTN *</label><input type="number" value={piecesPerCarton} onChange={(e) => setPiecesPerCarton(e.target.value)} className="input-field" min="1" step="1" /></div>}
        <div className="flex justify-end gap-3 pt-4 mt-4"><button onClick={handleCreate} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("create")}</button></div>
      </Modal>
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`${t("edit")}: ${selected?.name || ""}`} size="sm">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">{t("name")}</label><input value={name} onChange={(e) => setName(e.target.value)} className="input-field" /></div>
        <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">Unit</label><select value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value as "MT" | "PCS")} className="select-field"><option value="MT">MT</option><option value="PCS">PCS</option></select></div>
        {unitOfMeasure === "MT" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">WT/CRT (KG) *</label><input type="number" value={defaultWeightPerCartonKg} onChange={(e) => setDefaultWeightPerCartonKg(e.target.value)} className="input-field" min="0.001" step="0.001" /></div>}
        {unitOfMeasure === "MT" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">Packets</label><select value={packetMode} onChange={(e) => setPacketMode(e.target.value as "nil" | "packets")} className="select-field"><option value="nil">Nil</option><option value="packets">Has packets</option></select></div>}
        {unitOfMeasure === "MT" && packetMode === "packets" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">Packets/CTN *</label><input type="number" value={packetsPerCarton} onChange={(e) => setPacketsPerCarton(e.target.value)} className="input-field" min="1" step="1" /></div>}
        {unitOfMeasure === "PCS" && <div className="mt-3"><label className="block text-sm font-medium text-gray-700 mb-1">PCS/CTN *</label><input type="number" value={piecesPerCarton} onChange={(e) => setPiecesPerCarton(e.target.value)} className="input-field" min="1" step="1" /></div>}
        <div className="flex justify-end gap-3 pt-4 mt-4"><button onClick={handleEdit} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : t("save")}</button></div>
      </Modal>
    </>
  );
}

function CitiesTab() {
  const { t } = useLang();
  const { isOnline } = useOffline();
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  useEffect(() => {
    const l = async () => {
      setLoading(true);
      const r = await apiCall("/api/v1/cities");
      if (r.success) {
        setCities(r.data as any[]);
        writeOfflineReadSnapshot<SettingsCitiesReadSnapshot>(SETTINGS_CITIES_READ_CACHE_KEY, {
          cities: r.data as any[],
        });
        setShowOfflineSnapshot(false);
      } else if (!isOnline) {
        const snapshot = readOfflineReadSnapshot<SettingsCitiesReadSnapshot>(SETTINGS_CITIES_READ_CACHE_KEY)?.data;
        if (snapshot?.cities?.length) {
          setCities(snapshot.cities);
          setShowOfflineSnapshot(true);
        }
      }
      setLoading(false);
    };
    l();
  }, [isOnline]);
  return <>
    {showOfflineSnapshot && (
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        Offline snapshot mode: showing last cached cities data for this device.
      </div>
    )}
    <DataTable columns={[
    { key: "name", label: t("city"), render: (c: any) => <span className="font-medium">{c.name}</span> },
    { key: "countryName", label: t("country") },
    { key: "currencies", label: t("currencies"), render: (c: any) => c.currencies?.map((cur: any) => cur.code).join(", ") },
    { key: "godownsCount", label: t("godowns") },
    { key: "customersCount", label: t("customers") },
    { key: "usersCount", label: t("users") },
  ]} data={cities} loading={loading} />
  </>;
}

function GodownAccessTab() {
  const { t } = useLang();
  const { isOnline } = useOffline();
  const [cities, setCities] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<{ fromCityId: number; toCityId: number }[]>([]);
  const [godowns, setGodowns] = useState<{ id: number; name: string; cityId: number; cityName: string; country: string }[]>([]);
  const [specificPermissions, setSpecificPermissions] = useState<{ fromCityId: number; toGodownId: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/godown-permissions");
    if (r.success) {
      const d = r.data as any;
      setCities(d.cities || []);
      setPermissions(d.permissions || []);
      setGodowns(d.godowns || []);
      setSpecificPermissions(d.specificPermissions || []);
      writeOfflineReadSnapshot<SettingsGodownAccessReadSnapshot>(SETTINGS_GODOWN_ACCESS_READ_CACHE_KEY, {
        cities: d.cities || [],
        permissions: d.permissions || [],
        godowns: d.godowns || [],
        specificPermissions: d.specificPermissions || [],
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<SettingsGodownAccessReadSnapshot>(SETTINGS_GODOWN_ACCESS_READ_CACHE_KEY)?.data;
      if (snapshot?.cities?.length) {
        setCities(snapshot.cities);
        setPermissions(snapshot.permissions || []);
        setGodowns(snapshot.godowns || []);
        setSpecificPermissions(snapshot.specificPermissions || []);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline]);
  useEffect(() => { load(); }, [load]);

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
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached godown access data for this device.
        </div>
      )}
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
  const { isOnline } = useOffline();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiCall("/api/v1/sessions");
    if (r.success) {
      setSessions(r.data as any[]);
      writeOfflineReadSnapshot<SettingsSessionsReadSnapshot>(SETTINGS_SESSIONS_READ_CACHE_KEY, {
        sessions: r.data as any[],
      });
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readOfflineReadSnapshot<SettingsSessionsReadSnapshot>(SETTINGS_SESSIONS_READ_CACHE_KEY)?.data;
      if (snapshot?.sessions?.length) {
        setSessions(snapshot.sessions);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline]);

  useEffect(() => { load(); }, [load]);

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
      {showOfflineSnapshot && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Offline snapshot mode: showing last cached sessions data for this device.
        </div>
      )}
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
