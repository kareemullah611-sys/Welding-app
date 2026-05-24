"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Drop your PNG/WebP here after upload (transparent background works best). */
export const DEFAULT_CUTTING_DISC_SRC = "/products/cutting-disc.png";

interface CuttingDiscSpinnerProps {
  src?: string;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
  /** Seconds per full rotation */
  spinDuration?: number;
}

/** Display size (CSS handles layout); render at 2–4× for retina sharpness */
const displayPx = { sm: 56, md: 88, lg: 160 } as const;
const renderPx = { sm: 224, md: 352, lg: 640 } as const;

export default function CuttingDiscSpinner({
  src = DEFAULT_CUTTING_DISC_SRC,
  size = "md",
  label,
  className,
  spinDuration = 6,
}: CuttingDiscSpinnerProps) {
  const [imgError, setImgError] = useState(false);
  const display = displayPx[size];
  const render = renderPx[size];

  return (
    <div
      className={cn("disc-spinner", `disc-spinner--${size}`, className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        ["--disc-spin-duration" as string]: `${spinDuration}s`,
        ["--disc-display-size" as string]: `${display}px`,
      }}
    >
      <div className="disc-spinner__stage" aria-hidden="true">
        <div className="disc-spinner__spin">
          {!imgError ? (
            <Image
              src={src}
              alt=""
              width={render}
              height={render}
              className="disc-spinner__img"
              sizes={`${display}px`}
              quality={100}
              unoptimized
              onError={() => setImgError(true)}
              priority={size === "lg"}
            />
          ) : (
            <div className="disc-spinner__placeholder" />
          )}
        </div>

        {/* Motion under the glass blanket — travels end to end */}
        <div className="disc-spinner__underglass" aria-hidden="true">
          <div className="disc-spinner__ripple disc-spinner__ripple--shadow" />
          <div className="disc-spinner__ripple disc-spinner__ripple--lift" />
          <div className="disc-spinner__ripple disc-spinner__ripple--trail" />
        </div>

        <div className="disc-spinner__glass-sheet" />
        <div className="disc-spinner__rim" />
      </div>

      {label ? (
        <p className="disc-spinner__label">
          {label}
          <span className="disc-spinner__dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}
