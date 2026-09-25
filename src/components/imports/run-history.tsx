import { RunStatusBadge } from "@/components/run-status-badge";
import { AppLink } from "@/components/shell/app-link";
import { formatCount, formatDateTimeJst } from "@/lib/format";
import {
  formatRemaining,
  isRemainingUnknown,
  isStaleRun,
  partialKindOf,
  RUN_TARGET_LABELS,
  RUN_TRIGGER_LABELS,
  STALE_RUN_MINUTES,
  type IngestionRun,
} from "@/lib/ingestion/runs";

const Dash = () => <span className="text-muted-foreground">—</span>;

/** 応答の無くなった「実行中」の注記（次の取り込みの開始時に「失敗」になる）。 */
function StaleNote() {
  return (
    <span className="block text-xs text-caution-strong" data-testid="stale-run-note">
      応答がありません（{STALE_RUN_MINUTES} 分以上）
    </span>
  );
}

const kindOf = (run: IngestionRun) =>
  partialKindOf({ status: run.status, stoppedReason: run.stopped_reason, failedCount: run.failed_count });

/** 開始の日時を、実行の詳細へのリンクにする（Sprint 12。列は足さない）。 */
function StartLink({ run }: { run: IngestionRun }) {
  const started = formatDateTimeJst(run.started_at);
  return (
    <AppLink
      href={`/imports/runs/${run.id}`}
      data-testid="run-detail-link"
      aria-label={`実行の詳細（${RUN_TARGET_LABELS[run.target]}・${started} 開始）`}
      className="rounded-sm underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {started}
    </AppLink>
  );
}

/** 残りの件数と失敗の件数（結果のバッジの下）。 */
function RunNotes({ run }: { run: IngestionRun }) {
  const remaining = run.remaining_count ?? 0;
  const failed = run.failed_count ?? 0;
  return (
    <>
      {remaining > 0 && run.remaining_unit && (
        <span className="block text-xs text-muted-foreground" data-testid="run-remaining">
          {formatRemaining(remaining, run.remaining_unit)}
        </span>
      )}
      {isRemainingUnknown(run) && (
        <span className="block text-xs text-muted-foreground" data-testid="run-remaining">
          残り 不明
        </span>
      )}
      {failed > 0 && (
        <span className="block text-xs text-destructive-strong" data-testid="run-failed-count">
          失敗 {formatCount(failed)} 件
        </span>
      )}
    </>
  );
}

/** 実行履歴。幅 768px 未満はカード形式、それ以上は表で表示する。 */
export function RunHistory({ runs, now }: { runs: IngestionRun[]; now: Date }) {
  return (
    <>
      <ul className="divide-y rounded-lg border bg-card md:hidden" data-testid="run-list">
        {runs.map((run) => (
          <li key={run.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={run.status} partialKind={kindOf(run)} />
              <span className="text-sm font-medium">{RUN_TARGET_LABELS[run.target]}</span>
              <span className="text-xs text-muted-foreground">{RUN_TRIGGER_LABELS[run.trigger]}</span>
              {isStaleRun(run, now) && <StaleNote />}
            </div>
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">開始</dt>
              <dd className="tabular font-mono">
                <StartLink run={run} />
              </dd>
              <dt className="text-muted-foreground">終了</dt>
              <dd className="tabular font-mono">{formatDateTimeJst(run.finished_at) ?? <Dash />}</dd>
              <dt className="text-muted-foreground">処理件数</dt>
              <dd className="tabular font-mono">{formatCount(run.processed_count)}</dd>
            </dl>
            <RunNotes run={run} />
            {run.error_message && <p className="text-sm break-words text-destructive-strong">{run.error_message}</p>}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm" data-testid="run-table">
          <thead className="border-b bg-surface text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">開始</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">終了</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">対象</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">起動</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">結果</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">処理件数</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">エラー</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {runs.map((run) => (
              <tr key={run.id} className="align-top">
                <td className="tabular px-3 py-2 font-mono whitespace-nowrap">
                  <StartLink run={run} />
                </td>
                <td className="tabular px-3 py-2 font-mono whitespace-nowrap">
                  {formatDateTimeJst(run.finished_at) ?? <Dash />}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{RUN_TARGET_LABELS[run.target]}</td>
                <td className="px-3 py-2 whitespace-nowrap">{RUN_TRIGGER_LABELS[run.trigger]}</td>
                <td className="space-y-1 px-3 py-2">
                  <RunStatusBadge status={run.status} partialKind={kindOf(run)} />
                  {isStaleRun(run, now) && <StaleNote />}
                  <RunNotes run={run} />
                </td>
                <td className="tabular px-3 py-2 text-right font-mono">{formatCount(run.processed_count)}</td>
                <td className="min-w-[14rem] px-3 py-2 break-words">
                  {run.error_message ? <span className="text-destructive-strong">{run.error_message}</span> : <Dash />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
