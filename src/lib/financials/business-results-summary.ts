import "server-only";

import { z } from "zod";

import type { Result } from "@/lib/listing/queries";
import type { createClient } from "@/lib/supabase/server";

/**
 * 取り込み状況の画面の「上場前の期の補完（EDINET）」の要約（Sprint 9）。DB 関数 business_results_summary（security invoker）を
 * ユーザーのセッションで1回呼ぶ。補った銘柄の数え方は financial_periods（出典の選び方の1か所）による。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const count = z.number().int().nonnegative();

export const businessResultsSummarySchema = z.object({
  stockCount: count,
  supplementedStockCount: count,
  supplementedCagrCount: count,
  processedAnnualReports: count,
  processedRegistrationStatements: count,
  statusCounts: z.partialRecord(z.enum(["ok", "no_xbrl", "section_not_found", "invalid_values"]), count),
  pendingDocumentCount: count,
  unlinkedRegistrationStatements: count,
  lastRun: z
    .object({
      status: z.string(),
      finishedAt: z.string().nullable(),
      processedCount: z.number(),
      details: z.record(z.string(), z.unknown()).nullable().catch(null),
    })
    .nullable(),
});

export type BusinessResultsSummary = z.infer<typeof businessResultsSummarySchema>;

export async function fetchBusinessResultsSummary(supabase: SupabaseServerClient): Promise<Result<BusinessResultsSummary>> {
  const { data, error } = await supabase.rpc("business_results_summary");
  if (error) {
    console.error("[imports] 上場前の期の補完の要約の取得に失敗しました", error.message);
    return { ok: false };
  }
  const parsed = businessResultsSummarySchema.safeParse(data);
  if (!parsed.success) {
    console.error("[imports] 上場前の期の補完の要約の形式が想定と異なります", parsed.error.message);
    return { ok: false };
  }
  return { ok: true, value: parsed.data };
}
