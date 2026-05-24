"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { clearOfflineAuthCache, readOfflineAuthCache, writeOfflineAuthCache, buildOfflinePasswordVerifier, verifyOfflinePassword } from "@/lib/offline-auth-cache";
import { isPackagedOfflineRuntime } from "@/lib/offline-cache";
import { probeServerReachable, setPackagedServerReachable } from "@/lib/offline-reachability";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

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
const PACKAGED_AUTH_TIMEOUT_MS = 8000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithWarmupRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastRes: Response | null = null;
  const useTimeout = isPackagedOfflineRuntime();
  for (let i = 0; i < attempts; i++) {
    try {
      lastRes = useTimeout
        ? await fetchWithTimeout(url, init, PACKAGED_AUTH_TIMEOUT_MS)
        : await fetch(url, init);
    } catch {
      if (i === attempts - 1) throw new Error("Network error");
      await sleep(1500 * (i + 1));
      continue;
    }
    if (!RETRYABLE_STATUSES.has(lastRes.status) || i === attempts - 1) return lastRes;
    await sleep(1500 * (i + 1));
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
      return { error: "Server is waking up. You can keep working offline." };
    }
    return { error: `Server error (${res.status}). Try again.` };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshOnlineSession = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(
        "/api/v1/auth/me",
        { credentials: "include", cache: "no-store" },
        PACKAGED_AUTH_TIMEOUT_MS
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUser(data.data);
          setPackagedServerReachable(true);
          return;
        }
      }
      if (res.status === 401) {
        setUser(null);
      }
    } catch {
      setPackagedServerReachable(false);
    }
  }, []);

  const checkAuth = useCallback(async (retries = 3) => {
    const packaged = isPackagedOfflineRuntime();
    const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);

    if (packaged && cached?.user) {
      setUser(cached.user);
      setPackagedServerReachable(false);
      setLoading(false);
      void refreshOnlineSession();
      return;
    }

    try {
      const res = packaged
        ? await fetchWithTimeout("/api/v1/auth/me", { credentials: "include", cache: "no-store" }, PACKAGED_AUTH_TIMEOUT_MS)
        : await fetch("/api/v1/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUser(data.data);
          if (packaged) setPackagedServerReachable(true);
          return;
        }
      }
      if (res.status >= 500 && retries > 0) {
        setTimeout(() => checkAuth(retries - 1), 2000);
        return;
      }
      if (res.status === 401) {
        setUser(null);
      }
    } catch {
      if (cached?.user) {
        setUser(cached.user);
        if (packaged) setPackagedServerReachable(false);
        return;
      }
      if (retries > 0) {
        setTimeout(() => checkAuth(retries - 1), 2000);
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [refreshOnlineSession]);

  useEffect(() => {
    const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
    if (cached?.user) setUser(cached.user);
    void checkAuth();
  }, [checkAuth]);

  const tryOnlineLogin = useCallback(async (username: string, password: string): Promise<{ ok: boolean; user?: User; error?: string }> => {
    try {
      const res = await fetchWithWarmupRetry("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const parsed = await parseAuthJson(res);
      if (parsed.error) return { ok: false, error: parsed.error };
      const data = parsed.data!;
      if (data.success && data.data?.user) {
        setPackagedServerReachable(true);
        return { ok: true, user: data.data.user };
      }
      const errMsg = typeof data.error === "string" ? data.error : data.error?.message;
      return { ok: false, error: errMsg || "Login failed" };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }, []);

  const login = async (username: string, password: string) => {
    const normalizedUsername = username.trim().toLowerCase();
    const cached = readOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null);
    const cacheMatches = Boolean(
      cached &&
        cached.username === normalizedUsername &&
        cached.user &&
        (await verifyOfflinePassword(password, cached))
    );

    const packaged = isPackagedOfflineRuntime();

    if (packaged && cacheMatches) {
      setPackagedServerReachable(false);
      setUser(cached!.user);
      void (async () => {
        const online = await tryOnlineLogin(username, password);
        if (online.ok && online.user) {
          setUser(online.user);
          writeOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null, {
            username: normalizedUsername,
            passwordVerifier: await buildOfflinePasswordVerifier(password),
            user: online.user,
            updatedAt: new Date().toISOString(),
          });
        } else {
          const reachable = await probeServerReachable();
          setPackagedServerReachable(reachable);
        }
      })();
      return { success: true };
    }

    const online = await tryOnlineLogin(username, password);
    if (online.ok && online.user) {
      setUser(online.user);
      writeOfflineAuthCache(typeof window !== "undefined" ? window.localStorage : null, {
        username: normalizedUsername,
        passwordVerifier: await buildOfflinePasswordVerifier(password),
        user: online.user,
        updatedAt: new Date().toISOString(),
      });
      return { success: true };
    }

    if (packaged && cacheMatches) {
      setPackagedServerReachable(false);
      setUser(cached!.user);
      return { success: true };
    }

    return { success: false, error: online.error || "Login failed" };
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
    const IDLE_TIMEOUT = 30 * 60 * 1000;
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
