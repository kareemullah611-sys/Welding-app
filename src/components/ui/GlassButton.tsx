"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type GlassButtonVariant = "primary" | "secondary" | "danger" | "xlsx" | "pdf" | "warning";

export type GlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GlassButtonVariant;
};

export function GlassButton({
  variant = "primary",
  className,
  type = "button",
  children,
  ...props
}: GlassButtonProps) {
  return (
    <button
      type={type}
      className={cn("glass-btn", `glass-btn-${variant}`, className)}
      {...props}
    >
      {children}
    </button>
  );
}
