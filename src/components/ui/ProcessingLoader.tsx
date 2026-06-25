"use client";

import React from "react";
import { BrandLoader, InlineSpinner } from "@/components/ui/BrandLoader";
import { cn } from "@/lib/utils";

/** @deprecated Login no longer forces a minimum overlay duration */
export const MIN_LOGIN_DURATION = 0;

export interface ProcessingLoaderProps {
  variant?: "login" | "global";
  visible?: boolean;
  onAnimationComplete?: () => void;
  label?: string;
  className?: string;
  productImageSrc?: string;
}

/** Inline spinner for tables and dense UI */
export function ProcessingSpinner({
  size = "md",
  label,
  className,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  const spinnerClass =
    size === "sm" ? "h-4 w-4 border-[1.5px]" : size === "lg" ? "h-6 w-6 border-2" : "h-5 w-5 border-2";

  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span
        className={cn(
          "inline-block rounded-full border-[#6B0F1A]/20 border-t-[#6B0F1A] animate-spin motion-reduce:animate-none",
          spinnerClass
        )}
        aria-hidden="true"
      />
      {label ? <p className="m-0 text-xs font-medium text-neutral-500">{label}</p> : null}
    </div>
  );
}

export default function ProcessingLoader({
  visible = false,
  label = "Processing",
  className,
}: ProcessingLoaderProps) {
  if (!visible) return null;
  return <BrandLoader fullscreen size="lg" label={label} className={className} />;
}

export { InlineSpinner };
