"use client";

import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { resolvedTheme, toggle } = useTheme();
  const isDark = resolvedTheme === "dark";

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#c2cede] transition-colors hover:bg-white/[0.08] hover:text-white",
          className
        )}
      >
        {isDark ? <Sun className="h-[15px] w-[15px]" /> : <Moon className="h-[15px] w-[15px]" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-[#98a4bc] transition-all hover:border-white/[0.1] hover:bg-white/[0.06] hover:text-white",
        className
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06] transition-colors group-hover:bg-white/[0.08]">
        {isDark ? <Sun className="h-[14px] w-[14px] text-amber-300" /> : <Moon className="h-[14px] w-[14px] text-indigo-300" />}
      </span>
      <span className="flex-1 text-left">{isDark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
