import { ChevronRight } from "lucide-react";

import { RunStatusBadge } from "@/components/run-status-badge";
import { AppLink } from "@/components/shell/app-link";
import { docTypeLabel } from "@/lib/edinet";
import { formatCount, formatDateTimeJst } from "@/lib/format";
import { FAILURE_ITEM_LABELS } from "@/lib/ingestion/failures";
import type { RateLimitStats } from "@/lib/ingestion/pacer";
import type { RunDetail, RunFailureView } from "@/lib/ingestion/run-detail";
import {
  formatRemaining,
  isStaleRun,
  partialKindOf,
  RUN_TARGET_LONG_LABELS,
  RUN_TRIGGER_LABELS,
  STALE_RUN_MINUTES,
  STOPPED_REASON_LABELS,
} from "@/lib/ingestion/runs";

const Dash = () => <span className="text-muted-foreground">—</span>;

/** 待った時間（「45 秒」「1分45秒」）。 */
export function formatWaitDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}分` : `${minutes}分${rest}秒`;
}

/** 呼び出し回数の制限の記録の文言。 */
export function describeRateLimit(rateLimit: RateLimitStats | null): string {
  if (rateLimit === null) return "呼び出し回数の制限の記録はありません";
  if (rateLimit.hits === 0) return "呼び出し回数の制限には当たっていません";
  const base = `呼び出し回数の制限: ${formatCount(rateLimit.hits)} 回（${formatCount(rateLimit.retries)} 回再試行、待機 合計 ${formatWaitDuration(rateLimit.waitedMs)}）`;
  return rateLimit.exhausted ? `${base}。解消しなかったため中断しました` : `${base}。再試行で回復しました`;
}

export function RunBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="パンくず" data-testid="breadcrumb">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <li>
          <AppLink
            href="/imports"
            className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            取り込み状況
          </AppLink>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-3.5" />
        </li>
        <li aria-current="page" className="min-w-0 truncate text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}

function FailureTarget({ failure }: { failure: RunFailureView }) {
  switch (failure.itemType) {
    case "stock":
      return <Dash />;
    case "document":
      return (
        <span>
          <span className="tabular font-mono">{failure.itemKey}</span>
          {failure.docTypeCode && <span className="ml-1 text-xs text-muted-foreground">{docTypeLabel(failure.docTypeCode)}</span>}
        </span>
      );
    default:
      return <span className="tabular font-mono">{failure.itemKey}</span>;
  }
}

function FailureCode({ failure }: { failure: RunFailureView }) {
  if (failure.code === null) return <Dash />;
  if (failure.companyName === null) return <span className="tabular font-mono">{failure.code}</span>;
  return (
    <AppLink
      href={`/stocks/${failure.code}`}
      className="tabular rounded-sm font-mono underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {failure.code}
    </AppLink>
  );
}

/** 実行の詳細（概要・API の呼び出し・失敗した対象）。 */
export function RunDetailView({ detail, now }: { detail: RunDetail; now: Date }) {
  const { run, failures } = detail;
  const kind = partialKindOf({ status: run.status, stoppedReason: run.stopped_reason, failedCount: run.failed_count });
  const remaining = run.remaining_count ?? 0;
  const failedCount = run.failed_count ?? 0;
  const hasDisclosureDates = failures.some((f) => f.itemType === "disclosure_date");

  return (
    <div className="space-y-6">
      <section aria-labelledby="run-overview-heading" className="rounded-lg border bg-card" data-testid="run-overview">
        <h2 id="run-overview-heading" className="border-b px-4 py-2.5 text-sm font-medium">
          概要
        </h2>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 px-4 py-4 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">対象</dt>
          <dd>{RUN_TARGET_LONG_LABELS[run.target]}</dd>
          <dt className="text-muted-foreground">起動</dt>
          <dd>{RUN_TRIGGER_LABELS[run.trigger]}</dd>
          <dt className="text-muted-foreground">開始</dt>
          <dd className="tabular font-mono">{formatDateTimeJst(run.started_at)}</dd>
          <dt className="text-muted-foreground">終了</dt>
          <dd className="tabular font-mono">{formatDateTimeJst(run.finished_at) ?? <Dash />}</dd>
          <dt className="text-muted-foreground">結果</dt>
          <dd className="space-y-1">
            <RunStatusBadge status={run.status} partialKind={kind} />
            {isStaleRun(run, now) && (
              <span className="block text-xs text-caution-strong" data-testid="stale-run-note">
                応答がありません（{STALE_RUN_MINUTES} 分以上）
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">処理件数</dt>
          <dd className="tabular font-mono" data-testid="run-processed">{formatCount(run.processed_count)}</dd>
          <dt className="text-muted-foreground">残り</dt>
          <dd data-testid="run-remaining">
            {remaining > 0 && run.remaining_unit ? formatRemaining(remaining, run.remaining_unit) : <Dash />}
          </dd>
          <dt className="text-muted-foreground">失敗</dt>
          <dd data-testid="run-failed-count">{failedCount > 0 ? `${formatCount(failedCount)} 件` : "なし"}</dd>
          <dt className="text-muted-foreground">中断の理由</dt>
          <dd data-testid="run-stopped-reason">{run.stopped_reason ? STOPPED_REASON_LABELS[run.stopped_reason] : <Dash />}</dd>
          <dt className="text-muted-foreground">メッセージ</dt>
          <dd className="break-words" data-testid="run-error-message">
            {run.error_message ? <span className="text-destructive-strong">{run.error_message}</span> : <Dash />}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="run-api-heading" className="space-y-1.5" data-testid="run-api-calls">
        <h2 id="run-api-heading" className="text-sm font-medium">
          API の呼び出し
        </h2>
        <p className="text-sm">
          {detail.apiCalls === null ? "API の呼び出しの記録はありません" : `API の呼び出し ${formatCount(detail.apiCalls)} 回`}
        </p>
        <p className="text-sm text-muted-foreground" data-testid="run-rate-limit">
          {describeRateLimit(detail.rateLimit)}
        </p>
      </section>

      <section aria-labelledby="run-failures-heading" className="space-y-2">
        <h2 id="run-failures-heading" className="text-sm font-medium">
          失敗した対象
        </h2>
        {run.stopped_reason === "stale" && (
          <p className="text-xs text-muted-foreground" data-testid="run-failures-stale-note">
            応答が無くなった実行では、失敗した対象の一覧が一部欠けていることがあります。
          </p>
        )}
        {failures.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-sm" data-testid="run-failures-empty">
            失敗した対象はありません
          </p>
        ) : (
          <>
            {hasDisclosureDates && (
              <p className="text-xs text-muted-foreground" data-testid="run-failures-date-note">
                開示日の失敗: この日に開示したすべての銘柄の財務が未取得です。次回の取り込みで再試行します。
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[40rem] text-sm" data-testid="run-failures">
                <thead className="border-b bg-surface text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">種類</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">コード</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">銘柄名</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">対象</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">エラー内容</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {failures.map((failure) => (
                    <tr
                      key={`${failure.itemType}:${failure.itemKey}`}
                      className="align-top"
                      data-testid="run-failure"
                      data-item-type={failure.itemType}
                      data-item-key={failure.itemKey}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">{FAILURE_ITEM_LABELS[failure.itemType]}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <FailureCode failure={failure} />
                      </td>
                      <td className="px-3 py-2">{failure.companyName ?? <Dash />}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <FailureTarget failure={failure} />
                      </td>
                      <td className="px-3 py-2 text-destructive-strong">{failure.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.failuresOmitted > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="run-failures-omitted">
                ほか {formatCount(detail.failuresOmitted)} 件（一覧に保存するのは 1 回の実行で 1,000 件まで）
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
