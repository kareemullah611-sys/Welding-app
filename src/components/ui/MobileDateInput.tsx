"use client";

import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/display-date";

type MobileDateInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  closeOnSelect?: boolean;
  variant?: "filter" | "field";
  "aria-label"?: string;
};

export function MobileDateInput({
  value,
  onChange,
  placeholder = "Select date",
  className,
  closeOnSelect = false,
  variant = "field",
  "aria-label": ariaLabel,
}: MobileDateInputProps) {
  const display = value ? formatDisplayDate(value) : null;
  const displayText = display && display !== "-" ? display : placeholder;
  const hasValue = Boolean(value);

  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center overflow-hidden rounded-xl border border-[#d4d4d8] bg-[rgba(255,255,255,0.9)] shadow-[0_12px_30px_-24px_rgba(24,24,27,0.2)] transition-all duration-200 hover:border-[#a1a1aa] focus-within:border-primary-600 focus-within:ring-2 focus-within:ring-primary-500/25",
        variant === "filter" && "h-9 w-[9rem] shrink-0 px-3 text-sm",
        variant === "field" && "h-11 w-full px-3 text-sm",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none w-full select-none truncate tabular-nums",
          hasValue ? "text-gray-800" : "text-zinc-400",
        )}
      >
        {displayText}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (closeOnSelect) e.currentTarget.blur();
        }}
        aria-label={ariaLabel || placeholder}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-[0.01] [color-scheme:light]"
      />
    </label>
  );
}
