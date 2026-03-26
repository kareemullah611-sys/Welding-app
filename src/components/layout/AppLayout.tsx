"use client";

import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Sidebar, { SidebarContext, useSidebar } from "@/components/layout/Sidebar";
import { LangProvider, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

function AppInner({ children }: { children: React.ReactNode }) {
  const { dir } = useLang();
  const { collapsed } = useSidebar();
  const isRTL = dir === "rtl";

  return (
    <div className="min-h-screen bg-gray-50" dir={dir}>
      <Sidebar />
      <main
        className={cn(
          "min-h-screen transition-all duration-200",
          isRTL
            ? collapsed ? "lg:pr-16" : "lg:pr-60"
            : collapsed ? "lg:pl-16" : "lg:pl-60"
        )}
      >
        <div className="p-4 lg:p-6 pt-14 lg:pt-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <LangProvider>
      <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
        <AppInner>{children}</AppInner>
      </SidebarContext.Provider>
    </LangProvider>
  );
}
