"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import MRFLoader from "@/components/ui/MRFLoader";

const SLOW_THRESHOLD_MS = 1500; // show loader after this many ms

interface GlobalLoadingContextValue {
  isSlowLoading: boolean;
}

const GlobalLoadingContext = createContext<GlobalLoadingContextValue>({
  isSlowLoading: false,
});

export function useGlobalLoading() {
  return useContext(GlobalLoadingContext);
}

export function GlobalLoadingProvider({ children }: { children: React.ReactNode }) {
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const pendingSlowRef = useRef(0);
  const patchedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || patchedRef.current) return;
    patchedRef.current = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async function patchedFetch(input, init) {
      const url = (typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url) || "";

      // Only intercept internal API calls
      if (!url.includes("/api/")) {
        return originalFetch(input, init);
      }

      let timerFired = false;

      const timer = setTimeout(() => {
        timerFired = true;
        pendingSlowRef.current += 1;
        setIsSlowLoading(true);
      }, SLOW_THRESHOLD_MS);

      const cleanup = () => {
        clearTimeout(timer);
        if (timerFired) {
          pendingSlowRef.current = Math.max(0, pendingSlowRef.current - 1);
          if (pendingSlowRef.current === 0) {
            setIsSlowLoading(false);
          }
        }
      };

      try {
        const result = await originalFetch(input, init);
        cleanup();
        return result;
      } catch (err) {
        cleanup();
        throw err;
      }
    };

    return () => {
      // Restore original on unmount (dev HMR)
      window.fetch = originalFetch;
      patchedRef.current = false;
    };
  }, []);

  return (
    <GlobalLoadingContext.Provider value={{ isSlowLoading }}>
      {children}
      <MRFLoader variant="global" visible={isSlowLoading} />
    </GlobalLoadingContext.Provider>
  );
}
