"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LotCostingRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/lots");
  }, [router]);

  return null;
}
