import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_JP } from "next/font/google";
import { cookies } from "next/headers";

import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { parseTheme, THEME_COOKIE, themeAttribute } from "@/lib/theme";

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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // テーマは Cookie から決めて <html> に出力する（リロード時の配色のちらつきを防ぐ）。不正な値は system 扱い。
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="ja" data-theme={themeAttribute(theme)} className={`${notoSansJp.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider initialTheme={theme}>
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
