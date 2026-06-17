"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Row ⋯ menu portaled to document.body so it is not clipped by table overflow. */
export function RowActionMenu({
  open,
  onOpenChange,
  children,
  menuClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  menuClassName?: string;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 176;
    const estMenuHeight = 160;
    const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estMenuHeight && rect.top > estMenuHeight;
    setMenuStyle(
      openUp
        ? { position: "fixed", left, bottom: window.innerHeight - rect.top + 4, zIndex: 200, visibility: "visible" }
        : { position: "fixed", left, top: rect.bottom + 4, zIndex: 200, visibility: "visible" }
    );
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => reposition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-action-menu-root='true']")) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onOpenChange]);

  return (
    <div
      ref={anchorRef}
      className="relative inline-flex"
      data-action-menu-root="true"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        aria-label="Open actions"
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-gray-600 hover:bg-gray-100 sm:h-auto sm:w-auto sm:px-2 sm:py-1"
      >
        ⋯
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              data-action-menu-root="true"
              className={cn(
                "w-44 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg sm:w-40",
                menuClassName
              )}
              style={menuStyle}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
