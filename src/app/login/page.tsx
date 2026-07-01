"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLang, LangSwitcher } from "@/lib/lang";
import { InlineSpinner } from "@/components/ui/BrandLoader";
import BrandLogo from "@/components/brand/BrandLogo";
import { LOGIN_PHOTOS } from "@/config/loginPhotos";
import { EmbedAuthRecovery } from "@/components/quickform/EmbedAuthRecovery";
import { isAuthLogoutPending } from "@/lib/auth-logout-client";

const SLIDE_INTERVAL = 5000;

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const { t, dir } = useLang();
  const [isElectron, setIsElectron] = useState(false);
  const [inIframe, setInIframe] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const hasPhotos = LOGIN_PHOTOS.length > 0;
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    if (!loading && user && !isAuthLogoutPending()) {
      window.location.replace("/dashboard");
    }
  }, [loading, user]);

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && window.platformInfo?.runtime === "electron");
    setInIframe(typeof window !== "undefined" && window.self !== window.top);
  }, []);

  useEffect(() => {
    if (!hasPhotos || LOGIN_PHOTOS.length < 2) return;
    const timer = setInterval(() => {
      setCurrentIdx((i) => (i + 1) % LOGIN_PHOTOS.length);
    }, SLIDE_INTERVAL);
    return () => clearInterval(timer);
  }, [hasPhotos]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const result = await login(username, password);

    if (result.success) {
      window.location.href = "/dashboard";
      return;
    }

    setError(result.error || t("login_failed"));
    setSubmitting(false);
  };

  if (inIframe) {
    return <EmbedAuthRecovery />;
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden" dir={dir}>
      {hasPhotos ? (
        <div className="absolute inset-0 z-0">
          {LOGIN_PHOTOS.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000"
              style={{ opacity: i === currentIdx ? 1 : 0 }}
            />
          ))}
          <div className="absolute inset-0 bg-black/35" />
        </div>
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-slate-900 via-[#3D0808] to-slate-900" />
      )}

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex justify-center">
            <div className="rounded-2xl bg-white p-2 shadow-2xl">
              <BrandLogo size="lg" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">MRF Hardware</h1>
          <p className="text-slate-300 text-sm mt-1 tracking-widest uppercase" style={{ fontSize: "10px", letterSpacing: "3px", color: "#93C5FD" }}>
            Management System
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">{t("sign_in_to_account")}</h2>
            <LangSwitcher />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm space-y-2">
              <p>{error}</p>
              {isElectron && (
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    className="text-left text-xs font-semibold text-red-800 underline"
                    onClick={() => void window.platformInfo?.openRemoteInBrowser?.()}
                  >
                    Open server in browser (wake Render)
                  </button>
                  <button
                    type="button"
                    className="text-left text-xs font-semibold text-red-800 underline"
                    onClick={async () => {
                      const ok = await window.platformInfo?.retryRemoteLoad?.();
                      if (!ok) setError("Could not load online app. Open welding-app-jhhc.onrender.com in Safari first.");
                    }}
                  >
                    Switch to online mode (same as browser)
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("username")}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-field"
                placeholder={t("enter_username")}
                required
                autoFocus
                disabled={submitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder={t("enter_password")}
                required
                disabled={submitting}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 text-sm font-semibold rounded-lg text-white transition-all disabled:opacity-80"
              style={{ background: "linear-gradient(135deg, #6B0F1A 0%, #8B1A1A 100%)" }}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <InlineSpinner />
                  {t("signing_in")}
                </span>
              ) : (
                t("sign_in")
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
