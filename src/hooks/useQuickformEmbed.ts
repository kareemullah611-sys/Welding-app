"use client";

import { useLayoutEffect, useState } from "react";
import { getEmbedFromLocation } from "@/lib/quickform-embed";

/** Stable embed flag (avoids full AppLayout flash before client URL is read). */
export function useQuickformEmbed(): boolean {
  const [embed, setEmbed] = useState(() =>
    typeof window !== "undefined" && getEmbedFromLocation(),
  );

  useLayoutEffect(() => {
    const sync = () => setEmbed(getEmbedFromLocation());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return embed || getEmbedFromLocation();
}
