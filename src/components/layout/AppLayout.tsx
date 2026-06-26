"use client";

import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Sidebar, { SidebarContext, useSidebar } from "@/components/layout/Sidebar";
import { LangProvider, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { EmbedAuthRecovery } from "@/components/quickform/EmbedAuthRecovery";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { getEmbedFromLocation } from "@/lib/quickform-embed";

function AppInner({ children, isCityAdmin }: { children: React.ReactNode; isCityAdmin: boolean }) {
  const { dir } = useLang();
  const { collapsed } = useSidebar();
  const isRTL = dir === "rtl";
  const isEmbed = useQuickformEmbed() || getEmbedFromLocation();

  if (isEmbed) {
    return (
      <div className={cn("quickform-embed h-[100dvh] min-h-0 overflow-hidden", isCityAdmin && "city-admin-ui")} dir={dir}>
        <main className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-y-contain">
          <div className="module-page flex min-h-0 flex-1 flex-col px-0 py-0">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip" dir={dir}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-[-8rem] h-72 w-72 rounded-full bg-[#6B0F1A]/12 blur-3xl" />
        <div className="absolute top-1/3 right-[-6rem] h-80 w-80 rounded-full bg-[#2563EB]/10 blur-3xl" />
      </div>
      <Sidebar />
      <main
        className={cn(
          "relative min-h-[100dvh] min-w-0 transition-all duration-300",
          isRTL
            ? collapsed ? "lg:pr-16" : "lg:pr-64"
            : collapsed ? "lg:pl-16" : "lg:pl-64"
        )}
      >
        <div className="mx-auto min-w-0 max-w-7xl px-4 pb-8 pt-16 lg:px-6 lg:pt-6">
          <div className="shell-panel ambient-ring module-page p-4 sm:p-5 lg:p-6 page-enter">
            <div className={isCityAdmin ? "city-admin-ui" : undefined}>{children}</div>
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
  const { user, loading, recheckAuth } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [embedRetrying, setEmbedRetrying] = useState(false);
  const isEmbed = useQuickformEmbed() || (typeof window !== "undefined" && getEmbedFromLocation());

  if (loading && !user) {
    return <BrandLoader fullscreen size="lg" label="Loading" />;
  }

  if (!user) {
    if (isEmbed) {
      return (
        <EmbedAuthRecovery
          retrying={embedRetrying}
          onRetry={() => {
            setEmbedRetrying(true);
            void recheckAuth().finally(() => setEmbedRetrying(false));
          }}
        />
      );
    }
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <LangProvider>
      <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
        <AppInner isCityAdmin={user.role === "city_admin"}>{children}</AppInner>
      </SidebarContext.Provider>
    </LangProvider>
  );
}
