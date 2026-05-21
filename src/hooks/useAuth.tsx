"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { clearOfflineAuthCache, readOfflineAuthCache, writeOfflineAuthCache } from "@/lib/offline-auth-cache";

interface User {
  id: number;
  username: string;
  fullName: string;
  role: "super_admin" | "city_admin";
  cityId: number | null;
  cityName: string | null;
  countryId: number | null;
  countryName: string | null;
  currencies?: { id: number; code: string; name: string; symbol: string }[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
});

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const PRODUCTION_APP_URL = "https://welding-app-jhhc.onrender.com";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverNotReadyMessage(): string {
  return `Cannot reach the server at ${PRODUCTION_APP_URL}. Open that URL in Safari and wait until the login page loads. If it never loads, open Render Dashboard → welding-app and confirm the latest deploy succeeded, then try again.`;
}

async function waitForServerReady(maxMs = 120000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/health", { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.ok) return true;
      }
    } catch {
      // Render waking or proxy not ready yet.
    }
    await sleep(4000);
  }
  return false;
}

async function fetchWithWarmupRetry(url: string, init: RequestInit, attempts = 6): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    lastRes = await fetch(url, init);
    if (!RETRYABLE_STATUSES.has(lastRes.status) || i === attempts - 1) return lastRes;
    await sleep(2000 * (i + 1));
  }
  return lastRes!;
}

async function parseAuthJson(res: Response): Promise<{
  data?: { success?: boolean; data?: { user: User }; error?: { message?: string } | string };
  error?: string;
}> {
  const text = await res.text();
  try {
    return { data: JSON.parse(text) };
  } catch {
    if (RETRYABLE_STATUSES.has(res.status)) {
      return { error: serverNotReadyMessage() };
    }
    return { error: `Server error (${res.status}). Try again.` };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
    if (cached?.user) setUser(cached.user);
  }, []);

  const checkAuth = useCallback(async (retries = 3) => {
    try {
      const res = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUser(data.data);
          return;
        }
      }
      // If 500 (server/db error), retry - don't logout
      if (res.status >= 500 && retries > 0) {
        setTimeout(() => checkAuth(retries - 1), 2000);
        return;
      }
      // Only clear user on 401 (actually unauthorized)
      if (res.status === 401) {
        setUser(null);
      }
    } catch {
      const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
      if (cached?.user) {
        setUser(cached.user);
        return;
      }
      // Network error - retry
      if (retries > 0) {
        setTimeout(() => checkAuth(retries - 1), 2000);
        return;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    try {
      const isElectron = typeof window !== "undefined" && window.platformInfo?.runtime === "electron";
      if (isElectron) {
        const ready = await waitForServerReady(120000);
        if (!ready) return { success: false, error: serverNotReadyMessage() };
      }

      const res = await fetchWithWarmupRetry("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const parsed = await parseAuthJson(res);
      if (parsed.error) return { success: false, error: parsed.error };
      const data = parsed.data!;
      if (data.success && data.data?.user) {
        setUser(data.data.user);
        writeOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null, {
          username: username.trim().toLowerCase(),
          password,
          user: data.data.user,
          updatedAt: new Date().toISOString(),
        });
        return { success: true };
      }
      const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
      if (!navigator.onLine && cached &&
        cached.username === username.trim().toLowerCase() &&
        cached.password === password &&
        cached.user) {
        setUser(cached.user);
        return { success: true };
      }
      const errMsg = typeof data.error === "string"
        ? data.error
        : data.error?.message;
      if (RETRYABLE_STATUSES.has(res.status)) {
        return { success: false, error: errMsg || serverNotReadyMessage() };
      }
      return { success: false, error: errMsg || "Login failed" };
    } catch {
      const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
      if (cached &&
        cached.username === username.trim().toLowerCase() &&
        cached.password === password &&
        cached.user) {
        setUser(cached.user);
        return { success: true };
      }
      return { success: false, error: "Network error" };
    }
  };

  const logout = async () => {
    clearOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Keep local logout deterministic even when offline.
    }
    setUser(null);
    window.location.href = "/login";
  };

  // Auto-logout after 30 minutes of inactivity
  useEffect(() => {
    if (!user) return;
    const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    let timer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        alert("Session expired due to inactivity. Please login again.");
        logout();
      }, IDLE_TIMEOUT);
    };

    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
