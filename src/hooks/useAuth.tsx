"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

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

const OFFLINE_AUTH_CACHE_KEY = "mrf-offline-auth-cache-v1";

interface OfflineAuthCache {
  username: string;
  password: string;
  user: User;
  updatedAt: string;
}

function readOfflineAuthCache(): OfflineAuthCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OFFLINE_AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineAuthCache;
    if (!parsed?.username || !parsed?.password || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeOfflineAuthCache(cache: OfflineAuthCache) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OFFLINE_AUTH_CACHE_KEY, JSON.stringify(cache));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readOfflineAuthCache();
    if (cached?.user) setUser(cached.user);
  }, []);

  const checkAuth = useCallback(async (retries = 3) => {
    try {
      const res = await fetch("/api/v1/auth/me");
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
      const cached = readOfflineAuthCache();
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
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.data.user);
        writeOfflineAuthCache({
          username: username.trim().toLowerCase(),
          password,
          user: data.data.user,
          updatedAt: new Date().toISOString(),
        });
        return { success: true };
      }
      const cached = readOfflineAuthCache();
      if (!navigator.onLine && cached &&
        cached.username === username.trim().toLowerCase() &&
        cached.password === password &&
        cached.user) {
        setUser(cached.user);
        return { success: true };
      }
      return { success: false, error: data.error?.message || "Login failed" };
    } catch {
      const cached = readOfflineAuthCache();
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
    await fetch("/api/v1/auth/logout", { method: "POST" });
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
