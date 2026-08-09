"use client";

import { useEffect, useState } from "react";
import {
  APP_BRANDING_CACHE_KEY,
  APP_BRANDING_UPDATED_EVENT,
  DEFAULT_APP_BRANDING,
  AppBranding,
  normalizeAppBranding,
} from "@/lib/app-branding";
import { apiCall } from "@/hooks/useApi";

export function useAppBranding() {
  const [branding, setBranding] = useState<AppBranding>(DEFAULT_APP_BRANDING);

  useEffect(() => {
    let active = true;

    try {
      const cached = window.localStorage.getItem(APP_BRANDING_CACHE_KEY);
      if (cached) setBranding(normalizeAppBranding(JSON.parse(cached)));
    } catch {
      // Ignore stale local branding cache.
    }

    const load = async () => {
      const result = await apiCall<AppBranding>("/api/v1/app-branding");
      if (!active || !result.success || !result.data) return;
      const next = normalizeAppBranding(result.data);
      setBranding(next);
      window.localStorage.setItem(APP_BRANDING_CACHE_KEY, JSON.stringify(next));
    };

    void load();

    const handleUpdate = (event: Event) => {
      const next = normalizeAppBranding((event as CustomEvent).detail);
      setBranding(next);
      window.localStorage.setItem(APP_BRANDING_CACHE_KEY, JSON.stringify(next));
    };
    window.addEventListener(APP_BRANDING_UPDATED_EVENT, handleUpdate);

    return () => {
      active = false;
      window.removeEventListener(APP_BRANDING_UPDATED_EVENT, handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = branding.systemName;
  }, [branding.systemName]);

  return branding;
}
