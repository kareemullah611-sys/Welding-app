"use client";

import { useState, useEffect } from "react";

export type PlatformRuntime = "electron" | "capacitor" | "browser";

declare global {
  interface Window {
    platformInfo?: {
      runtime: string;
      openRemoteInBrowser?: () => Promise<boolean>;
      retryRemoteLoad?: () => Promise<boolean>;
    };
    Capacitor?: { getPlatform: () => string };
  }
}

export interface PlatformInfo {
  runtime: PlatformRuntime;
  isTouchDevice: boolean;
  isPWA: boolean;
}

function detectPlatform(): PlatformInfo {
  if (typeof window === "undefined") return { runtime: "browser", isTouchDevice: false, isPWA: false };

  const runtime: PlatformRuntime =
    window.platformInfo?.runtime === "electron" ? "electron" :
    window.Capacitor ? "capacitor" :
    "browser";

  const isPWA =
    typeof matchMedia !== "undefined" &&
    matchMedia("(display-mode: standalone)").matches;

  const isTouchDevice =
    typeof matchMedia !== "undefined" &&
    matchMedia("(pointer: coarse)").matches;

  return { runtime, isTouchDevice, isPWA };
}

export function usePlatform(): PlatformInfo {
  const [info, setInfo] = useState<PlatformInfo>(detectPlatform);

  useEffect(() => {
    const mql = matchMedia?.("(display-mode: standalone)");
    const pointerMql = matchMedia?.("(pointer: coarse)");

    const update = () => setInfo(detectPlatform());
    mql?.addEventListener("change", update);
    pointerMql?.addEventListener("change", update);

    return () => {
      mql?.removeEventListener("change", update);
      pointerMql?.removeEventListener("change", update);
    };
  }, []);

  return info;
}
