"use client";

import React, { useEffect, useRef, useState } from "react";
import CuttingDiscSpinner from "@/components/ui/CuttingDiscSpinner";
import { cn } from "@/lib/utils";

/** Minimum time the post-login overlay stays visible */
export const MIN_LOGIN_DURATION = 4000;

export interface ProcessingLoaderProps {
  /** "login" = minimum display time + onAnimationComplete; "global" = visible prop */
  variant?: "login" | "global";
  visible?: boolean;
  onAnimationComplete?: () => void;
  label?: string;
  className?: string;
  /** When set, shows your cutting disc image spinning with glass waves instead of orbital rings */
  productImageSrc?: string;
}

/** Inline / table spinner — Reijo-style orbital rings */
export function ProcessingSpinner({
  size = "md",
  label,
  className,
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("processing-spinner", `processing-spinner--${size}`, className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="processing-spinner__stage" aria-hidden="true">
        <div className="processing-spinner__ring processing-spinner__ring--1" />
        <div className="processing-spinner__ring processing-spinner__ring--2" />
        <div className="processing-spinner__ring processing-spinner__ring--3" />
        <div className="processing-spinner__dot processing-spinner__dot--1" />
        <div className="processing-spinner__dot processing-spinner__dot--2" />
        <div className="processing-spinner__core" />
      </div>
      {label ? (
        <p className="processing-spinner__label">
          {label}
          <span className="processing-spinner__dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

export default function ProcessingLoader({
  variant = "global",
  visible = false,
  onAnimationComplete,
  label = "Processing",
  className,
  productImageSrc,
}: ProcessingLoaderProps) {
  const [show, setShow] = useState(variant === "login");
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (variant !== "login") return;
    startTimeRef.current = Date.now();
    setShow(true);
  }, [variant]);

  useEffect(() => {
    if (variant !== "login") return;
    if (visible) return;
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, MIN_LOGIN_DURATION - elapsed);
    const timer = setTimeout(() => {
      onAnimationComplete?.();
      setTimeout(() => setShow(false), 300);
    }, remaining);
    return () => clearTimeout(timer);
  }, [visible, variant, onAnimationComplete]);

  useEffect(() => {
    if (variant !== "global") return;
    setShow(visible);
  }, [visible, variant]);

  if (!show) return null;

  return (
    <div
      className={cn("processing-overlay", className)}
      aria-label={label}
      aria-busy="true"
    >
      <div className="processing-overlay__glow" aria-hidden="true" />
      {productImageSrc ? (
        <CuttingDiscSpinner src={productImageSrc} size="lg" label={label} />
      ) : (
        <ProcessingSpinner size="lg" label={label} />
      )}
    </div>
  );
}
