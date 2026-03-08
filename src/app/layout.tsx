import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { LangProvider } from "@/lib/lang";
import { OfflineProvider } from "@/hooks/useOffline";
import OfflineBanner from "@/components/layout/OfflineBanner";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#3B82F6",
};

export const metadata: Metadata = {
  title: "Welding Materials Management System",
  description: "Multi-city sales, inventory & financial management",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Welding App",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
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
