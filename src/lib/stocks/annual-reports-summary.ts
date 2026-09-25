import "server-only";

import { z } from "zod";

import type { Result } from "@/lib/listing/queries";
import type { createClient } from "@/lib/supabase/server";

/**
 * 取り込み状況の画面の「有価証券報告書（大株主・役員）」の要約。DB 関数 annual_reports_summary（security invoker）を
 * ユーザーのセッションで1回呼ぶ。数え方は DB のビュー annual_report_sections（書類の選び方の1か所）による。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const count = z.number().int().nonnegative();

const lastRunDetailsSchema = z
  .object({
    windowStart: z.string().optional(),
    windowEnd: z.string().optional(),
    listDatesInWindow: z.number().optional(),
    listDatesRemaining: z.number().optional(),
    documentsProcessed: z.number().optional(),
  })
  .passthrough()
  .nullable();

export const annualReportsSummarySchema = z.object({
  stockCount: count,
  documentCount: count,
  fetchedStockCount: count,
  bothExtractedCount: count,
  notExtractedCount: count,
  pendingDocumentCount: count,
  listDatesFetched: count,
  /** Sprint 10: 条件④の判定の件数（判定できた・判定不能の理由ごと。有報が未取得は銘柄マスタから判定の行の数を引いたもの） */
  ownership: z.object({
    determinedCount: count,
    noAnnualReportCount: count,
    annualReportPendingCount: count,
    shareholdersNotExtractedCount: count,
    officersNotExtractedCount: count,
    presidentNotFoundCount: count,
    previousReportCount: count,
  }),
  lastRun: z
    .object({
      status: z.string(),
      finishedAt: z.string().nullable(),
      processedCount: z.number(),
      details: lastRunDetailsSchema.catch(null),
    })
    .nullable(),
});

export type AnnualReportsSummary = z.infer<typeof annualReportsSummarySchema>;

export async function fetchAnnualReportsSummary(supabase: SupabaseServerClient): Promise<Result<AnnualReportsSummary>> {
  const { data, error } = await supabase.rpc("annual_reports_summary");
  if (error) {
    console.error("[imports] 有報の要約の取得に失敗しました", error.message);
    return { ok: false };
  }
  const parsed = annualReportsSummarySchema.safeParse(data);
  if (!parsed.success) {
    console.error("[imports] 有報の要約の形式が想定と異なります", parsed.error.message);
    return { ok: false };
  }
  return { ok: true, value: parsed.data };
}
