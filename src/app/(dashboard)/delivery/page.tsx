"use client";

/**
 * Delivery — the city admin's view of the loading team.
 *
 * Everything here is scoped to the admin's own city. The browser never talks to
 * the Delivery service directly; it calls this app's /api/v1/delivery routes,
 * which attach the service credential on the server. That is what keeps the
 * credential out of the bundle.
 *
 * This module only ever *observes* deliveries and manages the party's login. The
 * party records what physically arrived from their own app; nothing here changes a
 * sale, a stock figure or a journal entry.
 */

import React, { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/hooks/useApi";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

type Tab = "status" | "party";

interface DeliveryLine {
  saleItemId: number;
  productName: string;
  orderedCartons: number;
  deliveredCartons: number;
}

interface DeliverySaleRow {
  saleId: number;
  voucherNo: string;
  customerName: string;
  cityName: string;
  saleDate: string;
  isAssigned: boolean;
  isCompleted: boolean;
  totalOrderedCartons: number;
  totalDeliveredCartons: number;
  phaseCount: number;
  lastPhaseAt: string | null;
}

interface PartyUser {
  id: number;
  username: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

interface PhaseEvent {
  id: number;
  phaseType: string;
  cartonQty: number;
  reason: string | null;
  note: string | null;
  actorName: string;
  createdAt: string;
}

interface DeliverySnapshot {
  sales: DeliverySaleRow[];
  parties: PartyUser[];
  cityId: number;
}

const PHASE_LABELS: Record<string, string> = {
  loading: "Loading",
  unloading: "Unloading",
  correction: "Correction",
};

export default function DeliveryPage() {
  const [tab, setTab] = useState<Tab>("status");
  const [data, setData] = useState<DeliverySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiCall<DeliverySnapshot>("/api/v1/delivery");
    if (!res.success || !res.data) {
      setError(res.error ?? "Could not load delivery information");
      setData(null);
    } else {
      setData(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeParties = data?.parties.filter((p) => p.isActive).length ?? 0;

  return (
    <div className="module-page">
      <PageHeader
        title="Delivery"
        subtitle={
          data
            ? `${data.sales.length} assigned sale(s) · ${activeParties} active party user(s)`
            : "Loading delivery information…"
        }
      />

      <div className="mb-4 flex gap-2">
        {(["status", "party"] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold transition",
              tab === value
                ? "bg-[#2A0608] text-white shadow-[0_10px_30px_-12px_rgba(42,6,8,0.6)]"
                : "bg-white/60 text-[#52525b] hover:bg-white/80",
            )}
          >
            {value === "status" ? "Delivery status" : "Party users"}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-[1.4rem] border border-red-200 bg-red-50/80 px-5 py-4">
          <p className="text-sm font-semibold text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded-lg bg-red-800 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-[#52525b]">Loading…</p>
      ) : data ? (
        tab === "status" ? (
          <StatusTab data={data} onChanged={load} />
        ) : (
          <PartyTab data={data} onChanged={load} />
        )
      ) : null}
    </div>
  );
}

// ─── Delivery status ──────────────────────────────────────────────────────────

function StatusTab({ data, onChanged }: { data: DeliverySnapshot; onChanged: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  async function unassign(saleId: number) {
    setBusyId(saleId);
    await apiCall("/api/v1/delivery/assignments", { method: "DELETE", body: { saleId } });
    await onChanged();
    setBusyId(null);
  }

  if (data.sales.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-[#52525b]">
          No sales have been assigned to the delivery party yet. Assign a sale from the Sales module to
          start tracking its loading and unloading.
        </p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.sales.map((sale) => {
        const pct =
          sale.totalOrderedCartons > 0
            ? Math.min(100, Math.round((sale.totalDeliveredCartons / sale.totalOrderedCartons) * 100))
            : 0;

        return (
          <Panel key={sale.saleId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-[#2A0608]">
                  {sale.voucherNo} · {sale.customerName}
                </p>
                <p className="mt-0.5 text-xs text-[#52525b]">
                  {sale.cityName} · {new Date(sale.saleDate).toLocaleDateString()}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold",
                  sale.isCompleted
                    ? "bg-emerald-100 text-emerald-800"
                    : pct > 0
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-100 text-slate-700",
                )}
              >
                {sale.isCompleted ? "Completed" : pct > 0 ? `In progress · ${pct}%` : "Not started"}
              </span>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={cn("h-full rounded-full", sale.isCompleted ? "bg-emerald-500" : "bg-[#2A0608]")}
                style={{ width: `${pct}%` }}
              />
            </div>

            <p className="mt-2 text-xs text-[#52525b]">
              {sale.totalDeliveredCartons} of {sale.totalOrderedCartons} cartons · {sale.phaseCount} phase
              record(s)
              {sale.lastPhaseAt ? ` · last ${new Date(sale.lastPhaseAt).toLocaleString()}` : ""}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOpenId(openId === sale.saleId ? null : sale.saleId)}
                className="rounded-lg bg-[#2A0608] px-3 py-1.5 text-xs font-semibold text-white"
              >
                {openId === sale.saleId ? "Hide history" : "View history"}
              </button>
              <button
                type="button"
                disabled={busyId === sale.saleId}
                onClick={() => void unassign(sale.saleId)}
                className="rounded-lg bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#52525b] hover:bg-white"
              >
                {busyId === sale.saleId ? "Working…" : "Unassign"}
              </button>
            </div>

            {openId === sale.saleId ? <PhaseHistory saleId={sale.saleId} /> : null}
          </Panel>
        );
      })}
    </div>
  );
}

function PhaseHistory({ saleId }: { saleId: number }) {
  const [phases, setPhases] = useState<PhaseEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiCall<{ phases: PhaseEvent[] }>("/api/v1/delivery", { params: { sale_id: saleId } }).then((res) => {
      if (!cancelled) setPhases(res.success && res.data ? res.data.phases : []);
    });
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  if (phases === null) return <p className="mt-3 text-xs text-[#52525b]">Loading history…</p>;
  if (phases.length === 0) return <p className="mt-3 text-xs text-[#52525b]">Nothing recorded yet.</p>;

  return (
    <ul className="mt-3 flex flex-col gap-2 border-t border-white/60 pt-3">
      {phases.map((p) => (
        <li key={p.id} className="text-xs">
          <span className="font-bold text-[#2A0608]">{PHASE_LABELS[p.phaseType] ?? p.phaseType}</span>{" "}
          <span className="text-[#52525b]">
            {p.cartonQty > 0 ? `+${p.cartonQty}` : p.cartonQty} cartons · {p.actorName} ·{" "}
            {new Date(p.createdAt).toLocaleString()}
          </span>
          {p.reason ? <span className="ml-1 text-[#b45309]">({p.reason})</span> : null}
          {p.note ? <p className="mt-0.5 text-[#52525b]">{p.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

// ─── Party users ──────────────────────────────────────────────────────────────

function PartyTab({ data, onChanged }: { data: DeliverySnapshot; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  // Password reset: the admin picks the new password, so it is typed rather than
  // generated and shown. Only one row's form is open at a time.
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  function closeReset() {
    setResettingId(null);
    setResetPassword("");
    setResetConfirm("");
  }

  async function submitReset(party: PartyUser) {
    if (busy) return;
    if (resetPassword.length < 10) {
      setFormError("Password must be at least 10 characters");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setFormError("The two passwords do not match");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await apiCall(`/api/v1/delivery/parties/${party.id}/password`, {
      method: "POST",
      body: { newPassword: resetPassword },
    });
    if (!res.success) {
      setFormError(res.error ?? "Could not reset that password");
    } else {
      closeReset();
      await onChanged();
    }
    setBusy(false);
  }

  async function create() {
    if (busy || !fullName.trim() || !username.trim()) return;
    setBusy(true);
    setFormError(null);
    const res = await apiCall<{ username: string; generatedPassword: string | null }>(
      "/api/v1/delivery/parties",
      { method: "POST", body: { fullName: fullName.trim(), username: username.trim().toLowerCase(), phone: phone.trim() || undefined } },
    );
    if (!res.success || !res.data) {
      setFormError(res.error ?? "Could not create that account");
    } else {
      setFullName("");
      setUsername("");
      setPhone("");
      setAdding(false);
      // Shown once and never retrievable again, so surface it immediately.
      setIssued({ username: res.data.username, password: res.data.generatedPassword ?? "" });
      await onChanged();
    }
    setBusy(false);
  }

  async function toggle(party: PartyUser) {
    setBusy(true);
    const res = await apiCall(`/api/v1/delivery/parties/${party.id}`, { method: "PATCH", body: { isActive: !party.isActive } });
    if (res.success) await onChanged();
    else setFormError(res.error ?? "Could not update that account");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {issued ? (
        <Panel className="border-emerald-300 bg-emerald-50/80">
          <p className="text-sm font-bold text-emerald-900">Account created — copy the password now</p>
          <p className="mt-1 text-sm text-emerald-900">
            username <strong>{issued.username}</strong> · password <strong>{issued.password}</strong>
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            It cannot be shown again. Give it to the party member over a safe channel.
          </p>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="mt-2 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Dismiss
          </button>
        </Panel>
      ) : null}

      {formError ? <p className="text-sm font-semibold text-red-700">{formError}</p> : null}

      {data.parties.length === 0 && !adding ? (
        <Panel>
          <p className="text-sm text-[#52525b]">
            No delivery party users for this city yet. Add one so the loading team can sign in and
            record what they deliver.
          </p>
        </Panel>
      ) : null}

      {data.parties.map((party) => (
        <Panel key={party.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-bold text-[#2A0608]">{party.fullName}</p>
              <p className="mt-0.5 text-xs text-[#52525b]">
                @{party.username}
                {party.phone ? ` · ${party.phone}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-[#52525b]">
                {party.lastLoginAt ? `Last signed in ${new Date(party.lastLoginAt).toLocaleString()}` : "Never signed in"}
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-bold",
                party.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700",
              )}
            >
              {party.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void toggle(party)}
              className="rounded-lg bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#52525b] hover:bg-white"
            >
              {party.isActive ? "Deactivate" : "Reactivate"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => (resettingId === party.id ? closeReset() : setResettingId(party.id))}
              className="rounded-lg bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#52525b] hover:bg-white"
            >
              {resettingId === party.id ? "Cancel" : "Reset password"}
            </button>
          </div>

          {resettingId === party.id ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-xs font-bold text-amber-900">Set a new password for @{party.username}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="New password" value={resetPassword} onChange={setResetPassword} type="password" />
                <Field label="Repeat password" value={resetConfirm} onChange={setResetConfirm} type="password" />
              </div>
              <p className="mt-2 text-xs text-amber-900">
                At least 10 characters. Give it to them over a safe channel. They will be signed out
                on every device.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy || resetPassword.length < 10 || resetPassword !== resetConfirm}
                  onClick={() => void submitReset(party)}
                  className="rounded-lg bg-amber-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Set password"}
                </button>
                <button
                  type="button"
                  onClick={closeReset}
                  className="rounded-lg bg-white/70 px-4 py-2 text-xs font-semibold text-[#52525b]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {party.isActive ? null : (
            <p className="mt-2 text-xs text-[#52525b]">
              Sign-in is blocked. Their recorded deliveries are kept and stay attributed to them.
            </p>
          )}
        </Panel>
      ))}

      {adding ? (
        <Panel>
          <p className="mb-3 text-sm font-bold text-[#2A0608]">New party user</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" value={fullName} onChange={setFullName} placeholder="e.g. Rahman" />
            <Field label="Username" value={username} onChange={(v) => setUsername(v.toLowerCase())} placeholder="e.g. rahman" />
            <Field label="Phone (optional)" value={phone} onChange={setPhone} placeholder="" />
          </div>
          <p className="mt-3 text-xs text-[#52525b]">
            A password is generated automatically and shown once. It cannot be retrieved later.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || !fullName.trim() || !username.trim()}
              onClick={() => void create()}
              className="rounded-lg bg-[#2A0608] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create account"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg bg-white/70 px-4 py-2 text-xs font-semibold text-[#52525b]"
            >
              Cancel
            </button>
          </div>
        </Panel>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-[#2A0608] px-4 py-2 text-xs font-semibold text-white"
          >
            Add party user
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[#52525b]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete="off"
        className="rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm outline-none focus:border-[#2A0608]"
      />
    </label>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[1.6rem] border border-white/60 bg-white/50 px-5 py-4 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-36px_rgba(42,6,8,0.3)]",
        className,
      )}
    >
      {children}
    </div>
  );
}