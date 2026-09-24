import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { RunStatusBadge } from "@/components/run-status-badge";
import type { DashboardSummary } from "@/lib/dashboard/summary";
import { formatDateTimeJst, formatRelativeTime } from "@/lib/format";
import { RUN_TARGET_LABELS } from "@/lib/ingestion/runs";

type LatestRun = DashboardSummary["latestRun"];

/** 直近の実行（開始日時が最も新しい実行）の結果。失敗や実行中に気づけるようにする。 */
export function LatestRunDetail({ run }: { run: NonNullable<LatestRun> }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <RunStatusBadge status={run.status} />
        <span className="text-sm">{RUN_TARGET_LABELS[run.target]}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        開始 <span className="tabular font-mono text-foreground">{formatDateTimeJst(run.startedAt)}</span>
      </p>
      {run.errorMessage && <p className="text-sm break-words text-destructive-strong">{run.errorMessage}</p>}
    </div>
  );
}

/** データの鮮度（最終取り込みの完了日時と、直近の実行）。 */
export function FreshnessPanel({ summary, now }: { summary: DashboardSummary; now: Date }) {
  const completed = summary.lastCompletedRun;

  return (
    <section aria-labelledby="freshness-heading" className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h2 id="freshness-heading" className="text-sm font-medium">
          データの鮮度
        </h2>
        <Link
          href="/imports"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-signal-strong underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          取り込み状況を見る
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
      <div className="grid divide-y md:grid-cols-[3fr_2fr] md:divide-x md:divide-y-0">
        <div className="space-y-1 px-4 py-4" data-testid="last-completed">
          <h3 className="text-xs text-muted-foreground">最終取り込みの完了日時</h3>
          {completed ? (
            <>
              <p className="tabular font-mono text-2xl font-medium tracking-tight">
                {formatDateTimeJst(completed.finishedAt)}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span className="text-foreground">{formatRelativeTime(completed.finishedAt, now)}</span>
                <span aria-hidden="true">·</span>
                <span>対象: {RUN_TARGET_LABELS[completed.target]}</span>
                {completed.status === "partial" && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>一部失敗を含む</span>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-medium tracking-tight">記録なし</p>
              <p className="text-sm text-muted-foreground">完了した取り込みの記録がまだありません。</p>
            </>
          )}
        </div>
        <div className="space-y-2 px-4 py-4" data-testid="latest-run">
          <h3 className="text-xs text-muted-foreground">直近の実行</h3>
          {summary.latestRun ? (
            <LatestRunDetail run={summary.latestRun} />
          ) : (
            <p className="text-sm">実行履歴なし</p>
          )}
        </div>
      </div>
    </section>
  );
}
