"use client";

import dynamic from "next/dynamic";
import { useOffline } from "@/hooks/useOffline";

// ssr: false guarantees server and client render the same placeholder,
// eliminating any hydration mismatch from client-only hooks/state.
const AnalyticsClient = dynamic(() => import("./analytics-client"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin" />
    </div>
  ),
});

export default function AnalyticsPage() {
  const { isOnline } = useOffline();
  return (
    <div>
      {!isOnline && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Offline mode: analytics is showing cached snapshots where available.
        </div>
      )}
      <AnalyticsClient />
    </div>
  );
}
