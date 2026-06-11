"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

const LOGO_SRC = "/brand/samgong-logo.png";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  alt?: string;
}

const sizeMap = {
  sm: { box: "h-9 w-9", img: 36 },
  md: { box: "h-10 w-10", img: 40 },
  lg: { box: "h-20 w-20", img: 80 },
};

export default function BrandLogo({
  size = "md",
  className,
  alt = "SAMGONG",
}: BrandLogoProps) {
  const s = sizeMap[size];

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
    </div>
  );
}
