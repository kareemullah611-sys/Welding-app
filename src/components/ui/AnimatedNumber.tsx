"use client";

import React, { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
  prefix?: string;
  suffix?: string;
}

/** Smoothly tween a number to a new value. Honors prefers-reduced-motion. */
export function AnimatedNumber({
  value,
  duration = 800,
  format = (n) => n.toLocaleString("en-US"),
  className,
  prefix,
  suffix,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const startRef = useRef(value);
  const startTimeRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const prefersReduced = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || !Number.isFinite(value)) {
      setDisplay(value);
      return;
    }
    startRef.current = display;
    startTimeRef.current = null;

    const tick = (now: number) => {
      if (startTimeRef.current === null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startRef.current + (value - startRef.current) * eased;
      setDisplay(next);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={className}>
      {prefix}{format(display)}{suffix}
    </span>
  );
}
