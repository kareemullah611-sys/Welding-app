"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, ArrowRight, Sun, Moon, LogOut,
  LayoutDashboard, Package, Factory, Banknote, Handshake,
  BookOpen, Receipt, Wallet, Users, Warehouse, ClipboardList,
  ArrowLeftRight, TrendingUp, BarChart2, FileText, Activity,
  Settings, FileCheck, Landmark, BotMessageSquare, PiggyBank,
  ShoppingCart, type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogPortal, DialogOverlay } from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: LucideIcon;
  href?: string;
  action?: () => void;
  keywords?: string;
  roles?: string[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { resolvedTheme, toggle } = useTheme();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items: CommandItem[] = useMemo(() => {
    const role = user?.role || "";
    const isAfghan = user?.countryName === "Afghanistan";
    const all: CommandItem[] = [
      // Quick actions (city admin)
      { id: "qa-sale",     group: "Quick actions", icon: ShoppingCart,  label: "New sale",          href: "/sales",                roles: ["city_admin"], keywords: "create sell invoice voucher" },
      { id: "qa-payment",  group: "Quick actions", icon: Banknote,      label: "Receive payment",   href: "/payments",             roles: ["city_admin"], keywords: "collect cash cheque bank" },
      { id: "qa-expense",  group: "Quick actions", icon: Receipt,       label: "Record expense",    href: "/expenses",             roles: ["city_admin"], keywords: "spend cost lot" },
      { id: "qa-withdraw", group: "Quick actions", icon: Wallet,        label: "Personal withdrawal", href: "/personal-withdrawals", roles: ["super_admin","city_admin"], keywords: "draw cash" },
      { id: "qa-haji",     group: "Quick actions", icon: ArrowLeftRight,label: "Haji transfer",     href: "/haji-transfers",       roles: ["city_admin"], keywords: "send haji" },
      { id: "qa-customer", group: "Quick actions", icon: Users,         label: "New customer",      href: "/customers",            roles: ["city_admin"], keywords: "add buyer client" },

      // Navigate — common
      { id: "nav-dashboard",   group: "Navigate", icon: LayoutDashboard, label: "Dashboard",        href: "/dashboard" },
      { id: "nav-inventory",   group: "Navigate", icon: ClipboardList,   label: "Inventory",        href: "/inventory" },
      { id: "nav-godowns",     group: "Navigate", icon: Warehouse,       label: "Godowns",          href: "/godowns",      roles: ["city_admin"] },
      { id: "nav-city-tx",     group: "Navigate", icon: ArrowLeftRight,  label: "City transfers",   href: "/city-transfers", roles: ["city_admin"] },
      { id: "nav-analytics",   group: "Navigate", icon: BarChart2,       label: "Analytics",        href: "/analytics" },
      { id: "nav-reports",     group: "Navigate", icon: FileText,        label: "Reports",          href: "/reports" },
      { id: "nav-search",      group: "Navigate", icon: Search,          label: "Search",           href: "/search" },
      { id: "nav-activity",    group: "Navigate", icon: Activity,        label: "Activity feed",    href: "/activity-feed" },
      { id: "nav-customers",   group: "Navigate", icon: Users,           label: "Customers",        href: "/customers",    roles: ["city_admin"] },
      { id: "nav-cheques",     group: "Navigate", icon: FileCheck,       label: "Cheque register",  href: "/cheques",      roles: ["city_admin"] },
      { id: "nav-bank-dep",    group: "Navigate", icon: Landmark,        label: "Bank deposits",    href: "/bank-deposits",roles: ["city_admin"] },
      { id: "nav-bank-acc",    group: "Navigate", icon: Landmark,        label: "Bank accounts",    href: "/settings/bank-accounts" },

      // Super admin
      { id: "sa-lots",         group: "Procurement", icon: Package,     label: "Lots",            href: "/lots",          roles: ["super_admin"] },
      { id: "sa-investors",    group: "Procurement", icon: PiggyBank,   label: "Investors",       href: "/investors",     roles: ["super_admin"] },
      { id: "sa-suppliers",    group: "Liabilities", icon: Factory,     label: "Suppliers",       href: "/suppliers",     roles: ["super_admin"] },
      { id: "sa-shipping",     group: "Liabilities", icon: Landmark,    label: "Shipping lines",  href: "/shipping-lines",roles: ["super_admin"] },
      { id: "sa-clearing",     group: "Liabilities", icon: Handshake,   label: "Clearing agents", href: "/agents?agentType=clearing",  roles: ["super_admin"] },
      { id: "sa-custom",       group: "Liabilities", icon: Handshake,   label: "Custom agents",   href: "/agents?agentType=customs",   roles: ["super_admin"] },
      { id: "sa-intermediaries", group: "Liabilities", icon: ArrowLeftRight, label: "Intermediaries", href: "/intermediaries", roles: ["super_admin"] },
      { id: "sa-profit",       group: "Finance",     icon: TrendingUp,  label: "Profit report",   href: "/profit-report", roles: ["super_admin"] },
      { id: "sa-accounts",     group: "Finance",     icon: BookOpen,    label: "Financial reports", href: "/accounts",    roles: ["super_admin"] },
      { id: "sa-openings",     group: "System",      icon: ClipboardList, label: "Openings",      href: "/openings",      roles: ["super_admin"] },
      { id: "sa-settings",     group: "System",      icon: Settings,    label: "Settings",        href: "/settings",      roles: ["super_admin"] },
      { id: "sa-assistant",    group: "System",      icon: BotMessageSquare, label: "AI Assistant", href: "/assistant",    roles: ["super_admin"] },

      // Preferences
      { id: "pref-theme", group: "Preferences", icon: resolvedTheme === "dark" ? Sun : Moon, label: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode", action: toggle, keywords: "dark light appearance" },
      { id: "pref-logout", group: "Preferences", icon: LogOut, label: "Sign out", action: logout, keywords: "exit logout signout" },
    ];

    const afghHide = new Set(["nav-cheques", "nav-bank-dep", "nav-bank-acc"]);
    return all.filter((item) => {
      if (item.roles && role && !item.roles.includes(role)) return false;
      if (isAfghan && afghHide.has(item.id)) return false;
      return true;
    });
  }, [user, resolvedTheme, toggle, logout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.label, item.group, item.keywords || ""].join(" ").toLowerCase().includes(q)
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((item) => {
      const list = map.get(item.group) || [];
      list.push(item);
      map.set(item.group, list);
    });
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const runItem = (item: CommandItem) => {
    onClose();
    if (item.action) {
      item.action();
      return;
    }
    if (item.href) router.push(item.href);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[activeIndex];
      if (item) runItem(item);
    }
  };

  let runningIndex = -1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[100] bg-[hsl(24_28%_8%/0.55)] backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogContent
          aria-label="Command palette"
          className="surface-glass-strong fixed left-[50%] top-[18%] z-[101] w-[calc(100%-2rem)] max-w-xl translate-x-[-50%] overflow-hidden rounded-2xl p-0 duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="divider-glass flex items-center gap-2 px-4 py-3">
            <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search actions, pages, settings…"
              className="flex-1 bg-transparent text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none"
            />
            <kbd className="hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))] sm:inline">
              ESC
            </kbd>
          </div>
          <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No results for &ldquo;{query}&rdquo;</p>
              </div>
            ) : (
              grouped.map(([group, list]) => (
                <div key={group} className="mb-1.5 last:mb-0">
                  <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
                    {group}
                  </p>
                  {list.map((item) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const Icon = item.icon;
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-cmd-index={idx}
                        onClick={() => runItem(item)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-[hsl(var(--primary)/0.10)] text-[hsl(var(--foreground))]"
                            : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.6)]"
                        )}
                      >
                        <span className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-lg",
                          isActive
                            ? "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
                            : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                        )}>
                          <Icon className="h-[15px] w-[15px]" />
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint && (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">{item.hint}</span>
                        )}
                        <ArrowRight className={cn(
                          "h-3.5 w-3.5 transition-opacity",
                          isActive ? "opacity-100 text-[hsl(var(--primary))]" : "opacity-0"
                        )} />
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="divider-glass flex items-center justify-between bg-[hsl(var(--muted)/0.4)] px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 py-0.5 text-[10px] font-medium">↑↓</kbd>
                navigate
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 py-0.5 text-[10px] font-medium">↵</kbd>
                select
              </span>
            </div>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 py-0.5 text-[10px] font-medium">⌘K</kbd>
              to open
            </span>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
