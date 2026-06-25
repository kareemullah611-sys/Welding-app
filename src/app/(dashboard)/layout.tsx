import { Suspense } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<BrandLoader fullscreen size="lg" label="Loading" />}>
      <AppLayout>{children}</AppLayout>
    </Suspense>
  );
}
