"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerPortalLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/customer-portal/me", { credentials: "include", cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (data?.success && data.data) router.replace("/customer-portal");
    })();
  }, [router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/v1/customer-portal/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => null);
    setSubmitting(false);
    if (data?.success) {
      router.replace("/customer-portal");
      return;
    }
    setError(data?.error?.message || "Login failed");
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-[#3b0710] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center">
        <form onSubmit={handleSubmit} className="w-full rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur">
          <div className="mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/60">Customer Portal</p>
            <h1 className="mt-2 text-3xl font-bold">Login</h1>
            <p className="mt-2 text-sm text-white/65">View your ledger, payments, and running balance.</p>
          </div>
          {error && <div className="mb-4 rounded-xl border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm text-red-100">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-white/80">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none focus:border-white focus:ring-2 focus:ring-white/30"
                autoCapitalize="none"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-white/80">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white px-4 py-3 text-slate-900 outline-none focus:border-white focus:ring-2 focus:ring-white/30"
              />
            </div>
          </div>
          <button disabled={submitting} className="mt-6 w-full rounded-xl bg-white px-4 py-3 font-bold text-[#6B0F1A] shadow-lg transition hover:bg-white/90 disabled:opacity-60">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
