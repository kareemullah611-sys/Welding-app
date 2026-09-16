"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Sidebar, { SidebarContext, useSidebar } from "@/components/layout/Sidebar";
import { LangProvider, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { EmbedAuthRecovery } from "@/components/quickform/EmbedAuthRecovery";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { getEmbedFromLocation } from "@/lib/quickform-embed";
import { useAppBranding } from "@/hooks/useAppBranding";
import SuperAdminTransactionModal from "@/components/transactions/SuperAdminTransactionModal";

function AppInner({ children, isCityAdmin, isSuperAdmin }: { children: React.ReactNode; isCityAdmin: boolean; isSuperAdmin: boolean }) {
  const { dir } = useLang();
  const { collapsed } = useSidebar();
  const branding = useAppBranding();
  const isRTL = dir === "rtl";
  const isEmbed = useQuickformEmbed() || getEmbedFromLocation();

  if (isEmbed) {
    return (
      <div className={cn("quickform-embed h-[100dvh] min-h-0 overflow-hidden", isCityAdmin && "city-admin-ui")} dir={dir}>
        <main className="flex h-full min-h-0 flex-col overflow-hidden overscroll-y-contain">
          <div className="module-page flex min-h-0 flex-1 flex-col px-0 py-0">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-x-clip" dir={dir}>
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-24 left-[-8rem] h-72 w-72 rounded-full bg-[#6B0F1A]/25 blur-3xl" />
        <div className="absolute top-1/4 left-[-6rem] h-80 w-80 rounded-full bg-[#2563EB]/20 blur-3xl" />
        <div className="absolute bottom-[-6rem] left-[-4rem] h-72 w-72 rounded-full bg-[#7A1420]/18 blur-3xl" />
        <div className="absolute top-1/2 left-24 h-64 w-64 rounded-full bg-[#3B82F6]/12 blur-3xl" />
        <div className="absolute top-1/3 right-[-6rem] h-80 w-80 rounded-full bg-[#2563EB]/10 blur-3xl" />
      </div>
      <Sidebar />
      <main
        className={cn(
          "sidebar-layout-shift relative z-10 min-h-[100dvh] min-w-0",
          isRTL
            ? collapsed ? "lg:pr-[5.5rem]" : "lg:pr-[17.5rem]"
            : collapsed ? "lg:pl-[5.5rem]" : "lg:pl-[17.5rem]"
        )}
      >
        <div className="mx-auto min-w-0 max-w-7xl px-4 pb-8 pt-16 lg:px-6 lg:pt-6">
          <div className="shell-panel ambient-ring module-page p-4 sm:p-5 lg:p-6 page-enter">
            {isSuperAdmin ? <div className="mb-4 flex justify-end"><SuperAdminTransactionModal /></div> : null}
            <div className={isCityAdmin ? "city-admin-ui" : undefined}>{children}</div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-4 top-4 z-10 lg:hidden">
          <div className="rounded-2xl border border-white/60 bg-white/70 px-14 py-3 backdrop-blur-xl shadow-[0_18px_48px_-30px_rgba(107,15,26,0.25)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6B0F1A]">{branding.systemName}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, recheckAuth } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [embedRetrying, setEmbedRetrying] = useState(false);

  // When the page is zoomed out, the manual icon-only collapse is overridden so
  // the full module list shows again. Zooming out makes the browser report a
  // wider CSS viewport than the load-time (assumed 100%) width and, in Chrome,
  // a lower devicePixelRatio. Either signal (relative to its own baseline, so
  // a large monitor at 100% isn't affected) flags a zoomed-out state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const baselineWidth = window.innerWidth;
    const baselineDpr = window.devicePixelRatio || 1;
    const check = () =>
      setZoomedOut(
        window.innerWidth > baselineWidth * 1.05 ||
          (window.devicePixelRatio || 1) < baselineDpr - 0.01
      );
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const effectiveCollapsed = collapsed && !zoomedOut;
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
      <SidebarContext.Provider value={{ collapsed: effectiveCollapsed, setCollapsed }}>
        <AppInner isCityAdmin={user.role === "city_admin"} isSuperAdmin={user.role === "super_admin"}>{children}</AppInner>
      </SidebarContext.Provider>
    </LangProvider>
  );
}
