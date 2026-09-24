import "server-only";

import { z } from "zod";

import type { Result } from "@/lib/listing/queries";
import type { createClient } from "@/lib/supabase/server";

import {
  FINANCIAL_METRICS_COLUMNS,
  FINANCIAL_PERIOD_COLUMNS,
  financialMetricsSchema,
  financialPeriodSchema,
  OPERATING_MARGIN_REASONS,
  REVENUE_CAGR_REASONS,
  type FetchProgress,
  type FinancialMetrics,
  type FinancialPeriod,
} from "./display";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function fail(label: string, message: string): { ok: false } {
  console.error(`[financials] ${label}に失敗しました`, message);
  return { ok: false };
}

const count = z.number().int().nonnegative();

const summarySchema = z.object({
  stockCount: count,
  withStatementsCount: count,
  revenueCagrCount: count,
  operatingMarginCount: count,
  latestDisclosedDate: z.string().nullable(),
  revenueCagrReasons: z.partialRecord(z.enum(REVENUE_CAGR_REASONS), count),
  operatingMarginReasons: z.partialRecord(z.enum(OPERATING_MARGIN_REASONS), count),
  lastRun: z
    .object({
      finishedAt: z.string(),
      windowStart: z.string().nullable(),
      windowEnd: z.string().nullable(),
      datesInWindow: z.number().nullable(),
      datesRemaining: z.number().nullable(),
    })
    .nullable(),
});

export type FinancialSummary = {
  stockCount: number;
  withStatementsCount: number;
  revenueCagrCount: number;
  operatingMarginCount: number;
  latestDisclosedDate: string | null;
  revenueCagrReasons: Partial<Record<(typeof REVENUE_CAGR_REASONS)[number], number>>;
  operatingMarginReasons: Partial<Record<(typeof OPERATING_MARGIN_REASONS)[number], number>>;
  /** 最後に終わった財務の実行の取得の進み具合。実行が無ければ null。 */
  progress: FetchProgress | null;
};

/** 取り込み状況の画面の「財務指標」の要約（DB 関数 financial_metrics_summary を1回呼ぶ。RLS が効く）。 */
export async function fetchFinancialSummary(supabase: SupabaseServerClient): Promise<Result<FinancialSummary>> {
  const { data, error } = await supabase.rpc("financial_metrics_summary");
  if (error) return fail("財務指標の要約の取得", error.message);
  const parsed = summarySchema.safeParse(data);
  if (!parsed.success) return fail("財務指標の要約の形式の確認", parsed.error.message);
  const { lastRun, ...rest } = parsed.data;
  const progress =
    lastRun && lastRun.windowStart && lastRun.windowEnd && lastRun.datesInWindow !== null && lastRun.datesRemaining !== null
      ? {
          windowStart: lastRun.windowStart,
          windowEnd: lastRun.windowEnd,
          datesInWindow: lastRun.datesInWindow,
          datesRemaining: lastRun.datesRemaining,
        }
      : null;
  return { ok: true, value: { ...rest, progress } };
}

export type FinancialEntry = { metrics: FinancialMetrics | null; periods: FinancialPeriod[] };

/** 1銘柄の指標と通期実績（全期間、古い順）。 */
export async function fetchFinancialEntry(supabase: SupabaseServerClient, code: string): Promise<Result<FinancialEntry>> {
  const [metrics, periods] = await Promise.all([
    supabase.from("financial_metrics").select(FINANCIAL_METRICS_COLUMNS).eq("code", code).limit(1),
    supabase.from("financial_periods").select(FINANCIAL_PERIOD_COLUMNS).eq("code", code).order("fiscal_year_end", { ascending: true }),
  ]);
  if (metrics.error) return fail("財務指標の取得", metrics.error.message);
  if (periods.error) return fail("通期実績の取得", periods.error.message);
  const parsedMetrics = z.array(financialMetricsSchema).safeParse(metrics.data);
  if (!parsedMetrics.success) return fail("財務指標の形式の確認", parsedMetrics.error.message);
  const parsedPeriods = z.array(financialPeriodSchema).safeParse(periods.data);
  if (!parsedPeriods.success) return fail("通期実績の形式の確認", parsedPeriods.error.message);
  return { ok: true, value: { metrics: parsedMetrics.data[0] ?? null, periods: parsedPeriods.data } };
}

/** 複数の銘柄の指標（GET /api/stocks 用）。 */
export async function fetchFinancialMetrics(
  supabase: SupabaseServerClient,
  codes: string[],
): Promise<Result<Map<string, FinancialMetrics>>> {
  if (codes.length === 0) return { ok: true, value: new Map() };
  const { data, error } = await supabase.from("financial_metrics").select(FINANCIAL_METRICS_COLUMNS).in("code", codes);
  if (error) return fail("財務指標の取得", error.message);
  const parsed = z.array(financialMetricsSchema).safeParse(data);
  if (!parsed.success) return fail("財務指標の形式の確認", parsed.error.message);
  return { ok: true, value: new Map(parsed.data.map((row) => [row.code, row])) };
}
