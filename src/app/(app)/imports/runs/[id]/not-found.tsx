import { SearchX } from "lucide-react";

import { RunBreadcrumb } from "@/components/imports/run-detail-view";
import { AppLink } from "@/components/shell/app-link";

/** 実行の詳細で notFound() が呼ばれたとき（id の形が違う・実行が無い）。保護画面の枠の中に表示し、HTTP 404 を返す。 */
export default function RunNotFoundPage() {
  return (
    <div className="space-y-5" data-testid="run-not-found">
      <RunBreadcrumb current="実行が見つかりません" />
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-card px-6 py-10">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <SearchX aria-hidden="true" className="size-5" />
        </span>
        <div className="space-y-1.5">
          <p className="font-mono text-sm text-muted-foreground">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">実行が見つかりません</h1>
          <p className="max-w-prose text-sm text-muted-foreground">実行履歴に無い実行か、URL が正しくありません。</p>
        </div>
        <AppLink href="/imports" className="text-sm font-medium text-signal-strong underline-offset-4 hover:underline">
          取り込み状況に戻る
        </AppLink>
      </div>
    </div>
  );
}
