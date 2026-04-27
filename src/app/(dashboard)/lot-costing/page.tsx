"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "@/hooks/useOffline";

export default function LotCostingRedirectPage() {
  const router = useRouter();
  const { isOnline } = useOffline();

  useEffect(() => {
    router.replace("/lots");
  }, [router]);

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Lot Costing moved to Lots module.</p>
      <p className="mt-1 text-xs">
        Redirecting to Lots... {isOnline ? "" : "You are offline; cached Lots data will open if available."}
      </p>
      <button
        onClick={() => router.replace("/lots")}
        className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        Open Lots
      </button>
    </div>
  );
}
