import { RunStatusBadge } from "@/components/run-status-badge";
import { formatCount, formatDateTimeJst } from "@/lib/format";
import { RUN_TARGET_LABELS, RUN_TRIGGER_LABELS, type IngestionRun } from "@/lib/ingestion/runs";

const Dash = () => <span className="text-muted-foreground">—</span>;

/** 実行履歴。幅 768px 未満はカード形式、それ以上は表で表示する。 */
export function RunHistory({ runs }: { runs: IngestionRun[] }) {
  return (
    <>
      <ul className="divide-y rounded-lg border bg-card md:hidden" data-testid="run-list">
        {runs.map((run) => (
          <li key={run.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={run.status} />
              <span className="text-sm font-medium">{RUN_TARGET_LABELS[run.target]}</span>
              <span className="text-xs text-muted-foreground">{RUN_TRIGGER_LABELS[run.trigger]}</span>
            </div>
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">開始</dt>
              <dd className="tabular font-mono">{formatDateTimeJst(run.started_at)}</dd>
              <dt className="text-muted-foreground">終了</dt>
              <dd className="tabular font-mono">{formatDateTimeJst(run.finished_at) ?? <Dash />}</dd>
              <dt className="text-muted-foreground">処理件数</dt>
              <dd className="tabular font-mono">{formatCount(run.processed_count)}</dd>
            </dl>
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
                <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{formatDateTimeJst(run.started_at)}</td>
                <td className="tabular px-3 py-2 font-mono whitespace-nowrap">
                  {formatDateTimeJst(run.finished_at) ?? <Dash />}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{RUN_TARGET_LABELS[run.target]}</td>
                <td className="px-3 py-2 whitespace-nowrap">{RUN_TRIGGER_LABELS[run.trigger]}</td>
                <td className="px-3 py-2">
                  <RunStatusBadge status={run.status} />
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
