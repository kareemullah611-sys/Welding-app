"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LangSwitcher, useLang } from "@/lib/lang";
import { apiCall } from "@/hooks/useApi";
import NotificationBell from "@/components/layout/NotificationBell";
import {
  LayoutDashboard, Package, Factory, Banknote, Handshake,
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
      { label: "Suppliers",        key: "suppliers",        href: "/suppliers",        icon: Factory,     roles: ["super_admin"] },
      { label: "Shipping Lines",   key: "shipping_lines",   href: "/shipping-lines",   icon: Landmark,    roles: ["super_admin"] },
      { label: "Clearing Agents",  key: "agents",           href: "/agents",           icon: Handshake,   roles: ["super_admin"] },
      { label: "Intermediaries",   key: "intermediaries",   href: "/intermediaries",   icon: ArrowLeftRight, roles: ["super_admin"] },
      { label: "Investors",        key: "investors",        href: "/investors",        icon: PiggyBank,   roles: ["super_admin"] },
    ],
  },
  {
    label: "Daily Work",
    items: [
      { label: "Sales",            key: "sales",            href: "/sales",            icon: Receipt,   roles: ["city_admin"] },
      { label: "Payments",         key: "payments",         href: "/payments",         icon: Wallet,    roles: ["super_admin", "city_admin"] },
      { label: "Expenses",         key: "expenses",         href: "/expenses",         icon: Banknote,  roles: ["city_admin"] },
      { label: "Personal Expenses", key: "super_admin_personal_expenses", href: "/super-admin-personal-expenses", icon: Banknote, roles: ["super_admin"] },
      { label: "Withdrawals",      key: "personal_withdrawals", href: "/personal-withdrawals", icon: PiggyBank, roles: ["super_admin", "city_admin"] },
      { label: "Haji Transfers",   key: "haji_transfers",   href: "/haji-transfers",   icon: ArrowLeftRight, roles: ["super_admin", "city_admin"] },
      { label: "Customers",        key: "customers",        href: "/customers",        icon: Users,     roles: ["super_admin", "city_admin"] },
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
      { label: "Inventory",      key: "inventory",      href: "/inventory",      icon: ClipboardList, roles: ["city_admin"] },
      { label: "Godowns",        key: "godowns",        href: "/godowns",        icon: Warehouse,     roles: ["city_admin"] },
      { label: "City Transfers", key: "city_transfers", href: "/city-transfers", icon: ArrowLeftRight,roles: ["city_admin"] },
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
        "rounded-full bg-gradient-to-br from-[#9a3a22] via-[#b7562c] to-[#d4873e] text-white font-bold flex items-center justify-center flex-shrink-0 shadow-[0_10px_24px_-16px_rgba(154,58,34,0.85)]",
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

  const navGroups = user.role === "city_admin" ? cityAdminNavGroups : superAdminNavGroups;

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
          collapsed ? "px-3 py-5 justify-center" : "px-4 py-5 gap-3"
        )}
      >
        <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
          <svg viewBox="0 0 120 130" fill="none" className="w-8 h-8">
            <path d="M60 6 L110 22 L110 76 Q110 108 60 124 Q10 108 10 76 L10 22 Z" fill="#6B0F1A" />
            <path d="M60 6 L110 22 L110 76 Q110 108 60 124 Q10 108 10 76 L10 22 Z" stroke="#D4AF37" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <text x="60" y="76" textAnchor="middle" dominantBaseline="central" fontFamily="Georgia, serif" fontWeight="bold" fontSize="40" fill="#F5E6D3">MRF</text>
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight tracking-tight">MRF Hardware</p>
            <p className="text-[#8f9ab1] text-[10px] uppercase tracking-[0.24em] mt-0.5">Operations Suite</p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-0.5">
        {filteredGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
            {/* Section label */}
            {!collapsed ? (
              <p className="px-2 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6f7b93] select-none">
                {group.label}
              </p>
            ) : (
              gi > 0 && <div className="mx-2 mb-2 mt-2 h-px bg-white/10" />
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
                    "group relative flex items-center rounded-2xl text-[13px] font-medium transition-all duration-200",
                    collapsed ? "justify-center px-0 py-2.5 mx-0" : "gap-2.5 px-3 py-2",
                    isActive
                      ? "bg-[linear-gradient(135deg,rgba(154,58,34,0.95),rgba(207,127,66,0.92))] text-white shadow-[0_18px_36px_-24px_rgba(183,86,44,0.9)]"
                      : "text-[#98a4bc] hover:text-white hover:bg-white/[0.06]"
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
                          ? "text-[#fff4dc]"
                          : "text-[#657089] group-hover:text-[#d4deef]"
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
          <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <UserAvatar name={user.fullName} />
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate leading-tight">{user.fullName}</p>
              <p className="text-[#8f9ab1] text-[10px] truncate mt-0.5">
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
            "w-full flex items-center rounded-2xl text-[13px] text-[#8f9ab1] hover:text-red-300 hover:bg-red-500/10 transition-all duration-150",
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
          "lg:hidden fixed top-4 z-50 rounded-2xl border border-white/10 bg-[#111722]/90 p-2.5 text-[#c2cede] shadow-2xl backdrop-blur-xl hover:text-white transition-colors",
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
          "lg:hidden fixed top-0 z-50 h-full w-72 bg-[linear-gradient(180deg,#0b111d_0%,#121a28_46%,#0f1520_100%)] border-r border-white/10 shadow-2xl transform transition-transform duration-300",
          isRTL ? "right-0" : "left-0",
          mobileOpen ? "translate-x-0" : isRTL ? "translate-x-full" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:block fixed top-0 h-full bg-[linear-gradient(180deg,#0a111b_0%,#111826_55%,#0f1520_100%)] border-r border-white/10 transition-all duration-300 z-30 shadow-[24px_0_80px_-54px_rgba(7,10,18,0.9)]",
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
            "absolute top-[4.75rem] h-6 w-6 rounded-full border border-white/10 bg-[#111722] flex items-center justify-center text-[#95a1b9] hover:text-white hover:bg-[#a54425] transition-all duration-150 shadow-lg z-10",
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
