import { ArrowRight, CircleAlert, CircleCheck, CircleMinus, CircleSlash, Filter } from "lucide-react";
import Link from "next/link";

import { STATUS_LABELS, StatusIcon, statusTone } from "@/components/screening/status-mark";
import { describeOperatingMargin, describeRevenueCagr, type FinancialMetrics } from "@/lib/financials/display";
import type { ConditionKey } from "@/lib/screening/params";
import type { ConditionStatus } from "@/lib/screening/result";
import { MARKETS, SECTOR33_NAMES } from "@/lib/screening/sectors";
import { CONDITION_NAMES, describeInclusion, type DetailConditions, type InclusionKind, type StockDetail } from "@/lib/stocks/detail";
import { cn } from "@/lib/utils";

import { yearsSummary, type ValueDisplay } from "./years-text";

const CONDITION_TITLES: Record<ConditionKey, string> = { cagr: "売上CAGR", margin: "営業利益率", years: "上場年数" };

function thresholdLabel(key: ConditionKey, threshold: string, off: boolean) {
  if (off) return "オフ（絞り込みに使っていない）";
  return key === "years" ? `${threshold}年以内` : `≥ ${threshold}%`;
}

function StatusBadge({ status }: { status: ConditionStatus }) {
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap", statusTone(status))}
      data-testid="evaluation-status"
    >
      <StatusIcon status={status} className="size-3.5" strokeWidth={2.5} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function valueOf(key: ConditionKey, detail: StockDetail, metrics: FinancialMetrics | null): ValueDisplay {
  if (key === "years") return yearsSummary(detail.listing, detail.referenceDate);
  if (!metrics) return { text: "財務データなし", unavailable: true };
  const display = key === "cagr" ? describeRevenueCagr(metrics) : describeOperatingMargin(metrics);
  return { text: display.text, unavailable: display.kind === "unavailable" };
}

function InclusionIcon({ kind }: { kind: InclusionKind }) {
  const className = "mt-0.5 size-4 shrink-0";
  if (kind === "included") return <CircleCheck aria-hidden="true" className={className} />;
  if (kind === "filters") return <Filter aria-hidden="true" className={className} />;
  if (kind === "unmet") return <CircleMinus aria-hidden="true" className={className} />;
  return <CircleSlash aria-hidden="true" className={className} />;
}

/**
 * 条件の判定（AC7.4）。判定（状態・絞り込み・結果に含まれるか）は DB の stock_detail（スクリーニングと同じ式）の値で、
 * ここでは表示だけを行う。
 */
export function StockEvaluation({
  detail,
  metrics,
  dc,
}: {
  detail: StockDetail;
  metrics: FinancialMetrics | null;
  dc: DetailConditions;
}) {
  const { conditions } = dc;
  const inclusion = describeInclusion(detail.evaluation);
  const markets = MARKETS.filter((market) => conditions.market.includes(market.code)).map((market) => market.name);
  const sectors = conditions.sector.map((code) => SECTOR33_NAMES.get(code) ?? code);
  const hasFilters = markets.length > 0 || sectors.length > 0;

  return (
    <section aria-labelledby="evaluation-heading" className="space-y-3 rounded-lg border bg-card p-4" data-testid="stock-evaluation">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="evaluation-heading" className="text-base font-semibold tracking-tight">
          条件の判定
        </h2>
        <p className="text-xs text-muted-foreground" data-testid="evaluation-source" data-source={dc.source}>
          {dc.source === "screening" ? "スクリーニングの条件で判定しています" : "既定の条件で判定しています"}
        </p>
      </div>

      {dc.invalidFields.length > 0 && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-xs text-caution-strong"
          data-testid="invalid-params-notice"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          URL の条件の一部（{dc.invalidFields.join(", ")}）が無効なため、既定値で判定しています
        </p>
      )}

      <p
        className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
          detail.evaluation.included ? "bg-signal-muted text-signal-strong" : "bg-muted text-foreground",
        )}
        data-testid="evaluation-inclusion"
        data-included={detail.evaluation.included}
        data-kind={inclusion.kind}
      >
        <InclusionIcon kind={inclusion.kind} />
        <span>{inclusion.text}</span>
      </p>

      <ul className="divide-y rounded-md border" aria-label="条件ごとの判定">
        {(["cagr", "margin", "years"] as const).map((key) => {
          const status = detail.evaluation.status[key];
          const off = status === "off";
          const value = valueOf(key, detail, metrics);
          return (
            <li key={key} className="flex items-center gap-3 px-3 py-2" data-testid={`evaluation-${key}`} data-status={status}>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  {CONDITION_NAMES[key]} {CONDITION_TITLES[key]}
                </p>
                <p
                  className={cn("tabular font-mono text-sm", off ? "text-muted-foreground" : "font-medium text-foreground")}
                  data-testid="evaluation-threshold"
                >
                  {thresholdLabel(key, conditions[key], off)}
                </p>
              </div>
              <p className="max-w-[45%] text-right text-sm" data-testid="evaluation-value">
                <span
                  className={cn(value.unavailable ? "text-xs text-muted-foreground italic" : "tabular font-mono")}
                  data-kind={value.unavailable ? "unavailable" : "value"}
                >
                  {value.text}
                </span>
              </p>
              <StatusBadge status={status} />
            </li>
          );
        })}
      </ul>

      {hasFilters && (
        <p className="text-xs text-muted-foreground" data-testid="evaluation-filters" data-matches={detail.evaluation.matchesFilters}>
          絞り込み: {markets.length > 0 && <>市場区分: {markets.join("・")}</>}
          {markets.length > 0 && sectors.length > 0 && " ／ "}
          {sectors.length > 0 && <>業種: {sectors.join("・")}</>}
          {" — "}
          <span className={detail.evaluation.matchesFilters ? "text-signal-strong" : "text-foreground"}>
            {detail.evaluation.matchesFilters ? "この銘柄は当てはまります" : "この銘柄は当てはまりません"}
          </span>
        </p>
      )}

      <Link
        href={dc.screeningHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-signal-strong underline-offset-4 hover:underline"
        data-testid="change-conditions"
      >
        条件を変える（スクリーニングに戻る）
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </section>
  );
}
