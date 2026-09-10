import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { LangProvider } from "@/lib/lang";
import { OfflineProvider } from "@/hooks/useOffline";
import OfflineBanner from "@/components/layout/OfflineBanner";
import { ThemeProvider } from "@/hooks/useTheme";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
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
    <html lang="en" suppressHydrationWarning>
      <Script id="theme-init" strategy="beforeInteractive">
        {`(function(){try{var key="mrf-theme";var saved=localStorage.getItem(key);var theme=saved==="light"||saved==="dark"||saved==="system"?saved:"system";var dark=theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var root=document.documentElement;root.classList.toggle("dark",dark);root.dataset.theme=theme;root.style.colorScheme=dark?"dark":"light";}catch(e){}})();`}
      </Script>
      <body suppressHydrationWarning>
        {process.env.NODE_ENV === "development" && (
          <Script id="dev-unregister-sw" strategy="beforeInteractive">
            {`if(typeof navigator!=="undefined"&&"serviceWorker"in navigator){navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister();});});}`}
          </Script>
        )}
        <ThemeProvider>
          <LangProvider>
            <AuthProvider>
              <OfflineProvider>
                {children}
                <OfflineBanner />
              </OfflineProvider>
            </AuthProvider>
          </LangProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
