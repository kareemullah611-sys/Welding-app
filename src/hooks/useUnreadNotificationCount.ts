"use client";

import { useCallback, useEffect, useState } from "react";
import { apiCall } from "@/hooks/useApi";

export function useUnreadNotificationCount(pollMs = 60_000): number {
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    const r = await apiCall<{ isRead: boolean }[]>("/api/v1/notifications");
    if (r.success && Array.isArray(r.data)) {
      setUnreadCount((r.data as { isRead: boolean }[]).filter((n) => !n.isRead).length);
    }
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), pollMs);
    return () => clearInterval(iv);
  }, [load, pollMs]);

  return unreadCount;
}
