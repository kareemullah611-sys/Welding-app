"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  alt?: string;
}

const sizeMap = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-20 w-20",
};

/** Vector MRF mark — aligned with /app/icon.tsx (burgundy gradient + gold frame). */
export default function BrandLogo({
  size = "md",
  className,
  alt = "MRF Hardware",
}: BrandLogoProps) {
  const gradId = useId().replace(/:/g, "");

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("flex-shrink-0", sizeMap[size], className)}
      role="img"
      aria-label={alt}
    >
      <defs>
        <linearGradient id={gradId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7A1520" />
          <stop stopColor="#6B0F1A" />
          <stop offset="1" stopColor="#3D0808" />
        </linearGradient>
      </defs>

      <rect x="5" y="5" width="54" height="54" rx="14" fill={`url(#${gradId})`} />
      <rect
        x="5.5"
        y="5.5"
        width="53"
        height="53"
        rx="13.5"
        stroke="#D4AF37"
        strokeWidth="2"
      />
      <path
        d="M14 17h36c0 0-8 6-18 6S14 17 14 17z"
        fill="#FFFFFF"
        fillOpacity="0.12"
      />
      <text
        x="32"
        y="40"
        textAnchor="middle"
        fill="#F5E6D3"
        fontSize="22"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
        letterSpacing="-0.04em"
      >
        MRF
      </text>
    </svg>
  );
}
