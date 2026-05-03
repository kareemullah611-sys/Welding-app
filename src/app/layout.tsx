import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { LangProvider } from "@/lib/lang";
import { OfflineProvider } from "@/hooks/useOffline";
import OfflineBanner from "@/components/layout/OfflineBanner";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#6B0F1A",
};

export const metadata: Metadata = {
  title: "MRF Hardware Management System",
  description: "Multi-city sales, inventory & financial management",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MRF Hardware",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <LangProvider>
          <AuthProvider>
            <OfflineProvider>
              {children}
              <OfflineBanner />
            </OfflineProvider>
          </AuthProvider>
        </LangProvider>
      </body>
    </html>
  );
}
