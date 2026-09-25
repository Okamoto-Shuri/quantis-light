import { ArrowRight, CircleAlert, CircleDashed } from "lucide-react";
import Link from "next/link";

import { ProvisionalCagrNote } from "@/components/screening/status-mark";
import {
  cagrPeriodText,
  describeOperatingMargin,
  describeRevenueCagr,
  fiscalPeriodLabel,
  formatMillionYen,
  type FinancialPeriod,
  type MetricDisplay,
} from "@/lib/financials/display";
import type { FinancialEntry } from "@/lib/financials/queries";
import { formatCount } from "@/lib/format";
import type { StockDetail } from "@/lib/stocks/detail";
import { cn } from "@/lib/utils";

function Card({ testId, title, children }: { testId: string; title: string; children: React.ReactNode }) {
  return (
    <article className="min-w-0 space-y-1.5 rounded-lg border bg-card px-4 py-3" data-testid={testId}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </article>
  );
}

/** 大きな値。算出不可はアイコンと文字で数値と区別する（色だけに頼らない）。 */
function BigValue({ display }: { display: MetricDisplay }) {
  if (display.kind === "value") {
    return (
      <p className="tabular font-mono text-2xl font-semibold tracking-tight" data-testid="metric-value" data-kind="value">
        {display.text}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-sm font-medium text-muted-foreground" data-testid="metric-value" data-kind="unavailable">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{display.text}</span>
    </p>
  );
}

function Sub({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)} data-testid={testId}>
      {children}
    </p>
  );
}

function NoFinancials() {
  return (
    <>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="metric-value" data-kind="unavailable">
        <CircleDashed aria-hidden="true" className="size-4 shrink-0" />
        財務データなし（未取り込み）
      </p>
      <Link href="/imports" className="inline-flex items-center gap-1 text-xs text-signal-strong underline-offset-2 hover:underline">
        取り込み状況を見る
        <ArrowRight aria-hidden="true" className="size-3" />
      </Link>
    </>
  );
}

const yen = (value: number | null) => (value === null ? "開示なし" : formatMillionYen(value));

function CagrCard({ entry }: { entry: FinancialEntry }) {
  const { metrics } = entry;
  return (
    <Card testId="metric-cagr" title="売上CAGR（直近5期・成長4年分）">
      {!metrics ? (
        <NoFinancials />
      ) : (
        <>
          <BigValue display={describeRevenueCagr(metrics)} />
          {metrics.revenue_cagr_unavailable_reason === null && metrics.revenue_cagr_base_fiscal_year_end ? (
            <Sub testId="metric-cagr-period">算出に使った期: {cagrPeriodText(metrics.revenue_cagr_base_fiscal_year_end, metrics.latest_fiscal_year_end)}</Sub>
          ) : (
            <Sub testId="metric-cagr-period">
              取得済みの通期実績: <span className="tabular font-mono">{formatCount(metrics.annual_period_count)}</span> 期
            </Sub>
          )}
          {metrics.revenue_cagr_mixed_basis && (
            <Sub className="text-caution-strong" testId="metric-mixed-basis">
              連結と単体、または会計基準が異なる期を含みます
            </Sub>
          )}
          {metrics.revenue_cagr_unavailable_reason === "insufficient_periods" && <ProvisionalCagrNote />}
        </>
      )}
    </Card>
  );
}

function MarginCard({ entry }: { entry: FinancialEntry }) {
  const { metrics } = entry;
  const latest: FinancialPeriod | undefined = metrics ? entry.periods.find((p) => p.fiscal_year_end === metrics.latest_fiscal_year_end) : undefined;
  return (
    <Card testId="metric-margin" title="営業利益率（直近通期）">
      {!metrics ? (
        <NoFinancials />
      ) : (
        <>
          <BigValue display={describeOperatingMargin(metrics)} />
          <Sub testId="metric-margin-basis">
            <span className="tabular font-mono">{fiscalPeriodLabel(metrics.latest_fiscal_year_end)}</span>
            {latest && latest.operating_profit === null ? (
              // 算出不可の理由は見出しにあるので、割り算の形は出さない（Sprint 7 評価の m3）
              <>
                : 営業利益の開示なし（売上高 <span className="tabular font-mono">{yen(latest.net_sales)}</span> 百万円）
              </>
            ) : (
              latest && (
                <>
                  : 営業利益 <span className="tabular font-mono">{yen(latest.operating_profit)}</span> ÷ 売上高{" "}
                  <span className="tabular font-mono">{yen(latest.net_sales)}</span>（百万円）
                </>
              )
            )}
          </Sub>
        </>
      )}
    </Card>
  );
}

function YearsCard({ detail }: { detail: StockDetail }) {
  const { listing, referenceDate } = detail;
  let value: MetricDisplay;
  let subs: React.ReactNode[] = [];
  if (!listing) {
    value = { kind: "unavailable", text: "未確定（株価の初出日が未取り込み）" };
  } else if (!referenceDate) {
    value = { kind: "unavailable", text: "基準日なし（株価の取り込み実績がありません）" };
    subs = [
      <>
        初出日 <span className="tabular font-mono">{listing.first_price_date}</span>
      </>,
    ];
  } else if (listing.listed_before_data_start) {
    value = { kind: "value", text: `${listing.listing_years_lower_bound ?? 0}年超` };
    subs = [
      <span key="b" className="font-medium text-foreground">
        データ期間開始以前から上場（{listing.listing_years_lower_bound ?? 0}年超）
      </span>,
      <>
        データ期間の開始日 <span className="tabular font-mono">{listing.data_start_date}</span>。これより前の上場日は分かりません
      </>,
    ];
  } else {
    value = { kind: "value", text: `${(listing.estimated_listing_years ?? 0).toFixed(1)}年` };
    subs = [
      <>
        初出日 <span className="tabular font-mono">{listing.first_price_date}</span> → 基準日{" "}
        <span className="tabular font-mono">{referenceDate}</span>
      </>,
    ];
  }
  return (
    <Card testId="metric-years" title="推定上場年数">
      <BigValue display={value} />
      {subs.map((sub, i) => (
        <Sub key={i}>{sub}</Sub>
      ))}
      <Sub>株価データの初出日からの推定</Sub>
    </Card>
  );
}

/** 指標（AC7.3）。値はすべて DB が算出したもので、アプリ側では計算しない。 */
export function StockMetrics({ detail, entry }: { detail: StockDetail; entry: FinancialEntry }) {
  return (
    <section aria-label="指標" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1" data-testid="stock-metrics">
      <CagrCard entry={entry} />
      <MarginCard entry={entry} />
      <YearsCard detail={detail} />
    </section>
  );
}
