"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Theme, useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const options: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    const index = options.findIndex((option) => option.value === theme);
    const next = options[(index + 1) % options.length];
    const CurrentIcon = options[index]?.icon || Monitor;
    return (
      <button
        type="button"
        onClick={() => setTheme(next.value)}
        className="theme-compact-control mx-auto flex h-9 w-9 items-center justify-center rounded-xl border border-white/60 bg-white/45 text-[#52525b] transition-colors hover:bg-white/70 hover:text-[#6B0F1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        aria-label={`Theme: ${options[index]?.label || "System"}. Switch to ${next.label}`}
        title={`Theme: ${options[index]?.label || "System"}`}
      >
        <CurrentIcon className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <div className="theme-switcher grid grid-cols-3 gap-1 rounded-xl border border-white/60 bg-white/35 p-1" role="group" aria-label="Color theme">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          className={cn(
            "flex min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
            theme === value
              ? "bg-[#6B0F1A] text-white shadow-sm"
              : "text-[#52525b] hover:bg-white/60 hover:text-[#18181b]"
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
