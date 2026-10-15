"use client";

import { useEffect, useState } from "react";

/**
 * Height in CSS pixels by which the software keyboard covers the layout viewport.
 *
 * iOS WKWebView does not resize the layout viewport when the keyboard opens, so
 * `dvh`/`vh` both keep their full height and fixed-bottom UI ends up underneath
 * the keyboard. `visualViewport` is the only signal that reflects it.
 *
 * Returns 0 on desktop and on browsers without visualViewport.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(covered > 0 ? Math.round(covered) : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}