"use client";

import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Sidebar, { SidebarContext, useSidebar } from "@/components/layout/Sidebar";
import { LangProvider, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import MRFLoader from "@/components/ui/MRFLoader";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";

function AppInner({ children }: { children: React.ReactNode }) {
  const { dir } = useLang();
  const { collapsed } = useSidebar();
  const isRTL = dir === "rtl";
  const isEmbed = useQuickformEmbed();

  if (isEmbed) {
    return (
      <div className="quickform-embed min-h-screen overflow-y-auto bg-[#f0f0f2]" dir={dir}>
        <main className="flex min-h-screen flex-col">
          <div className="flex min-h-0 flex-1 flex-col px-0 py-0">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden" dir={dir}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-[-8rem] h-72 w-72 rounded-full bg-[#6B0F1A]/12 blur-3xl" />
        <div className="absolute top-1/3 right-[-6rem] h-80 w-80 rounded-full bg-[#2563EB]/10 blur-3xl" />
      </div>
      <Sidebar />
      <main
        className={cn(
          "relative min-h-screen transition-all duration-300",
          isRTL
            ? collapsed ? "lg:pr-16" : "lg:pr-60"
            : collapsed ? "lg:pl-16" : "lg:pl-60"
        )}
      >
        <div className="mx-auto max-w-7xl px-4 pb-8 pt-16 lg:px-6 lg:pt-6">
          <div className="shell-panel ambient-ring min-h-[calc(100vh-4rem)] p-4 sm:p-5 lg:p-6 page-enter">
            {children}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 lg:hidden">
          <div className="rounded-2xl border border-white/60 bg-white/70 px-14 py-3 backdrop-blur-xl shadow-[0_18px_48px_-30px_rgba(107,15,26,0.25)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6B0F1A]">MRF Hardware</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading && !user) {
    return (
      <MRFLoader
        variant="global"
        visible
        productImageSrc="/products/cutting-disc.png"
        label="Loading"
      />
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
