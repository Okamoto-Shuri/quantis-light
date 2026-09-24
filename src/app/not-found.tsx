import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "ページが見つかりません" };

/**
 * ルートの 404。一致しない URL は (app)/[...missing] が保護画面の枠の中で扱うため、
 * ここに来るのは保護画面の外で notFound() が呼ばれた場合だけ。利用者のデータは表示しない。
 */
export default function RootNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start gap-3 px-4 py-16 sm:px-6">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">ページが見つかりません</h1>
      <Link href="/" className="text-sm font-medium text-signal underline-offset-4 hover:underline">
        ダッシュボードに戻る
      </Link>
    </main>
  );
}
