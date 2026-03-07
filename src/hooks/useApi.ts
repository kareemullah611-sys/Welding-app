"use client";

import { useState, useCallback } from "react";

interface FetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T = unknown>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const request = useCallback(async (url: string, options: FetchOptions = {}) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // Build URL with params
      let fullUrl = url;
      if (options.params) {
        const params = new URLSearchParams();
        Object.entries(options.params).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            params.append(key, String(value));
          }
        });
        const queryString = params.toString();
        if (queryString) fullUrl += `?${queryString}`;
      }

      const fetchOptions: RequestInit = {
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
      };

      if (options.body && options.method !== "GET") {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const res = await fetch(fullUrl, fetchOptions);
      const data = await res.json();

      if (data.success) {
        setState({ data: data.data as T, loading: false, error: null });
        return { success: true, data: data.data as T, pagination: data.pagination };
      } else {
        const error = data.error?.message || "Request failed";
        setState({ data: null, loading: false, error });
        return { success: false, error };
      }
    } catch (err) {
      const error = "Network error";
      setState({ data: null, loading: false, error });
      return { success: false, error };
    }
  }, []);

  return { ...state, request };
}

// Simplified fetch helper for one-off calls
export async function apiCall<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<{ success: boolean; data?: T; error?: string; pagination?: unknown }> {
  try {
    let fullUrl = url;
    if (options.params) {
      const params = new URLSearchParams();
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      });
      const qs = params.toString();
      if (qs) fullUrl += `?${qs}`;
    }

    const fetchOptions: RequestInit = {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
    };

    if (options.body && options.method !== "GET") {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const res = await fetch(fullUrl, fetchOptions);
    const data = await res.json();

    if (data.success) {
      return { success: true, data: data.data as T, pagination: data.pagination };
    }
    return { success: false, error: data.error?.message || "Request failed" };
  } catch {
    return { success: false, error: "Network error" };
  }
}
