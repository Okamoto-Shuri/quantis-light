import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_JP } from "next/font/google";
import Script from "next/script";

import { SiteFooter } from "@/components/site-footer";
import { HISTORY_CACHE_GUARD_SCRIPT } from "@/lib/http/history-cache-guard";

import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Quantis Light", template: "%s | Quantis Light" },
  description: "個人用の日本株スクリーナー",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={`${notoSansJp.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Script id="history-cache-guard" strategy="beforeInteractive">
          {HISTORY_CACHE_GUARD_SCRIPT}
        </Script>
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
