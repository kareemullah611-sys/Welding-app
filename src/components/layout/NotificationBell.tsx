"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiCall } from "@/hooks/useApi";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface Props {
  /** Render as part of the sidebar (dark background, no fixed positioning) */
  sidebarMode?: boolean;
  /** Show only the icon + badge (no label) — for collapsed sidebar */
  compact?: boolean;
}

export default function NotificationBell({ sidebarMode = false, compact = false }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiCall("/api/v1/notifications");
    if (r.success) setNotifications(r.data as Notification[]);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markAllRead = async () => {
    setLoading(true);
    await apiCall("/api/v1/notifications", { method: "PUT" });
    setLoading(false);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const typeIcon = (type: string) => {
    if (type === "low_stock") return "📦";
    if (type === "transfer") return "🚛";
    return "🔔";
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Dropdown opens upward when inside sidebar footer
  const dropdownPositionClass = sidebarMode
    ? "bottom-full mb-2 left-0"
    : "right-0 top-full mt-2";

  if (sidebarMode) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          title="Notifications"
          className={
            compact
              ? "relative rounded-2xl p-2 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              : "w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13px] font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-all duration-150"
          }
        >
          <span className="relative flex-shrink-0">
            🔔
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </span>
          {!compact && (
            <span className="truncate flex-1">Notifications</span>
          )}
          {!compact && unreadCount > 0 && (
            <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className={`absolute ${dropdownPositionClass} w-80 overflow-hidden rounded-[1.4rem] border border-[#e8dfd4] bg-[#fffaf5]/95 shadow-[0_30px_80px_-36px_rgba(51,42,33,0.42)] backdrop-blur-xl z-50`}>
            <div className="flex items-center justify-between border-b border-[#eee3d6] bg-[linear-gradient(180deg,#fff8ef_0%,#f8efe3_100%)] px-4 py-3">
              <span className="font-semibold text-[#2c2118] text-sm">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} disabled={loading} className="text-xs font-medium text-[#9a3a22] hover:underline">
                  {loading ? "..." : "Mark all read"}
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto divide-y">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400 text-sm">No notifications</div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`px-4 py-3 text-sm ${n.isRead ? "bg-white/60" : "bg-[#fff1e8]"}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-base leading-none mt-0.5">{typeIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate ${n.isRead ? "text-gray-700" : "text-gray-900"}`}>{n.title}</p>
                        <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-gray-400 text-xs mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                      {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1 shrink-0" />}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Legacy floating mode (kept for backward compat but no longer used)
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-2xl p-2 text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
        title="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute ${dropdownPositionClass} w-80 overflow-hidden rounded-[1.4rem] border border-[#e8dfd4] bg-[#fffaf5]/95 shadow-[0_30px_80px_-36px_rgba(51,42,33,0.42)] backdrop-blur-xl z-50`}>
          <div className="flex items-center justify-between border-b border-[#eee3d6] bg-[linear-gradient(180deg,#fff8ef_0%,#f8efe3_100%)] px-4 py-3">
            <span className="font-semibold text-[#2c2118] text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} disabled={loading} className="text-xs font-medium text-[#9a3a22] hover:underline">
                {loading ? "..." : "Mark all read"}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">No notifications</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`px-4 py-3 text-sm ${n.isRead ? "bg-white/60" : "bg-[#fff1e8]"}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-base leading-none mt-0.5">{typeIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${n.isRead ? "text-gray-700" : "text-gray-900"}`}>{n.title}</p>
                      <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-gray-400 text-xs mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 mt-1 shrink-0" />}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
