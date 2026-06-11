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
  BookOpen, Receipt, Wallet, Users, Warehouse, ClipboardList,
  ArrowLeftRight, TrendingUp, BarChart2, FileText, Search,
  Activity, Settings, LogOut, ChevronLeft, ChevronRight,
  Menu, FileCheck, Landmark, BotMessageSquare, PiggyBank, X, ChevronDown, type LucideIcon,
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
  "bg-[#F0F0F2] border-[#D4D4D8] shadow-[4px_0_28px_-8px_rgba(42,6,8,0.1)]";

// ─── Nav Config ───────────────────────────────────────────────────────────────
interface NavItemDef {
  label: string;
  key: string;
  href: string;
  icon: LucideIcon;
  roles: string[];
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
      { label: "Lots",             key: "lots",             href: "/lots",             icon: Package,     roles: ["super_admin"] },
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
      { label: "Godowns",        key: "godowns",        href: "/godowns",        icon: Warehouse,     roles: ["city_admin"] },
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
      { label: "Activity Feed", key: "activity_feed", href: "/activity-feed", icon: Activity,        roles: ["super_admin", "city_admin"] },
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
    label: "Daily Work",
    items: [
      { label: "Dashboard",       key: "dashboard",             href: "/dashboard",             icon: LayoutDashboard, roles: ["city_admin"] },
      { label: "Sales",           key: "sales",                 href: "/sales",                 icon: Receipt,         roles: ["city_admin"] },
      { label: "Payments",        key: "payments",              href: "/payments",              icon: Wallet,          roles: ["city_admin"] },
      { label: "Expenses",        key: "expenses",              href: "/expenses",              icon: Banknote,        roles: ["city_admin"] },
      { label: "Withdrawals",     key: "personal_withdrawals",  href: "/personal-withdrawals",  icon: PiggyBank,       roles: ["city_admin"] },
      { label: "Haji Transfers",  key: "haji_transfers",        href: "/haji-transfers",        icon: ArrowLeftRight,  roles: ["city_admin"] },
      { label: "Customers",       key: "customers",             href: "/customers",             icon: Users,           roles: ["city_admin"] },
    ],
  },
  {
    label: "Stock",
    items: [
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
    label: "Reports",
    items: [
      { label: "Reports", key: "reports", href: "/reports", icon: FileText, roles: ["city_admin"] },
      { label: "Audit", key: "audit", href: "/activity-feed", icon: Activity, roles: ["city_admin"] },
      { label: "Openings", key: "openings", href: "/openings", icon: ClipboardList, roles: ["city_admin"] },
      { label: "Settings", key: "settings", href: "/settings", icon: Settings, roles: ["city_admin"] },
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
    const isActive = item.href === activeHref;
    const label =
      (() => {
        const translated = t(item.key);
        return translated === item.key ? item.label : translated;
      })();

    return (
      <Link
        key={item.href}
        href={item.href}
        scroll={false}
        onClick={() => setMobileOpen(false)}
        title={collapsed ? label : undefined}
        className={cn(
          "group relative flex items-center rounded-xl text-[13px] font-semibold transition-all duration-200",
          collapsed ? "justify-center px-0 py-2.5 mx-0" : cn("gap-2.5", nested ? "pl-3 pr-3 ml-1 py-2" : "px-3 py-2.5"),
          isActive
            ? "bg-[linear-gradient(135deg,#6B0F1A_0%,#8B1A1A_100%)] text-white shadow-[0_8px_20px_-8px_rgba(107,15,26,0.45)]"
            : "text-[#3f3f46] bg-white border border-[#E4E4E7] hover:text-[#18181b] hover:border-[#A1A1AA] hover:shadow-sm"
        )}
      >
        {isActive && !collapsed && (
          <span
            className={cn(
              "absolute inset-y-2 w-[3px] rounded-full bg-[#3B82F6]",
              isRTL ? "right-0" : "left-0"
            )}
          />
        )}
        <div className="relative flex-shrink-0">
          <Icon
            className={cn(
              nested ? "w-[15px] h-[15px]" : "w-[17px] h-[17px]",
              "transition-colors",
              isActive ? "text-white" : "text-[#6B0F1A] group-hover:text-[#6B0F1A]"
            )}
          />
          {item.href === "/city-transfers" && pendingTransfers > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
              {pendingTransfers > 9 ? "9+" : pendingTransfers}
            </span>
          )}
        </div>
        {!collapsed && <span className="truncate flex-1 leading-none">{label}</span>}
        {!collapsed && item.href === "/city-transfers" && pendingTransfers > 0 && (
          <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
            {pendingTransfers > 99 ? "99+" : pendingTransfers}
          </span>
        )}
      </Link>
    );
  };

  const renderNavContent = (navRef: React.Ref<HTMLElement>) => (
    <div className="flex flex-col h-full">
      {/* ── Logo ── */}
      <div
        className={cn(
          "flex items-center flex-shrink-0 border-b border-[#D4D4D8] bg-white",
          collapsed ? "px-3 py-5 justify-center" : "px-4 py-5 gap-3"
        )}
      >
        <div className="flex-shrink-0 rounded-2xl bg-white p-1 ring-1 ring-[#E4E4E7] shadow-sm">
          <BrandLogo size={collapsed ? "sm" : "md"} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[#2A0608] font-bold text-sm leading-tight tracking-tight">MRF Hardware</p>
            <p className="text-[#71717a] text-[10px] uppercase tracking-[0.24em] mt-0.5">Operations Suite</p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav
        ref={navRef}
        onScroll={handleNavScroll}
        className="flex-1 overflow-y-auto overscroll-contain py-4 px-2.5 space-y-1"
      >
        {filteredGroups.map((group, gi) => {
          const isMulti = group.items.length > 1;
          const isOpen = openGroups.has(group.label);
          const sectionActive = groupContainsActive(group);

          if (collapsed) {
            return (
              <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                {gi > 0 && <div className="mx-2 mb-2 h-px bg-[#D4D4D8]" />}
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
                "rounded-xl border transition-colors duration-200",
                gi > 0 ? "mt-2" : "",
                isOpen ? "border-[#D4D4D8] bg-white" : "border-transparent"
              )}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={isOpen}
                className={cn(
                  "w-full flex items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-200",
                  isOpen || sectionActive
                    ? "bg-[#E4E4E7] text-[#6B0F1A]"
                    : "text-[#52525b] hover:bg-[#E4E4E7] hover:text-[#6B0F1A]"
                )}
              >
                <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.2em] truncate">
                  {group.label}
                </span>
                <span
                  className={cn(
                    "flex h-5 min-w-[1.25rem] items-center justify-center rounded-md px-1 text-[10px] font-semibold tabular-nums",
                    sectionActive ? "bg-[#6B0F1A] text-white" : "bg-[#D4D4D8] text-[#52525b]"
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
                      "space-y-0.5 pb-2 pt-0.5",
                      isRTL ? "pr-1 pl-2 border-r-2 border-[#D4D4D8] mr-2" : "pl-1 pr-2 border-l-2 border-[#D4D4D8] ml-2"
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
      <div className="border-t border-[#D4D4D8] bg-white flex-shrink-0 p-2.5 pb-[max(1rem,env(safe-area-inset-bottom,1rem))] space-y-1">
        {/* User info */}
        {!collapsed ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-[#D4D4D8] bg-[#FAFAFA] px-3 py-3">
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
            "w-full flex items-center rounded-xl text-[13px] font-medium text-[#52525b] hover:text-red-600 hover:bg-red-50 transition-all duration-150",
            collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"
          )}
        >
          <LogOut className="w-[15px] h-[15px] flex-shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  const mobileLabel = user.role === "super_admin" ? "Super Admin" : `${user.cityName} Admin`;

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className={cn(
          "lg:hidden fixed top-4 z-50 rounded-2xl border border-[#D4D4D8] bg-white p-2.5 text-[#6B0F1A] shadow-lg hover:bg-[#FAFAFA] transition-colors",
          isRTL ? "right-3" : "left-3"
        )}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
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
          cn("lg:hidden fixed top-0 z-50 h-full w-[86vw] max-w-[320px] border-r shadow-2xl transform transition-transform duration-300", SIDEBAR_SHELL),
          isRTL ? "right-0" : "left-0",
          mobileOpen ? "translate-x-0 pointer-events-auto" : isRTL ? "translate-x-full pointer-events-none" : "-translate-x-full pointer-events-none"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-3 py-3 border-b border-[#D4D4D8] bg-white">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B0F1A]">Navigation</p>
              <p className="text-sm font-semibold text-[#18181b] truncate">{mobileLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="rounded-xl border border-[#D4D4D8] bg-[#F0F0F2] p-2 text-[#52525b] hover:text-[#6B0F1A] hover:bg-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">{renderNavContent(mobileNavRef)}</div>
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          cn("hidden lg:block fixed top-0 h-full border-r transition-all duration-300 z-30", SIDEBAR_SHELL),
          isRTL ? "right-0" : "left-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {renderNavContent(desktopNavRef)}

        {/* Collapse toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "absolute top-[4.75rem] h-6 w-6 rounded-full border border-[#D4D4D8] bg-white flex items-center justify-center text-[#71717a] hover:text-white hover:bg-[#6B0F1A] hover:border-[#6B0F1A] transition-all duration-150 shadow-md z-10",
            isRTL ? "-left-2.5" : "-right-2.5"
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
