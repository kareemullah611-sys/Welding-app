"use client";

import { useSearchParams } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { getEmbedFromLocation } from "@/lib/quickform-embed";

/** Stable embed flag (avoids full AppLayout flash before searchParams hydrate). */
export function useQuickformEmbed(): boolean {
  const searchParams = useSearchParams();
  const [embed, setEmbed] = useState(
    () => typeof window !== "undefined" && getEmbedFromLocation()
  );

  useLayoutEffect(() => {
    setEmbed(searchParams.get("embed") === "1" || getEmbedFromLocation());
  }, [searchParams]);

  return embed || searchParams.get("embed") === "1" || getEmbedFromLocation();
}
