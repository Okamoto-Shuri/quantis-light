import { ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { DashboardSummary } from "@/lib/dashboard/summary";

import { LatestRunDetail } from "./freshness-panel";

/** 銘柄が1件も保存されていないときの空状態。件数は表示しない（ダミーの数値を出さない）。 */
export function DashboardEmptyState({ latestRun }: { latestRun: DashboardSummary["latestRun"] }) {
  return (
    <section
      aria-labelledby="empty-heading"
      className="flex flex-col items-start gap-4 rounded-lg border border-dashed bg-card px-6 py-10 sm:px-10"
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <DatabaseZap aria-hidden="true" className="size-5" />
      </span>
      <div className="space-y-1.5">
        <h2 id="empty-heading" className="text-lg font-semibold tracking-tight">
          まだデータが取り込まれていません
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          銘柄マスタ・財務データ・有価証券報告書が取り込まれると、ここにデータの鮮度と件数が表示されます。
          取り込みの実行結果は取り込み状況の画面で確認できます。
        </p>
      </div>
      {latestRun && (
        <div className="w-full max-w-md rounded-md border bg-background px-4 py-3" data-testid="latest-run">
          <h3 className="mb-2 text-xs text-muted-foreground">直近の実行</h3>
          <LatestRunDetail run={latestRun} />
        </div>
      )}
      <Button asChild variant="outline">
        <Link href="/imports">
          取り込み状況を見る
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </section>
  );
}
