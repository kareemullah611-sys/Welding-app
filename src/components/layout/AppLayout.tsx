"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Sidebar, { SidebarContext, useSidebar } from "@/components/layout/Sidebar";
import { LangProvider, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import MRFLoader from "@/components/ui/MRFLoader";
import { useQuickformEmbed } from "@/hooks/useQuickformEmbed";
import { ThemeProvider } from "@/hooks/useTheme";
import { CommandPalette } from "@/components/ui/CommandPalette";

function AppInner({ children }: { children: React.ReactNode }) {
  const { dir } = useLang();
  const { collapsed } = useSidebar();
  const isRTL = dir === "rtl";
  const isEmbed = useQuickformEmbed();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (isEmbed) return;
    const onKey = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (modifier && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isEmbed]);

  if (isEmbed) {
    return (
      <div className="quickform-embed h-[100dvh] min-h-0 overflow-hidden bg-[#faf6f0]" dir={dir}>
        <main className="flex h-full min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col px-0 py-0">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden" dir={dir}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-[-8rem] h-72 w-72 rounded-full bg-[hsl(var(--primary)/0.18)] blur-3xl" />
        <div className="absolute top-1/3 right-[-6rem] h-80 w-80 rounded-full bg-[hsl(var(--info)/0.15)] blur-3xl" />
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
          <div className="surface-glass flex items-center justify-between rounded-2xl px-14 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--muted-foreground))]">
              MRF Hardware
            </p>
          </div>
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return <MRFLoader variant="global" visible />;
  }

  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <ThemeProvider>
      <LangProvider>
        <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
          <AppInner>{children}</AppInner>
        </SidebarContext.Provider>
      </LangProvider>
    </ThemeProvider>
  );
}
