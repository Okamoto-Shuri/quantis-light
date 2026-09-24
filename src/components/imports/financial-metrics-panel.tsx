import { CircleDashed } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  OPERATING_MARGIN_REASON_LABELS,
  OPERATING_MARGIN_REASONS,
  REVENUE_CAGR_REASON_LABELS,
  REVENUE_CAGR_REASONS,
} from "@/lib/financials/display";
import type { FinancialSummary } from "@/lib/financials/queries";
import { formatCount } from "@/lib/format";
import type { Result } from "@/lib/listing/queries";

import { FetchIncompleteNotice } from "./financial-card";
import { SummaryNumber, SummaryTile } from "./summary-tile";

const Dash = () => <span className="text-muted-foreground">—</span>;

/** 算出不可の理由の行（CAGR と営業利益率で理由の組が違う。同じ文言の理由は1行にまとめる）。 */
const REASON_ROWS: { label: string; cagr: (typeof REVENUE_CAGR_REASONS)[number] | null; margin: (typeof OPERATING_MARGIN_REASONS)[number] | null }[] = [
  ...REVENUE_CAGR_REASONS.map((reason) => ({ label: REVENUE_CAGR_REASON_LABELS[reason], cagr: reason, margin: null })),
  ...OPERATING_MARGIN_REASONS.map((reason) => ({ label: OPERATING_MARGIN_REASON_LABELS[reason], cagr: null, margin: reason })),
];

function ReasonTable({ summary }: { summary: FinancialSummary }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium">算出不可の内訳</h3>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[30rem] text-sm" data-testid="financial-reasons-table">
          <thead className="border-b bg-surface text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">理由</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">売上CAGR（銘柄）</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">営業利益率（銘柄）</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {REASON_ROWS.map((row) => (
              <tr key={`${row.cagr ?? ""}:${row.margin ?? ""}`} data-reason={row.cagr ?? row.margin ?? ""}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {row.label}
                </th>
                <td className="tabular px-3 py-2 text-right font-mono">
                  {row.cagr ? formatCount(summary.revenueCagrReasons[row.cagr] ?? 0) : <Dash />}
                </td>
                <td className="tabular px-3 py-2 text-right font-mono">
                  {row.margin ? formatCount(summary.operatingMarginReasons[row.margin] ?? 0) : <Dash />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ summary }: { summary: FinancialSummary }) {
  const progress = summary.progress;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SummaryTile
        label="財務データのある銘柄"
        testId="financial-with-statements"
        value={<SummaryNumber value={formatCount(summary.withStatementsCount)} unit="銘柄" />}
        note={
          <>
            銘柄マスタ <span className="tabular font-mono">{formatCount(summary.stockCount)}</span> 銘柄のうち
          </>
        }
      />
      <SummaryTile
        label="売上CAGR を算出できた銘柄"
        testId="financial-cagr-count"
        value={<SummaryNumber value={formatCount(summary.revenueCagrCount)} unit="銘柄" />}
      />
      <SummaryTile
        label="営業利益率を算出できた銘柄"
        testId="financial-margin-count"
        value={<SummaryNumber value={formatCount(summary.operatingMarginCount)} unit="銘柄" />}
      />
      <SummaryTile
        label="取得済みの開示日"
        testId="financial-fetched-dates"
        value={
          progress ? (
            <SummaryNumber
              value={`${formatCount(Math.max(0, progress.datesInWindow - progress.datesRemaining))} / ${formatCount(progress.datesInWindow)}`}
              unit="日"
            />
          ) : (
            <span className="text-muted-foreground">—（財務の取り込み実績がありません）</span>
          )
        }
        note={
          progress ? (
            <>
              取得範囲 <span className="tabular font-mono">{progress.windowStart}</span>〜
              <span className="tabular font-mono">{progress.windowEnd}</span> の営業日
            </>
          ) : undefined
        }
      />
      <SummaryTile
        label="最新の開示日"
        testId="financial-latest-disclosure"
        value={summary.latestDisclosedDate ? <span className="tabular font-mono text-base">{summary.latestDisclosedDate}</span> : <Dash />}
      />
    </dl>
  );
}

/** 取り込み状況の画面の「財務指標（売上CAGR・営業利益率）」。値はすべて保存済みデータ（DB 関数）から作る。 */
export function FinancialMetricsPanel({ summary }: { summary: Result<FinancialSummary> }) {
  return (
    <section aria-labelledby="financial-heading" className="space-y-3" data-testid="financial-metrics">
      <div className="space-y-1">
        <h2 id="financial-heading" className="text-sm font-medium">
          財務指標（売上CAGR・営業利益率）
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          売上CAGRは、直近5期の通期実績（決算短信）から算出した成長4年分の年平均成長率です。営業利益率は、直近の通期実績の営業利益
          ÷ 売上高です。四半期決算と業績予想の値は使いません。表示は小数点以下1桁に切り捨てています（負の値は小さい方へ。例: −1.025%
          は −1.1%）。
        </p>
      </div>

      {!summary.ok ? (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>財務指標を取得できませんでした</AlertTitle>
          <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
        </Alert>
      ) : (
        <>
          <Summary summary={summary.value} />
          <FetchIncompleteNotice progress={summary.value.progress} />
          {summary.value.withStatementsCount === 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed bg-card px-4 py-5" data-testid="financial-empty-state">
              <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">財務データはまだ取り込まれていません</p>
                <p className="text-sm text-muted-foreground">
                  手動取り込みで対象「財務（決算短信）」を選んで「今すぐ取り込み」を押すか、定期実行を待ってください。
                </p>
              </div>
            </div>
          )}
          <ReasonTable summary={summary.value} />
        </>
      )}
    </section>
  );
}
