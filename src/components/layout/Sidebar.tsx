"use client";

import React, { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LangSwitcher, useLang } from "@/lib/lang";
import {
  LayoutDashboard, Package, Tag, Factory, Banknote, Handshake,
  BookOpen, Receipt, Wallet, Users, Warehouse, ClipboardList,
  ArrowLeftRight, TrendingUp, BarChart2, FileText, Search,
  Activity, Settings, LogOut, ChevronLeft, ChevronRight,
  Menu, type LucideIcon,
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
      { label: "Country Ledger",   key: "country_ledger",   href: "/country-ledger",   icon: BookOpen,    roles: ["super_admin"] },
    ],
  },
  {
    label: "Sales & Finance",
    items: [
      { label: "Sales",     key: "sales",     href: "/sales",     icon: Receipt, roles: ["super_admin", "city_admin"] },
      { label: "Payments",  key: "payments",  href: "/payments",  icon: Wallet,  roles: ["super_admin", "city_admin"] },
      { label: "Customers", key: "customers", href: "/customers", icon: Users,   roles: ["super_admin", "city_admin"] },
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
      { label: "Profit Report",    key: "profit_report",    href: "/profit-report", icon: TrendingUp, roles: ["super_admin"] },
      { label: "Financial Reports",key: "financial_reports",href: "/accounts",      icon: BarChart2,  roles: ["super_admin"] },
      { label: "Reports",          key: "reports",          href: "/reports",       icon: FileText,   roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Search",        key: "search",        href: "/search",        icon: Search,   roles: ["super_admin", "city_admin"] },
      { label: "Activity Feed", key: "activity_feed", href: "/activity-feed", icon: Activity, roles: ["super_admin", "city_admin"] },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", key: "settings", href: "/settings", icon: Settings, roles: ["super_admin"] },
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
        "rounded-full bg-primary-600 text-white font-semibold flex items-center justify-center flex-shrink-0 ring-2 ring-primary-500/30",
        size === "md" ? "w-8 h-8 text-xs" : "w-7 h-7 text-[10px]"
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

  if (!user) return null;

  const filteredGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) }))
    .filter((g) => g.items.length > 0);

  const navContent = (
    <div className="flex flex-col h-full">
      {/* ── Logo ── */}
      <div
        className={cn(
          "flex items-center border-b border-slate-800 flex-shrink-0",
          collapsed ? "px-3 py-4 justify-center" : "px-4 py-4 gap-3"
        )}
      >
        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-md">
          W
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">Welding Materials</p>
            <p className="text-slate-500 text-[10px] uppercase tracking-[0.12em] mt-0.5">Management System</p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {filteredGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-5" : "mt-1"}>
            {/* Section label */}
            {!collapsed ? (
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 select-none">
                {group.label}
              </p>
            ) : (
              gi > 0 && <div className="h-px bg-slate-800 mx-2 mb-3" />
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
                    "group relative flex items-center rounded-lg text-[13px] font-medium transition-all duration-150 mb-0.5",
                    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
                    isActive
                      ? "bg-sidebar-active text-sidebar-textActive"
                      : "text-sidebar-text hover:text-white hover:bg-sidebar-hover"
                  )}
                >
                  {/* Active left accent */}
                  {isActive && !collapsed && (
                    <span
                      className={cn(
                        "absolute inset-y-1.5 w-[3px] rounded-full bg-primary-400",
                        isRTL ? "right-0" : "left-0"
                      )}
                    />
                  )}
                  <Icon
                    className={cn(
                      "flex-shrink-0 w-[17px] h-[17px] transition-colors",
                      isActive
                        ? "text-primary-400"
                        : "text-slate-500 group-hover:text-slate-300"
                    )}
                  />
                  {!collapsed && (
                    <span className="truncate">{t(item.key)}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── User Footer ── */}
      <div className="border-t border-slate-800 flex-shrink-0 p-2 space-y-1">
        {/* User info */}
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <UserAvatar name={user.fullName} />
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate leading-tight">{user.fullName}</p>
              <p className="text-slate-500 text-[10px] truncate mt-0.5">
                {user.role === "super_admin" ? "Super Admin" : `${user.cityName} Admin`}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1.5">
            <UserAvatar name={user.fullName} size="sm" />
          </div>
        )}

        {/* Language switcher */}
        {!collapsed && (
          <div className="px-2 pt-0.5 pb-1">
            <LangSwitcher />
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "w-full flex items-center rounded-lg text-[13px] text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150",
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
          "lg:hidden fixed top-3 z-50 p-2 bg-slate-900 text-white rounded-lg shadow-lg border border-slate-700",
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
          "lg:hidden fixed top-0 z-50 h-full w-64 bg-sidebar-bg shadow-2xl transform transition-transform duration-300",
          isRTL ? "right-0" : "left-0",
          mobileOpen ? "translate-x-0" : isRTL ? "translate-x-full" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:block fixed top-0 h-full bg-sidebar-bg shadow-xl transition-all duration-200 z-30",
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
            "absolute top-[4.5rem] w-5 h-5 bg-slate-800 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-primary-600 transition-all duration-150 border border-slate-700 shadow-md z-10",
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
