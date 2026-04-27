"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "@/hooks/useOffline";

export default function SupplierPaymentsRedirectPage() {
  const router = useRouter();
  const { isOnline } = useOffline();

  useEffect(() => {
    router.replace("/suppliers");
  }, [router]);

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Supplier Payments moved to Suppliers module.</p>
      <p className="mt-1 text-xs">
        Redirecting to Suppliers... {isOnline ? "" : "You are offline; cached Suppliers data will open if available."}
      </p>
      <button
        onClick={() => router.replace("/suppliers")}
        className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        Open Suppliers
      </button>
    </div>
  );
}
