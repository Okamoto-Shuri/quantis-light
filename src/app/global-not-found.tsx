import type { Metadata } from "next";

import { NotFoundContent } from "@/components/not-found-content";
import { ProtectedShell } from "@/components/protected-shell";
import { DocumentNavigationProvider } from "@/components/shell/app-link";
import { requireAllowedUser } from "@/lib/auth/guard";

import { AppDocument } from "./app-document";

import "./globals.css";

export const metadata: Metadata = {
  title: "ページが見つかりません | Quantis Light",
  robots: { index: false, follow: false },
};

/**
 * どのルートにも一致しない URL の 404（next.config.ts の experimental.globalNotFound）。
 *
 * notFound() を投げるページで 404 を出すと、dev でサーバーとブラウザの時計がずれたときに、
 * React の開発用のパフォーマンス計測（エラーになったコンポーネントの Performance.measure）が
 * 負の時刻で例外を出す（Sprint 2 評価の B1）。ここでは何も投げずに 404 を描画する。
 * ルートレイアウトを通らないため、認証の検証とアプリの枠をここで行う。
 */
export default async function GlobalNotFound() {
  const user = await requireAllowedUser();
  return (
    <AppDocument>
      <DocumentNavigationProvider>
        <ProtectedShell user={user}>
          <NotFoundContent />
        </ProtectedShell>
      </DocumentNavigationProvider>
    </AppDocument>
  );
}
