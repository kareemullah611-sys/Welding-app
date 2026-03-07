"use client";

import React from "react";
import { useAuth } from "@/hooks/useAuth";
import Sidebar from "@/components/layout/Sidebar";
import { LangProvider, useLang } from "@/lib/lang";

function AppInner({ children }: { children: React.ReactNode }) {
  const { dir } = useLang();
  const isRTL = dir === "rtl";
  return (
    <div className="min-h-screen bg-gray-50" dir={dir}>
      <Sidebar />
      <main className={`${isRTL ? "lg:pr-60" : "lg:pl-60"} min-h-screen`}>
        <div className="p-4 lg:p-6 pt-14 lg:pt-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <LangProvider>
      <AppInner>{children}</AppInner>
    </LangProvider>
  );
}
