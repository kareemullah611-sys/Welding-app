"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LangSwitcher, useLang } from "@/lib/lang";

const iconSize = "w-5 h-5";

const navItems = [
  { label: "Dashboard", key: "dashboard", href: "/dashboard", icon: "📊", roles: ["super_admin", "city_admin"] },
  { label: "Lots", key: "lots", href: "/lots", icon: "📦", roles: ["super_admin"] },
  { label: "Lot Costing", key: "lot_costing", href: "/lot-costing", icon: "🏷️", roles: ["super_admin"] },
  { label: "Suppliers", key: "suppliers", href: "/suppliers", icon: "🏭", roles: ["super_admin"] },
  { label: "Company Payments", key: "company_payments", href: "/supplier-payments", icon: "💵", roles: ["super_admin"] },
  { label: "Agents", key: "agents", href: "/agents", icon: "🤝", roles: ["super_admin"] },
  { label: "Country Ledger", key: "country_ledger", href: "/country-ledger", icon: "📒", roles: ["super_admin"] },
  { label: "Sales", key: "sales", href: "/sales", icon: "🧾", roles: ["super_admin", "city_admin"] },
  { label: "Payments", key: "payments", href: "/payments", icon: "💰", roles: ["super_admin", "city_admin"] },
  { label: "Customers", key: "customers", href: "/customers", icon: "👥", roles: ["super_admin", "city_admin"] },
  { label: "Godowns", key: "godowns", href: "/godowns", icon: "🏗️", roles: ["super_admin", "city_admin"] },
  { label: "Inventory", key: "inventory", href: "/inventory", icon: "📋", roles: ["super_admin", "city_admin"] },
  { label: "City Transfers", key: "city_transfers", href: "/city-transfers", icon: "🔄", roles: ["super_admin", "city_admin"] },
  { label: "Profit Report", key: "profit_report", href: "/profit-report", icon: "📈", roles: ["super_admin"] },
  { label: "Financial Reports", key: "financial_reports", href: "/accounts", icon: "📊", roles: ["super_admin"] },
  { label: "Reports", key: "reports", href: "/reports", icon: "📄", roles: ["super_admin", "city_admin"] },
  { label: "Search", key: "search", href: "/search", icon: "🔍", roles: ["super_admin", "city_admin"] },
  { label: "Activity Feed", key: "activity_feed", href: "/activity-feed", icon: "📰", roles: ["super_admin", "city_admin"] },
  { label: "Settings", key: "settings", href: "/settings", icon: "⚙️", roles: ["super_admin"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { t, dir } = useLang();
  const isRTL = dir === "rtl";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  const filteredNav = navItems.filter((item) => item.roles.includes(user.role));

  const NavContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            W
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-white font-semibold text-sm leading-tight">Welding Materials</h1>
              <p className="text-slate-400 text-xs">Management System</p>
            </div>
          )}
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-slate-700">
        {!collapsed && (
          <>
            <p className="text-white text-sm font-medium truncate">{user.fullName}</p>
            <p className="text-slate-400 text-xs">
              {user.role === "super_admin" ? "Super Admin" : `${user.cityName} Admin`}
            </p>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {filteredNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-colors ${
                isActive
                  ? "bg-primary-600/20 text-primary-300 font-medium"
                  : "text-slate-400 hover:text-white hover:bg-slate-700/50"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {!collapsed && <span>{t(item.key)}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Language & Logout */}
      <div className="px-2 py-3 border-t border-slate-700">
        {!collapsed && <div className="px-3 mb-2"><LangSwitcher /></div>}
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
        >
          <span className="text-base">🚪</span>
          {!collapsed && <span>{t("logout")}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className={`lg:hidden fixed top-3 ${isRTL ? "right-3" : "left-3"} z-50 p-2 bg-slate-800 text-white rounded-lg`}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`lg:hidden fixed top-0 ${isRTL ? "right-0" : "left-0"} z-50 h-full w-64 bg-sidebar-bg transform transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : (isRTL ? "translate-x-full" : "-translate-x-full")
        }`}
      >
        <NavContent />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:block fixed top-0 ${isRTL ? "right-0" : "left-0"} h-full bg-sidebar-bg transition-all duration-200 z-30 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <NavContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`absolute ${isRTL ? "-left-3" : "-right-3"} top-8 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center text-slate-400 hover:text-white text-xs border border-slate-600`}
        >
          {isRTL ? (collapsed ? "←" : "→") : (collapsed ? "→" : "←")}
        </button>
      </aside>
    </>
  );
}
