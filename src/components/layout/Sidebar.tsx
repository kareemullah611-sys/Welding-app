"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LangSwitcher, useLang } from "@/lib/lang";
import { apiCall } from "@/hooks/useApi";
import NotificationBell from "@/components/layout/NotificationBell";
import {
  LayoutDashboard, Package, Tag, Factory, Banknote, Handshake,
  BookOpen, Receipt, Wallet, Users, Warehouse, ClipboardList,
  ArrowLeftRight, TrendingUp, BarChart2, FileText, Search,
  Activity, Settings, LogOut, ChevronLeft, ChevronRight,
  Menu, FileCheck, Landmark, BotMessageSquare, PiggyBank, type LucideIcon,
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

// ─── Nav Config ───────────────────────────────────────────────────────────────
interface NavItemDef {
  label: string;
  key: string;
  href: string;
  icon: LucideIcon;
  roles: string[];
}

const navGroups: { label: string; items: NavItemDef[] }[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", key: "dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "Procurement",
    items: [
      { label: "Lots",             key: "lots",             href: "/lots",             icon: Package,     roles: ["super_admin"] },
      { label: "Lot Costing",      key: "lot_costing",      href: "/lot-costing",      icon: Tag,         roles: ["super_admin"] },
      { label: "Suppliers",        key: "suppliers",        href: "/suppliers",        icon: Factory,     roles: ["super_admin"] },
      { label: "Company Payments", key: "company_payments", href: "/supplier-payments",icon: Banknote,    roles: ["super_admin"] },
      { label: "Agents",           key: "agents",           href: "/agents",           icon: Handshake,   roles: ["super_admin"] },
      { label: "Investors",        key: "investors",        href: "/investors",        icon: PiggyBank,   roles: ["super_admin"] },
    ],
  },
  {
    label: "Sales & Finance",
    items: [
      { label: "Sales",            key: "sales",            href: "/sales",            icon: Receipt,   roles: ["super_admin", "city_admin"] },
      { label: "Payments",         key: "payments",         href: "/payments",         icon: Wallet,    roles: ["super_admin", "city_admin"] },
      { label: "Customers",        key: "customers",        href: "/customers",        icon: Users,     roles: ["super_admin", "city_admin"] },
      { label: "Cheque Register",  key: "cheque_register",  href: "/cheques",          icon: FileCheck, roles: ["city_admin"] },
      { label: "Bank Deposits",    key: "bank_deposits",    href: "/bank-deposits",    icon: Landmark,  roles: ["city_admin"] },
    ],
  },
  {
    label: "Warehouse",
    items: [
      { label: "Godowns",        key: "godowns",        href: "/godowns",        icon: Warehouse,     roles: ["super_admin", "city_admin"] },
      { label: "Inventory",      key: "inventory",      href: "/inventory",      icon: ClipboardList, roles: ["super_admin", "city_admin"] },
      { label: "City Transfers", key: "city_transfers", href: "/city-transfers", icon: ArrowLeftRight,roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Analytics",        key: "analytics",        href: "/analytics",     icon: BarChart2,  roles: ["super_admin", "city_admin"] },
      { label: "Profit Report",    key: "profit_report",    href: "/profit-report", icon: TrendingUp, roles: ["super_admin"] },
      { label: "Financial Reports",key: "financial_reports",href: "/accounts",      icon: BookOpen,   roles: ["super_admin"] },
      { label: "Reports",          key: "reports",          href: "/reports",       icon: FileText,   roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Search",        key: "search",        href: "/search",        icon: Search,          roles: ["super_admin", "city_admin"] },
      { label: "Activity Feed", key: "activity_feed", href: "/activity-feed", icon: Activity,        roles: ["super_admin", "city_admin"] },
      { label: "AI Assistant",  key: "assistant",     href: "/assistant",     icon: BotMessageSquare,roles: ["super_admin"] },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings",      key: "settings",      href: "/settings",              icon: Settings, roles: ["super_admin"] },
      { label: "Bank Accounts", key: "bank_accounts",  href: "/settings/bank-accounts", icon: Landmark, roles: ["city_admin"] },
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
        "rounded-full bg-violet-600 text-white font-bold flex items-center justify-center flex-shrink-0",
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

  useEffect(() => {
    if (user?.role !== "city_admin") return;
    const fetchPending = () =>
      apiCall<any>("/api/v1/city-transfers", { params: { status: "pending", direction: "incoming", limit: 1 } })
        .then((r) => { if (r.success) setPendingTransfers((r.pagination as any)?.total ?? 0); });
    fetchPending();
    const interval = setInterval(fetchPending, 60000);
    return () => clearInterval(interval);
  }, [user]);

  if (!user) return null;

  const isAfghanistan = user.countryName === "Afghanistan";
  const afghHide = ["cheque_register", "bank_deposits", "bank_accounts"];

  const filteredGroups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => i.roles.includes(user.role) && !(isAfghanistan && afghHide.includes(i.key))
      ),
    }))
    .filter((g) => g.items.length > 0);

  const navContent = (
    <div className="flex flex-col h-full">
      {/* ── Logo ── */}
      <div
        className={cn(
          "flex items-center flex-shrink-0 border-b border-sidebar-border",
          collapsed ? "px-3 py-[18px] justify-center" : "px-4 py-[18px] gap-3"
        )}
      >
        <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 120 130" fill="none" className="w-8 h-8">
            <path d="M60 6 L110 22 L110 76 Q110 108 60 124 Q10 108 10 76 L10 22 Z" fill="#6B0F1A" />
            <path d="M60 6 L110 22 L110 76 Q110 108 60 124 Q10 108 10 76 L10 22 Z" stroke="#D4AF37" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <text x="60" y="76" textAnchor="middle" dominantBaseline="central" fontFamily="Georgia, serif" fontWeight="bold" fontSize="40" fill="#F5E6D3">MRF</text>
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight tracking-tight">MRF Hardware</p>
            <p className="text-[#4A5166] text-[10px] uppercase tracking-widest mt-0.5">Management</p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {filteredGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
            {/* Section label */}
            {!collapsed ? (
              <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#3E4459] select-none">
                {group.label}
              </p>
            ) : (
              gi > 0 && <div className="h-px bg-sidebar-border mx-2 mb-2 mt-2" />
            )}

            {/* Items */}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center rounded-xl text-[13px] font-medium transition-all duration-150",
                    collapsed ? "justify-center px-0 py-2.5 mx-0" : "gap-2.5 px-3 py-2",
                    isActive
                      ? "bg-violet-600/[0.18] text-white"
                      : "text-sidebar-text hover:text-white hover:bg-white/[0.05]"
                  )}
                >
                  {/* Active left accent */}
                  {isActive && !collapsed && (
                    <span
                      className={cn(
                        "absolute inset-y-2 w-[3px] rounded-full bg-violet-400",
                        isRTL ? "right-0" : "left-0"
                      )}
                    />
                  )}
                  <div className="relative flex-shrink-0">
                    <Icon
                      className={cn(
                        "w-[16px] h-[16px] transition-colors",
                        isActive
                          ? "text-violet-400"
                          : "text-[#505870] group-hover:text-[#9BA3B8]"
                      )}
                    />
                    {item.href === "/city-transfers" && pendingTransfers > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                        {pendingTransfers > 9 ? "9+" : pendingTransfers}
                      </span>
                    )}
                  </div>
                  {!collapsed && (
                    <span className="truncate flex-1 leading-none">{t(item.key)}</span>
                  )}
                  {!collapsed && item.href === "/city-transfers" && pendingTransfers > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
                      {pendingTransfers > 99 ? "99+" : pendingTransfers}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── User Footer ── */}
      <div className="border-t border-sidebar-border flex-shrink-0 p-2 space-y-0.5">
        {/* User info */}
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl">
            <UserAvatar name={user.fullName} />
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate leading-tight">{user.fullName}</p>
              <p className="text-[#4A5166] text-[10px] truncate mt-0.5">
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

        {/* Notification Bell */}
        {!collapsed ? (
          <div className="px-2 pb-0.5">
            <NotificationBell sidebarMode />
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <NotificationBell sidebarMode compact />
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "w-full flex items-center rounded-xl text-[13px] text-[#505870] hover:text-red-400 hover:bg-red-500/10 transition-all duration-150",
            collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"
          )}
        >
          <LogOut className="w-[15px] h-[15px] flex-shrink-0" />
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
          "lg:hidden fixed top-3 z-50 p-2 bg-sidebar-bg text-sidebar-text rounded-xl shadow-lg border border-sidebar-border hover:text-white transition-colors",
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
        className={cn(
          "lg:hidden fixed top-0 z-50 h-full w-64 bg-sidebar-bg border-r border-sidebar-border shadow-2xl transform transition-transform duration-300",
          isRTL ? "right-0" : "left-0",
          mobileOpen ? "translate-x-0" : isRTL ? "translate-x-full" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:block fixed top-0 h-full bg-sidebar-bg border-r border-sidebar-border transition-all duration-200 z-30",
          isRTL ? "right-0" : "left-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {navContent}

        {/* Collapse toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "absolute top-[4.5rem] w-5 h-5 bg-[#1A1D27] rounded-full flex items-center justify-center text-[#505870] hover:text-white hover:bg-violet-600 transition-all duration-150 border border-sidebar-border shadow-lg z-10",
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
