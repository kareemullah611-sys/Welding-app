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
  // Offline PIN
  hasPIN: boolean;
  showPINSetup: boolean;
  setupPIN: (pin: string) => Promise<void>;
  verifyAndUnlockPIN: (pin: string) => Promise<boolean>;
  skipPINSetup: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
  hasPIN: false,
  showPINSetup: false,
  setupPIN: async () => {},
  verifyAndUnlockPIN: async () => false,
  skipPINSetup: async () => {},
});

// ── IndexedDB helpers (opens same mrf-offline DB, no version specified → uses current) ──
const DB_NAME = "mrf-offline";
const CACHE_STORE = "local_cache";
const AUTH_USER_KEY = "auth_user";
const PIN_KEY = "offline_pin";
const PIN_SKIPPED_KEY = "offline_pin_skipped";

function openAuthDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Open without specifying version — uses whatever version exists (set by useOffline)
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function authDbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openAuthDB();
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(CACHE_STORE, "readonly");
        const r = tx.objectStore(CACHE_STORE).get(key);
        r.onsuccess = () => resolve((r.result as any)?.data ?? null);
        r.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  } catch { return null; }
}

async function authDbSet(key: string, data: any): Promise<void> {
  try {
    const db = await openAuthDB();
    await new Promise<void>((resolve, reject) => {
      try {
        const tx = db.transaction(CACHE_STORE, "readwrite");
        tx.objectStore(CACHE_STORE).put({ key, data, cachedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  } catch { /* non-fatal */ }
}

async function authDbDelete(key: string): Promise<void> {
  try {
    const db = await openAuthDB();
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(CACHE_STORE, "readwrite");
        tx.objectStore(CACHE_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  } catch { /* non-fatal */ }
}

async function hashPIN(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Provider ───────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPIN, setHasPIN] = useState(false);
  const [showPINSetup, setShowPINSetup] = useState(false);

  // Check if PIN exists on mount
  useEffect(() => {
    (async () => {
      const pinHash = await authDbGet<string>(PIN_KEY);
      setHasPIN(!!pinHash);
    })();
  }, []);

  const checkAuth = useCallback(async (retries = 3) => {
    try {
      const res = await fetch("/api/v1/auth/me");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUser(data.data);
          await authDbSet(AUTH_USER_KEY, data.data);
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
        await authDbDelete(AUTH_USER_KEY);
        setUser(null);
      }
    } catch {
      // Network error - retry
      if (retries > 0) {
        setTimeout(() => checkAuth(retries - 1), 2000);
        return;
      }
      // All retries exhausted (offline) — restore from cache
      const cached = await authDbGet<User>(AUTH_USER_KEY);
      setUser(cached ?? null);
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
        await authDbSet(AUTH_USER_KEY, data.data.user);
        // Show PIN setup if no PIN exists and user hasn't skipped
        const pinHash = await authDbGet<string>(PIN_KEY);
        const skipped = await authDbGet<boolean>(PIN_SKIPPED_KEY);
        if (!pinHash && !skipped) setShowPINSetup(true);
        return { success: true };
      }
      return { success: false, error: data.error?.message || "Login failed" };
    } catch {
      return { success: false, error: "Network error" };
    }
  };

  const logout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
    await authDbDelete(AUTH_USER_KEY);
    setUser(null);
    window.location.href = "/login";
  };

  // ── Offline PIN ──
  const setupPIN = async (pin: string) => {
    const hash = await hashPIN(pin);
    await authDbSet(PIN_KEY, hash);
    setHasPIN(true);
    setShowPINSetup(false);
  };

  const verifyAndUnlockPIN = async (pin: string): Promise<boolean> => {
    const storedHash = await authDbGet<string>(PIN_KEY);
    if (!storedHash) return false;
    const inputHash = await hashPIN(pin);
    if (inputHash !== storedHash) return false;
    const cached = await authDbGet<User>(AUTH_USER_KEY);
    if (!cached) return false;
    setUser(cached);
    return true;
  };

  const skipPINSetup = async () => {
    await authDbSet(PIN_SKIPPED_KEY, true);
    setShowPINSetup(false);
  };

  // Auto-logout after 30 minutes of inactivity — disabled when offline
  useEffect(() => {
    if (!user) return;
    const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    let timer: NodeJS.Timeout;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!navigator.onLine) { resetTimer(); return; } // don't logout offline users
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
    <AuthContext.Provider value={{
      user, loading, login, logout,
      hasPIN, showPINSetup, setupPIN, verifyAndUnlockPIN, skipPINSetup,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
