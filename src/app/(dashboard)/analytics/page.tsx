import dynamic from "next/dynamic";

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
  return <AnalyticsClient />;
}
