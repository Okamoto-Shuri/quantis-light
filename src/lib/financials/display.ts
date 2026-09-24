import { z } from "zod";

import { formatCount } from "@/lib/format";

/**
 * 財務指標と通期実績の表示。値はすべて DB（financial_metrics・financial_periods）が算出・選択したものを使い、
 * アプリ側では計算しない（表示用の *_display_pct は DB の生成列で、百分率の小数点以下1桁に切り捨て済み）。
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** numeric は PostgREST から数値（または文字列）で返る。 */
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);

export const REVENUE_CAGR_REASONS = [
  "irregular_period",
  "insufficient_periods",
  "non_consecutive_periods",
  "revenue_not_disclosed",
  "base_revenue_not_positive",
  "latest_revenue_negative",
] as const;
export const OPERATING_MARGIN_REASONS = ["operating_profit_not_disclosed", "revenue_not_disclosed", "revenue_not_positive"] as const;

export type RevenueCagrReason = (typeof REVENUE_CAGR_REASONS)[number];
export type OperatingMarginReason = (typeof OPERATING_MARGIN_REASONS)[number];

export const REVENUE_CAGR_REASON_LABELS: Record<RevenueCagrReason, string> = {
  irregular_period: "直近5期に変則決算を含む",
  insufficient_periods: "通期実績が5期未満",
  non_consecutive_periods: "直近5期の通期実績が連続していない",
  revenue_not_disclosed: "売上高の開示がない期がある",
  base_revenue_not_positive: "FY-4 の売上高が0以下",
  latest_revenue_negative: "直近期の売上高がマイナス",
};

export const OPERATING_MARGIN_REASON_LABELS: Record<OperatingMarginReason, string> = {
  operating_profit_not_disclosed: "営業利益の開示なし",
  revenue_not_disclosed: "売上高の開示なし",
  revenue_not_positive: "売上高が0以下",
};

export const financialMetricsSchema = z.object({
  code: z.string(),
  revenue_cagr: numeric.nullable(),
  revenue_cagr_display_pct: numeric.nullable(),
  revenue_cagr_unavailable_reason: z.enum(REVENUE_CAGR_REASONS).nullable(),
  revenue_cagr_base_fiscal_year_end: dateString.nullable(),
  revenue_cagr_period_count: z.number().int(),
  revenue_cagr_mixed_basis: z.boolean().nullable(),
  operating_margin: numeric.nullable(),
  operating_margin_display_pct: numeric.nullable(),
  operating_margin_unavailable_reason: z.enum(OPERATING_MARGIN_REASONS).nullable(),
  latest_fiscal_year_end: dateString,
  annual_period_count: z.number().int(),
  calculated_at: z.string(),
});
export type FinancialMetrics = z.infer<typeof financialMetricsSchema>;

export const FINANCIAL_METRICS_COLUMNS =
  "code, revenue_cagr, revenue_cagr_display_pct, revenue_cagr_unavailable_reason, revenue_cagr_base_fiscal_year_end, revenue_cagr_period_count, revenue_cagr_mixed_basis, operating_margin, operating_margin_display_pct, operating_margin_unavailable_reason, latest_fiscal_year_end, annual_period_count, calculated_at";

export const financialPeriodSchema = z.object({
  code: z.string(),
  fiscal_year_start: dateString,
  fiscal_year_end: dateString,
  period_days: z.number().int(),
  period_months: z.number().int(),
  is_irregular: z.boolean(),
  net_sales: numeric.nullable(),
  operating_profit: numeric.nullable(),
  consolidated: z.boolean(),
  accounting_standard: z.string(),
  document_type: z.string(),
  source: z.string(),
  source_priority: z.number().int(),
  source_document_id: z.string(),
  source_document_date: dateString,
  disclosure_no: z.string().nullable(),
  disclosed_date: dateString.nullable(),
  disclosure_count: z.number().int(),
});
export type FinancialPeriod = z.infer<typeof financialPeriodSchema>;

export const FINANCIAL_PERIOD_COLUMNS =
  "code, fiscal_year_start, fiscal_year_end, period_days, period_months, is_irregular, net_sales, operating_profit, consolidated, accounting_standard, document_type, source, source_priority, source_document_id, source_document_date, disclosure_no, disclosed_date, disclosure_count";

/** DB で切り捨て済みの百分率（小数点以下1桁）を「41.4%」の形にする。 */
export function formatPercent(displayPct: number): string {
  return `${displayPct.toFixed(1)}%`;
}

/** 円の金額を百万円の3桁区切りの整数にする（四捨五入。0.5 は 0 から遠い方へ）。 */
export function formatMillionYen(yen: number): string {
  const millions = Math.sign(yen) * Math.round(Math.abs(yen) / 1_000_000);
  return formatCount(millions === 0 ? 0 : millions);
}

/** 事業年度の終了日から「2025/03期」。 */
export function fiscalPeriodLabel(fiscalYearEnd: string): string {
  return `${fiscalYearEnd.slice(0, 4)}/${fiscalYearEnd.slice(5, 7)}期`;
}

/** 売上CAGR の期間（「2021/03期 → 2025/03期（4年）」）。 */
export function cagrPeriodText(baseFiscalYearEnd: string, latestFiscalYearEnd: string): string {
  return `${fiscalPeriodLabel(baseFiscalYearEnd)} → ${fiscalPeriodLabel(latestFiscalYearEnd)}（4年）`;
}

const STANDARD_LABELS: Record<string, string> = {
  JP: "日本基準",
  US: "米国基準",
  IFRS: "IFRS",
  JMIS: "JMIS",
  Foreign: "外国基準",
};

/** 連結・単体と会計基準（「連結・日本基準」）。 */
export function basisLabel(consolidated: boolean, accountingStandard: string): string {
  return `${consolidated ? "連結" : "単体"}・${STANDARD_LABELS[accountingStandard] ?? accountingStandard}`;
}

const SOURCE_LABELS: Record<string, string> = {
  tdnet_summary: "決算短信",
};

/** 期の値の出典（「決算短信」）。 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export type MetricDisplay = { kind: "value"; text: string } | { kind: "unavailable"; text: string };

export function describeRevenueCagr(metrics: Pick<FinancialMetrics, "revenue_cagr_display_pct" | "revenue_cagr_unavailable_reason">): MetricDisplay {
  if (metrics.revenue_cagr_unavailable_reason) {
    return { kind: "unavailable", text: `算出不可（${REVENUE_CAGR_REASON_LABELS[metrics.revenue_cagr_unavailable_reason]}）` };
  }
  return { kind: "value", text: formatPercent(metrics.revenue_cagr_display_pct ?? 0) };
}

export function describeOperatingMargin(
  metrics: Pick<FinancialMetrics, "operating_margin_display_pct" | "operating_margin_unavailable_reason">,
): MetricDisplay {
  if (metrics.operating_margin_unavailable_reason) {
    return {
      kind: "unavailable",
      text: `算出不可（${OPERATING_MARGIN_REASON_LABELS[metrics.operating_margin_unavailable_reason]}）`,
    };
  }
  return { kind: "value", text: formatPercent(metrics.operating_margin_display_pct ?? 0) };
}

/**
 * 通期実績の表の行（新しい6期までを古い順に）。FY0 から連続して CAGR に使った期に FY-4〜FY0 の位置を付ける。
 * 位置は DB の revenue_cagr_period_count（FY0 から連続する期の数）から付ける（期の連続の判定は DB が行う）。
 */
export function periodRows(periods: readonly FinancialPeriod[], metrics: Pick<FinancialMetrics, "revenue_cagr_period_count"> | null) {
  const newestFirst = [...periods].sort((a, b) => (a.fiscal_year_end < b.fiscal_year_end ? 1 : -1)).slice(0, 6);
  const chain = metrics?.revenue_cagr_period_count ?? 0;
  return newestFirst
    .map((period, index) => ({ period, position: index < chain ? (index === 0 ? "FY0" : `FY-${index}`) : null }))
    .reverse();
}

/** 取得済みの開示日の進み具合（最後の財務の実行の details から）。 */
export type FetchProgress = {
  windowStart: string;
  windowEnd: string;
  datesInWindow: number;
  datesRemaining: number;
};
