import "server-only";

import { z } from "zod";

import { fetchDataFreshness, type DataFreshness } from "@/lib/ingestion/freshness";
import { runStatusSchema, runTargetSchema } from "@/lib/ingestion/runs";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const count = z.number().int().nonnegative();

/** DB 関数 public.dashboard_summary() の戻り値。API（GET /api/dashboard）もこの形で返す。 */
export const dashboardSummarySchema = z.object({
  stockCount: count,
  /** 上場廃止の銘柄の数（Sprint 12。stockCount に含む） */
  delistedCount: count,
  financialMetrics: z.object({
    anyCount: count,
    revenueCagrCount: count,
    operatingMarginCount: count,
  }),
  ownershipDeterminedCount: count,
  lastCompletedRun: z
    .object({
      target: runTargetSchema,
      status: runStatusSchema,
      finishedAt: z.string(),
    })
    .nullable(),
  latestRun: z
    .object({
      target: runTargetSchema,
      status: runStatusSchema,
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
});

/**
 * ダッシュボードの集計に、データの鮮度（Sprint 12）を加えたもの。鮮度の取得に失敗したら freshness は null
 * （集計はそのまま表示し、鮮度の欄に「確認できませんでした」と示す。API も 200 で freshness: null）。
 */
export type DashboardSummary = z.infer<typeof dashboardSummarySchema> & { freshness: DataFreshness | null };

export type DashboardSummaryResult = { ok: true; summary: DashboardSummary } | { ok: false };

/**
 * ダッシュボードの集計を、ユーザー自身のセッションで取得する（RLS が効く経路）。
 * 失敗したときは件数 0 として扱わず、失敗として返す（障害を「データ無し」と誤認させない）。
 */
export async function fetchDashboardSummary(supabase: SupabaseServerClient): Promise<DashboardSummaryResult> {
  try {
    const [{ data, error }, freshness] = await Promise.all([supabase.rpc("dashboard_summary"), fetchDataFreshness(supabase)]);
    if (error) {
      console.error("[dashboard] 集計の取得に失敗しました", error.message);
      return { ok: false };
    }
    const parsed = dashboardSummarySchema.safeParse(data);
    if (!parsed.success) {
      console.error("[dashboard] 集計の形式が想定と異なります", parsed.error.message);
      return { ok: false };
    }
    return { ok: true, summary: { ...parsed.data, freshness } };
  } catch (error) {
    console.error("[dashboard] 集計の取得に失敗しました", error);
    return { ok: false };
  }
}

/** 銘柄が1件も無ければ「未取り込み」の空状態にする。 */
export function isEmptyDashboard(summary: DashboardSummary): boolean {
  return summary.stockCount === 0;
}
