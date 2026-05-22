"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getEmbedFromLocation } from "@/lib/quickform-embed";

/** Stable embed flag (avoids full AppLayout flash before searchParams hydrate). */
export function useQuickformEmbed(): boolean {
  const searchParams = useSearchParams();
  const [embed, setEmbed] = useState(getEmbedFromLocation);

  useEffect(() => {
    setEmbed(searchParams.get("embed") === "1");
  }, [searchParams]);

  return embed;
}
