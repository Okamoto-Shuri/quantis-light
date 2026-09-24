import { CircleAlert, CircleDashed, Info, Shuffle } from "lucide-react";

import {
  basisLabel,
  cagrPeriodText,
  describeOperatingMargin,
  describeRevenueCagr,
  fiscalPeriodLabel,
  formatMillionYen,
  periodRows,
  sourceLabel,
  type FetchProgress,
  type MetricDisplay,
} from "@/lib/financials/display";
import type { FinancialEntry } from "@/lib/financials/queries";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const Dash = () => <span className="text-muted-foreground">—</span>;

/** 開示日の取得が途中のときの注意（「5期未満」には取り込み途中の銘柄が含まれる）。 */
export function FetchIncompleteNotice({ progress, className }: { progress: FetchProgress | null; className?: string }) {
  if (!progress || progress.datesRemaining <= 0) return null;
  const done = Math.max(0, progress.datesInWindow - progress.datesRemaining);
  return (
    <p
      className={cn("flex items-start gap-2 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-xs text-caution-strong", className)}
      data-testid="financial-fetch-incomplete"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        開示日の取得が完了していないため、『通期実績が5期未満』には取り込み途中の銘柄が含まれます（取得済み{" "}
        <span className="tabular font-mono">{formatCount(done)}</span> /{" "}
        <span className="tabular font-mono">{formatCount(progress.datesInWindow)}</span> 日）
      </span>
    </p>
  );
}

/** 指標の値。数値はそのまま、算出不可はアイコンと文字で区別する（色だけに頼らない）。 */
export function MetricValue({ display, className }: { display: MetricDisplay; className?: string }) {
  if (display.kind === "value") return <span className={cn("tabular font-mono", className)}>{display.text}</span>;
  return (
    <span data-kind="unavailable" className="inline-flex items-start gap-1.5 text-sm text-muted-foreground">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{display.text}</span>
    </span>
  );
}

function PeriodTable({ entry }: { entry: FinancialEntry }) {
  const rows = periodRows(entry.periods, entry.metrics);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[44rem] text-sm" data-testid="financial-periods-table">
        <thead className="border-b bg-surface text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">位置</th>
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">決算期</th>
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">期間</th>
            <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">売上高（百万円）</th>
            <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">営業利益（百万円）</th>
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">基準</th>
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">出典</th>
            <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">開示日</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ period, position }) => (
            <tr key={period.fiscal_year_end} data-fiscal-year-end={period.fiscal_year_end}>
              <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{position ?? <Dash />}</td>
              <td className="tabular px-3 py-2 font-mono whitespace-nowrap">{fiscalPeriodLabel(period.fiscal_year_end)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="tabular font-mono">
                  {period.fiscal_year_start}〜{period.fiscal_year_end}
                </span>
                {period.is_irregular && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 rounded-sm bg-caution-muted px-1.5 py-0.5 text-xs text-caution-strong"
                    data-testid="irregular-badge"
                  >
                    <Shuffle aria-hidden="true" className="size-3" />
                    変則決算（{period.period_months}か月）
                  </span>
                )}
              </td>
              <td className="tabular px-3 py-2 text-right font-mono whitespace-nowrap">
                {period.net_sales === null ? <span className="font-sans text-muted-foreground">開示なし</span> : formatMillionYen(period.net_sales)}
              </td>
              <td className="tabular px-3 py-2 text-right font-mono whitespace-nowrap">
                {period.operating_profit === null ? (
                  <span className="font-sans text-muted-foreground">開示なし</span>
                ) : (
                  formatMillionYen(period.operating_profit)
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{basisLabel(period.consolidated, period.accounting_standard)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{sourceLabel(period.source)}</span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className="tabular font-mono">{period.source_document_date}</span>
                {period.disclosure_count > 1 && (
                  <span className="ml-2 text-xs text-muted-foreground" data-testid="corrected-badge">
                    訂正あり（{period.disclosure_count}件）
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 銘柄コードで確認したときの、財務指標のカード（売上CAGR・営業利益率と通期実績の表）。 */
export function FinancialCard({ entry, progress }: { entry: FinancialEntry; progress: FetchProgress | null }) {
  const { metrics } = entry;
  return (
    <article className="min-w-0 space-y-3 rounded-lg border bg-card px-4 py-3" data-testid="financial-card" aria-labelledby="financial-card-heading">
      <h4 id="financial-card-heading" className="text-sm font-medium whitespace-nowrap">
        財務指標
      </h4>
      {!metrics ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="financial-empty">
          <CircleDashed aria-hidden="true" className="size-3.5 shrink-0" />
          財務データがありません（未取り込み）
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">売上CAGR</dt>
            <dd className="min-w-0 space-y-0.5" data-testid="financial-cagr">
              <MetricValue display={describeRevenueCagr(metrics)} className="text-base font-medium" />
              {metrics.revenue_cagr_unavailable_reason === null && metrics.revenue_cagr_base_fiscal_year_end ? (
                <span className="block text-xs text-muted-foreground" data-testid="financial-cagr-period">
                  {cagrPeriodText(metrics.revenue_cagr_base_fiscal_year_end, metrics.latest_fiscal_year_end)}
                </span>
              ) : (
                <span className="block text-xs text-muted-foreground">
                  取得済みの通期実績: <span className="tabular font-mono">{formatCount(metrics.annual_period_count)}</span> 期
                </span>
              )}
              {metrics.revenue_cagr_mixed_basis && (
                <span className="block text-xs text-caution-strong" data-testid="financial-mixed-basis">
                  連結と単体、または会計基準が異なる期を含みます
                </span>
              )}
            </dd>
            <dt className="text-muted-foreground">営業利益率</dt>
            <dd className="min-w-0 space-y-0.5" data-testid="financial-margin">
              <MetricValue display={describeOperatingMargin(metrics)} className="text-base font-medium" />
              <span className="block text-xs text-muted-foreground">{fiscalPeriodLabel(metrics.latest_fiscal_year_end)}</span>
            </dd>
          </dl>
          <FetchIncompleteNotice progress={progress} />
          <PeriodTable entry={entry} />
        </>
      )}
    </article>
  );
}
