"use client";

import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LangSwitcher, useLang } from "@/lib/lang";
import { apiCall } from "@/hooks/useApi";
import BrandLogo from "@/components/brand/BrandLogo";
import {
  LayoutDashboard, Package, Factory, Banknote, Handshake,
  BookOpen, Receipt, Wallet, Users, ClipboardList,
  ArrowLeftRight, TrendingUp, BarChart2, FileText, Search,
  Activity, Settings, LogOut, ChevronLeft, ChevronRight,
  Menu, FileCheck, Landmark, BotMessageSquare, PiggyBank, X, ChevronDown, Lock, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Sidebar Context ──────────────────────────────────────────────────────────
export interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}
export const SidebarContext = createContext<SidebarCtx>({
  collapsed: false,
  setCollapsed: () => {},
});
export const useSidebar = () => useContext(SidebarContext);

const SIDEBAR_NAV_SCROLL_KEY = "mrf-sidebar-nav-scroll";
const SIDEBAR_OPEN_GROUPS_KEY = "mrf-sidebar-open-groups";

const SIDEBAR_SHELL =
  "bg-white/40 backdrop-blur-2xl backdrop-saturate-[1.8] border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_0_0_0.5px_rgba(255,255,255,0.3),0_24px_60px_-24px_rgba(42,6,8,0.38)]";

// Mobile drawer only: a brighter frosted base. The mobile panel sits over a
// dark scrim and the browser often weakens backdrop-filter on mobile, so the
// too-transparent desktop base would composite into flat grey there.
const SIDEBAR_SHELL_MOBILE =
  "bg-gradient-to-b from-white/85 via-white/80 to-white/85 backdrop-blur-2xl backdrop-saturate-[1.8] border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_0_0.5px_rgba(255,255,255,0.4),0_24px_60px_-24px_rgba(42,6,8,0.38)]";

// ─── Nav Config ───────────────────────────────────────────────────────────────
interface NavItemDef {
  label: string;
  key: string;
  href: string;
  icon: LucideIcon;
  roles: string[];
  locked?: boolean;
}

const superAdminNavGroups: { label: string; items: NavItemDef[] }[] = [
  {
    label: "Home",
    items: [
      { label: "Dashboard", key: "dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "Procurement",
    items: [
      { label: "Lots",             key: "lots",             href: "/lots",             icon: Package,     roles: ["super_admin", "city_admin"] },
      { label: "Investors",        key: "investors",        href: "/investors",        icon: PiggyBank,   roles: ["super_admin"] },
    ],
  },
  {
    label: "Liabilities",
    items: [
      { label: "Suppliers",       key: "suppliers",      href: "/suppliers",                    icon: Factory,       roles: ["super_admin"] },
      { label: "Shipping Line",   key: "shipping_lines", href: "/shipping-lines",               icon: Landmark,      roles: ["super_admin"] },
      { label: "Clearing Agents", key: "agents",         href: "/agents?agentType=clearing",   icon: Handshake,     roles: ["super_admin"] },
      { label: "Intermediaries",  key: "intermediaries", href: "/intermediaries",               icon: ArrowLeftRight, roles: ["super_admin"] },
      { label: "Custom Agents",   key: "custom_agents",  href: "/agents?agentType=customs",    icon: Handshake,     roles: ["super_admin"] },
    ],
  },
  {
    label: "Daily Work",
    items: [
      { label: "Sales",            key: "sales",            href: "/sales",            icon: Receipt,   roles: ["city_admin"] },
      { label: "Payments",         key: "payments",         href: "/payments",         icon: Wallet,    roles: ["super_admin", "city_admin"] },
      { label: "Expenses",         key: "expenses",         href: "/expenses",         icon: Banknote,  roles: ["city_admin"] },
      { label: "Home Expenses", key: "super_admin_personal_expenses", href: "/super-admin-personal-expenses", icon: Banknote, roles: ["super_admin"] },
      { label: "Withdrawals",      key: "personal_withdrawals", href: "/personal-withdrawals", icon: PiggyBank, roles: ["super_admin", "city_admin"] },
      { label: "Haji Transfers",   key: "haji_transfers",   href: "/haji-transfers",   icon: ArrowLeftRight, roles: ["city_admin"] },
      { label: "Customers",        key: "customers",        href: "/customers",        icon: Users,     roles: ["city_admin"] },
      { label: "Cheque Register",  key: "cheque_register",  href: "/cheques",          icon: FileCheck, roles: ["city_admin"] },
      { label: "Bank Deposits",    key: "bank_deposits",    href: "/bank-deposits",    icon: Landmark,  roles: ["city_admin"] },
    ],
  },
  {
    label: "Stock & Movement",
    items: [
      { label: "Inventory",      key: "inventory",      href: "/inventory",      icon: ClipboardList, roles: ["super_admin", "city_admin"] },
      { label: "City Transfers", key: "city_transfers", href: "/city-transfers", icon: ArrowLeftRight,roles: ["city_admin"] },
    ],
  },
  {
    label: "Reports & Review",
    items: [
      { label: "Analytics",        key: "analytics",        href: "/analytics",     icon: BarChart2,  roles: ["super_admin", "city_admin"] },
      { label: "Profit Report",    key: "profit_report",    href: "/profit-report", icon: TrendingUp, roles: ["super_admin"] },
      { label: "Financial Reports",key: "financial_reports",href: "/accounts",      icon: BookOpen,   roles: ["super_admin"] },
      { label: "Reports",          key: "reports",          href: "/reports",       icon: FileText,   roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "Search & Audit",
    items: [
      { label: "Search",        key: "search",        href: "/search",        icon: Search,          roles: ["super_admin", "city_admin"] },
      { label: "Activity Feed", key: "activity_feed", href: "/activity-feed", icon: Activity,        roles: ["super_admin"] },
      { label: "AI Assistant",  key: "assistant",     href: "/assistant",     icon: BotMessageSquare,roles: ["super_admin"] },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Openings",      key: "openings",      href: "/openings",              icon: ClipboardList, roles: ["super_admin"] },
      { label: "Settings",      key: "settings",      href: "/settings",              icon: Settings, roles: ["super_admin"] },
      { label: "Bank Accounts", key: "bank_accounts",  href: "/settings/bank-accounts", icon: Landmark, roles: ["super_admin", "city_admin"] },
    ],
  },
];

const cityAdminNavGroups: { label: string; items: NavItemDef[] }[] = [
  {
    label: "Home",
    items: [
      { label: "Dashboard", key: "dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["city_admin"] },
    ],
  },
  {
    label: "Lists",
    items: [
      { label: "Payments",               key: "payments",             href: "/payments",             icon: Wallet,         roles: ["city_admin"] },
      { label: "Sales",                  key: "sales",                href: "/sales",                icon: Receipt,        roles: ["city_admin"] },
      { label: "Expenses",               key: "expenses",             href: "/expenses",             icon: Banknote,       roles: ["city_admin"] },
      { label: "Personal Withdrawals",   key: "personal_withdrawals", href: "/personal-withdrawals", icon: PiggyBank,      roles: ["city_admin"] },
      { label: "Haji Transfers",         key: "haji_transfers",       href: "/haji-transfers",       icon: ArrowLeftRight, roles: ["city_admin"] },
      { label: "Customers",              key: "customers",            href: "/customers",            icon: Users,          roles: ["city_admin"] },
    ],
  },
  {
    label: "Stock",
    items: [
      { label: "Lots",      key: "lots",      href: "/lots",      icon: Package,       roles: ["city_admin"] },
      { label: "Inventory", key: "inventory", href: "/inventory", icon: ClipboardList, roles: ["city_admin"] },
    ],
  },
  {
    label: "Treasury",
    items: [
      { label: "Cheque Register", key: "cheque_register", href: "/cheques",               icon: FileCheck, roles: ["city_admin"] },
      { label: "Bank Deposits",   key: "bank_deposits",   href: "/bank-deposits",         icon: Landmark,  roles: ["city_admin"] },
      { label: "Bank Accounts",   key: "bank_accounts",   href: "/settings/bank-accounts",icon: Landmark,  roles: ["city_admin"] },
    ],
  },
  {
    label: "Other",
    items: [
      { label: "Reports",  key: "reports",  href: "/reports",       icon: FileText,      roles: ["city_admin"] },
      { label: "Audit",    key: "audit",    href: "/activity-feed", icon: Activity,      roles: ["city_admin"], locked: true },
      { label: "Openings", key: "openings", href: "/openings",      icon: ClipboardList, roles: ["city_admin"] },
      { label: "Settings", key: "settings", href: "/settings",      icon: Settings,      roles: ["city_admin"] },
    ],
  },
];

// ─── Avatar ───────────────────────────────────────────────────────────────────
function UserAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br from-[#6B0F1A] via-[#7A1420] to-[#8B1A1A] text-white font-bold flex items-center justify-center flex-shrink-0 shadow-[0_10px_24px_-16px_rgba(107,15,26,0.75)]",
        size === "md" ? "w-8 h-8 text-[11px]" : "w-7 h-7 text-[10px]"
      )}
    >
      {initials || "?"}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { t, dir } = useLang();
  const { collapsed, setCollapsed } = useSidebar();
  const isRTL = dir === "rtl";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingTransfers, setPendingTransfers] = useState(0);
  const [routeQuery, setRouteQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const touchStartX = useRef(0);
  const desktopNavRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setRouteQuery(typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "");
  }, [pathname]);

  const restoreNavScroll = useCallback(() => {
    const saved = Number(sessionStorage.getItem(SIDEBAR_NAV_SCROLL_KEY) || "0");
    if (!saved) return;
    for (const el of [desktopNavRef.current, mobileNavRef.current]) {
      if (el) el.scrollTop = saved;
    }
  }, []);

  const handleNavScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    sessionStorage.setItem(SIDEBAR_NAV_SCROLL_KEY, String(event.currentTarget.scrollTop));
  }, []);

  useLayoutEffect(() => {
    restoreNavScroll();
  }, [pathname, routeQuery, restoreNavScroll]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, routeQuery]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (user?.role !== "city_admin") return;
    const fetchPending = () =>
      apiCall<any>("/api/v1/city-transfers", { params: { status: "pending", direction: "incoming", limit: 1 } })
        .then((r) => { if (r.success) setPendingTransfers((r.pagination as any)?.total ?? 0); });
    fetchPending();
    const interval = setInterval(fetchPending, 60000);
    return () => clearInterval(interval);
  }, [user]);

  const isAfghanistan = user?.countryName === "Afghanistan";
  const afghHide = ["cheque_register", "bank_deposits", "bank_accounts"];

  const navGroups = user?.role === "city_admin" ? cityAdminNavGroups : superAdminNavGroups;

  const filteredGroups = useMemo(() => {
    if (!user) return [];
    return navGroups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => i.roles.includes(user.role) && !(isAfghanistan && afghHide.includes(i.key))
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [user, navGroups, isAfghanistan]);

  const currentRoute = routeQuery ? `${pathname}?${routeQuery}` : pathname;

  const activeHref = useMemo(() => {
    const isHrefActive = (href: string) => {
      if (href.includes("?")) return currentRoute === href;
      return pathname === href || pathname.startsWith(href + "/");
    };
    return (
      filteredGroups
        .flatMap((group) => group.items.map((item) => item.href))
        .filter((href) => isHrefActive(href))
        .sort((a, b) => b.length - a.length)[0] || null
    );
  }, [filteredGroups, currentRoute, pathname]);

  const groupContainsActive = useCallback(
    (group: (typeof filteredGroups)[number]) =>
      group.items.some((item) => item.href === activeHref),
    [activeHref]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try {
      const raw = sessionStorage.getItem(SIDEBAR_OPEN_GROUPS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as string[];
      const valid = stored.filter((label) => filteredGroups.some((g) => g.label === label));
      if (valid.length > 0) setOpenGroups(new Set(valid));
    } catch {
      /* ignore */
    }
  }, [user?.role]);

  const persistOpenGroups = useCallback((next: Set<string>) => {
    sessionStorage.setItem(SIDEBAR_OPEN_GROUPS_KEY, JSON.stringify([...next]));
  }, []);

  /** On navigation: keep only the section that contains the current page open */
  useEffect(() => {
    if (!user) return;
    const activeLabels = filteredGroups
      .filter((g) => g.items.length > 1 && groupContainsActive(g))
      .map((g) => g.label);
    setOpenGroups((prev) => {
      const next = new Set(activeLabels);
      const same =
        prev.size === next.size && [...prev].every((label) => next.has(label));
      if (same) return prev;
      persistOpenGroups(next);
      return next;
    });
  }, [pathname, routeQuery, activeHref, user, filteredGroups, groupContainsActive, persistOpenGroups]);

  const toggleGroup = useCallback(
    (label: string) => {
      setOpenGroups((prev) => {
        const isOpen = prev.has(label);
        if (isOpen) {
          const next = new Set(prev);
          next.delete(label);
          persistOpenGroups(next);
          return next;
        }
        // Accordion: opening one section closes all others
        const next = new Set([label]);
        persistOpenGroups(next);
        return next;
      });
    },
    [persistOpenGroups]
  );

  if (!user) return null;

  const renderNavItem = (item: NavItemDef, nested = false) => {
    const Icon = item.icon;
    const isActive = !item.locked && item.href === activeHref;
    const label =
      (() => {
        if (item.key === "bank_deposits" && user.role === "city_admin" && user.countryName === "Pakistan") {
          return "Inter Funds Transfer";
        }
        const translated = t(item.key);
        return translated === item.key ? item.label : translated;
      })();

    const itemShellClass = cn(
      "group relative flex items-center rounded-[0.875rem] text-[13.5px] font-semibold tracking-[-0.01em] transition-[color,background,border,box-shadow,transform] duration-200 ease-out active:scale-[0.98]",
      collapsed ? "justify-center px-0 py-2.5 mx-0" : cn("gap-3", nested ? "px-3 py-2" : "px-3 py-2.5"),
      item.locked
        ? "cursor-not-allowed border border-dashed border-[#D4D4D8] bg-[#fafafa] text-[#52525b] select-none"
        : isActive
          ? "bg-gradient-to-br from-[#7A1420] via-[#6B0F1A] to-[#5A0C15] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_12px_26px_-12px_rgba(107,15,26,0.7)] ring-1 ring-inset ring-white/25"
          : cn(
              "text-[#3f3f46] bg-transparent border border-transparent",
              "hover:text-[#18181b] hover:bg-white/35 hover:border-white/60 hover:backdrop-blur-md hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]",
              isRTL ? "hover:-translate-x-0.5" : "hover:translate-x-0.5"
            )
    );

    const itemBody = (
      <>
        {isActive && !collapsed && (
          <span
            className={cn(
              "absolute inset-y-2 w-[3px] rounded-full bg-[#3B82F6]",
              isRTL ? "right-0" : "left-0"
            )}
          />
        )}
        <div className="relative flex-shrink-0">
          <span
            className={cn(
              "flex items-center justify-center rounded-[0.7rem] transition-all duration-200",
              nested ? "w-6 h-6" : "w-8 h-8",
              isActive
                ? "bg-white/20 ring-1 ring-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
                : item.locked
                  ? "bg-white/45 ring-1 ring-white/55"
                  : "bg-gradient-to-br from-white/90 to-white/50 ring-1 ring-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_5px_12px_-7px_rgba(42,6,8,0.3)] group-hover:from-white group-hover:to-white/70"
            )}
          >
            <Icon
              className={cn(
                nested ? "w-3.5 h-3.5" : "w-[17px] h-[17px]",
                "transition-colors duration-200",
                isActive ? "text-white" : item.locked ? "text-[#71717a]" : "text-[#6B0F1A] group-hover:text-[#5A0C15]"
              )}
            />
          </span>
          {item.href === "/city-transfers" && pendingTransfers > 0 && !item.locked && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
              {pendingTransfers > 9 ? "9+" : pendingTransfers}
            </span>
          )}
        </div>
        {!collapsed && (
          <span className="truncate flex-1 leading-snug">{label}</span>
        )}
        {!collapsed && item.locked && (
          <Lock className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-[#71717a]" aria-hidden />
        )}
        {!collapsed && item.href === "/city-transfers" && pendingTransfers > 0 && !item.locked && (
          <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
            {pendingTransfers > 99 ? "99+" : pendingTransfers}
          </span>
        )}
      </>
    );

    if (item.locked) {
      return (
        <div
          key={item.href}
          aria-disabled="true"
          title={collapsed ? `${label} — ${t("super_admin_only")}` : t("super_admin_only")}
          className={itemShellClass}
        >
          {itemBody}
        </div>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        scroll={false}
        onClick={() => setMobileOpen(false)}
        title={collapsed ? label : undefined}
        className={itemShellClass}
      >
        {itemBody}
      </Link>
    );
  };

  const renderNavContent = (navRef: React.Ref<HTMLElement>) => (
    <div className="relative flex flex-col h-full">
      {/* ── Liquid-glass specular sheen ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-white/45 via-white/10 to-transparent" />
      {/* ── Logo ── */}
      <div
        className={cn(
          "flex items-center flex-shrink-0 border-b border-white/50 bg-white/30 backdrop-blur-xl",
          collapsed ? "px-3 py-5 justify-center" : "px-4 py-5 gap-3"
        )}
      >
        <div className="flex-shrink-0 rounded-2xl bg-gradient-to-br from-white/90 to-white/55 p-1 ring-1 ring-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_6px_14px_-8px_rgba(42,6,8,0.3)]">
          <BrandLogo size={collapsed ? "sm" : "md"} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[#2A0608] font-bold text-sm leading-tight tracking-tight">MRF Hardware</p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav
        ref={navRef}
        onScroll={handleNavScroll}
        className="flex-1 overflow-y-auto overscroll-contain py-4 px-3 space-y-1.5"
      >
        {filteredGroups.map((group, gi) => {
          const isMulti = group.items.length > 1;
          const isOpen = openGroups.has(group.label);
          const sectionActive = groupContainsActive(group);

          if (collapsed) {
            return (
              <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                {gi > 0 && <div className="mx-2 mb-2 h-px bg-white/60" />}
                <div className="space-y-0.5">{group.items.map((item) => renderNavItem(item))}</div>
              </div>
            );
          }

          if (!isMulti) {
            return (
              <div key={group.label} className={gi > 0 ? "mt-2" : ""}>
                {renderNavItem(group.items[0])}
              </div>
            );
          }

          return (
            <div
              key={group.label}
              className={cn(
                "rounded-[0.875rem] border transition-[border-color,background,box-shadow] duration-200",
                gi > 0 ? "mt-2" : "",
                isOpen
                  ? "border-white/50 bg-white/20 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
                  : sectionActive
                    ? "border-white/40 bg-white/15"
                    : "border-transparent"
              )}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={isOpen}
                className={cn(
                  "w-full flex items-center gap-2 rounded-[0.875rem] px-3 py-2.5 text-left transition-[color,background,box-shadow] duration-200",
                  isOpen || sectionActive
                    ? "bg-white/50 text-[#6B0F1A] backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
                    : "text-[#52525b] hover:bg-white/40 hover:text-[#6B0F1A]"
                )}
              >
                <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.14em] truncate">
                  {group.label}
                </span>
                <span
                  className={cn(
                    "flex h-5 min-w-[1.25rem] items-center justify-center rounded-md px-1 text-[10px] font-semibold tabular-nums transition-colors duration-200",
                    sectionActive ? "bg-[#6B0F1A] text-white shadow-sm" : "bg-white/60 text-[#52525b] ring-1 ring-white/70"
                  )}
                >
                  {group.items.length}
                </span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 flex-shrink-0 text-[#6B0F1A] transition-transform duration-200",
                    isOpen && "rotate-180"
                  )}
                />
              </button>

              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="overflow-hidden">
                  <div
                    className={cn(
                      "space-y-1 pb-2 pt-1 px-1.5"
                    )}
                  >
                    {group.items.map((item) => renderNavItem(item, true))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── User Footer ── */}
      <div className="border-t border-white/50 bg-white/30 backdrop-blur-xl flex-shrink-0 p-2.5 pb-[max(1rem,env(safe-area-inset-bottom,1rem))] space-y-1">
        {/* User info */}
        {!collapsed ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-white/60 bg-white/50 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] px-3 py-3">
            <UserAvatar name={user.fullName} />
            <div className="min-w-0 flex-1">
              <p className="text-[#18181b] text-xs font-semibold truncate leading-tight">{user.fullName}</p>
              <p className="text-[#71717a] text-[10px] truncate mt-0.5">
                {user.role === "super_admin" ? "Super Admin" : `${user.cityName} Admin`}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-2">
            <UserAvatar name={user.fullName} size="sm" />
          </div>
        )}

        {/* Language switcher */}
        {!collapsed && (
          <div className="px-2 pb-0.5">
            <LangSwitcher />
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "w-full flex items-center rounded-[0.875rem] text-[13.5px] font-medium text-[#52525b] hover:text-red-600 hover:bg-red-50 transition-all duration-200",
            collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2"
          )}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className={cn(
          "lg:hidden fixed top-4 z-50 rounded-2xl border border-white/60 bg-white/60 backdrop-blur-xl p-2.5 text-[#6B0F1A] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_-12px_rgba(42,6,8,0.4)] hover:bg-white/80 transition-colors",
          isRTL ? "right-3" : "left-3"
        )}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          if ((isRTL && dx > 50) || (!isRTL && dx < -50)) setMobileOpen(false);
        }}
        className={cn(
          cn("lg:hidden fixed top-0 z-50 h-full w-[86vw] max-w-[320px] border-r shadow-2xl transform transition-transform duration-300", SIDEBAR_SHELL_MOBILE),
          isRTL ? "right-0" : "left-0",
          mobileOpen ? "translate-x-0 pointer-events-auto" : isRTL ? "translate-x-full pointer-events-none" : "-translate-x-full pointer-events-none"
        )}
      >
        <div className="relative flex h-full flex-col">
          <div className={cn("absolute top-3 z-20", isRTL ? "left-3" : "right-3")}>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="rounded-xl border border-white/60 bg-white/50 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] p-2 text-[#52525b] hover:text-[#6B0F1A] hover:bg-white/80 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">{renderNavContent(mobileNavRef)}</div>
        </div>
      </aside>

      {/* Desktop sidebar — floating liquid-glass slab */}
      <aside
        className={cn(
          "hidden lg:block fixed top-3 bottom-3 z-30 transition-all duration-300 ease-out",
          isRTL ? "right-3" : "left-3",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className={cn("relative h-full overflow-hidden rounded-[1.75rem] border", SIDEBAR_SHELL)}>
          {renderNavContent(desktopNavRef)}
        </div>

        {/* Collapse toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "absolute top-[4.5rem] h-6 w-6 rounded-full border border-white/70 bg-white/70 backdrop-blur-md flex items-center justify-center text-[#71717a] hover:text-white hover:bg-[#6B0F1A] hover:border-[#6B0F1A] transition-all duration-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_-6px_rgba(42,6,8,0.4)] z-10",
            isRTL ? "-left-3" : "-right-3"
          )}
        >
          {isRTL
            ? (collapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)
            : (collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />)}
        </button>
      </aside>
    </>
  );
}
