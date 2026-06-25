"use client";

import BrandLogo from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";

type BrandLoaderSize = "sm" | "md" | "lg";

const ringSize: Record<BrandLoaderSize, string> = {
  sm: "h-10 w-10",
  md: "h-16 w-16",
  lg: "h-[5.75rem] w-[5.75rem]",
};

const logoSize: Record<BrandLoaderSize, "sm" | "md" | "lg"> = {
  sm: "sm",
  md: "md",
  lg: "lg",
};

export function BrandLoader({
  size = "md",
  label,
  fullscreen = false,
  className,
}: {
  size?: BrandLoaderSize;
  label?: string;
  fullscreen?: boolean;
  className?: string;
}) {
  const core = (
    <div
      className={cn("flex flex-col items-center gap-4", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={cn("relative flex items-center justify-center", ringSize[size])}>
        <div
          className="absolute inset-0 rounded-full border-2 border-[#6B0F1A]/12 border-t-[#6B0F1A]/75 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <div
          className="absolute inset-[18%] rounded-full border border-[#D4AF37]/35"
          aria-hidden="true"
        />
        <BrandLogo size={logoSize[size]} className="relative z-10 drop-shadow-sm" />
      </div>
      {label ? (
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[#6B0F1A]">{label}</p>
      ) : null}
    </div>
  );

  if (!fullscreen) return core;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[radial-gradient(circle_at_50%_35%,#fafafa_0%,#f0f0f2_55%,#e8e8ec_100%)]">
      {core}
    </div>
  );
}

/** Minimal inline spinner for buttons — no images, single CSS ring */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 rounded-full border-2 border-white/35 border-t-white animate-spin motion-reduce:animate-none",
        className
      )}
      aria-hidden="true"
    />
  );
}
