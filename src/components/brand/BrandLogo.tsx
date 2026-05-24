"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/brand/samgong-logo.png";

interface BrandLogoProps {
  /** Notification count; hidden when 0 or badge hidden */
  badgeCount?: number;
  showBadge?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  alt?: string;
}

const sizeMap = {
  sm: { box: "h-9 w-9", img: 36, badge: "min-w-[14px] h-[14px] text-[9px] -top-0.5 -right-0.5" },
  md: { box: "h-10 w-10", img: 40, badge: "min-w-[16px] h-[16px] text-[9px] -top-1 -right-1" },
  lg: { box: "h-20 w-20", img: 80, badge: "min-w-[20px] h-[20px] text-[10px] -top-1 -right-1" },
};

export default function BrandLogo({
  badgeCount = 0,
  showBadge = true,
  size = "md",
  className,
  alt = "SAMGONG",
}: BrandLogoProps) {
  const s = sizeMap[size];
  const displayBadge = showBadge && badgeCount > 0;

  return (
    <div className={cn("relative flex-shrink-0", s.box, className)}>
      <Image
        src={LOGO_SRC}
        alt={alt}
        width={s.img}
        height={s.img}
        className="h-full w-full object-contain"
        priority={size === "lg"}
      />
      {displayBadge && (
        <span
          className={cn(
            "absolute z-10 rounded-full bg-red-500 text-white font-bold flex items-center justify-center px-0.5 leading-none shadow-sm ring-2 ring-[#0a111b]",
            s.badge
          )}
          aria-label={`${badgeCount} notifications`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </div>
  );
}
