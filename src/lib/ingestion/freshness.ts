import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { remainingUnitSchema, runTargetSchema } from "./runs";

/**
 * データの鮮度と未取得の残り（DB 関数 public.data_freshness() の1か所で判定する。契約 sprint-12 の第2章の4・5）。
 * 画面・API はこの値を表示するだけで、48 時間の比較をアプリでしない。
 */
export const dataFreshnessSchema = z.object({
  stale: z.boolean(),
  lastUpdatedAt: z.string().nullable(),
  targets: z.array(
    z.object({
      target: runTargetSchema,
      lastUpdatedAt: z.string().nullable(),
      stale: z.boolean(),
      remainingCount: z.number().int().positive().nullable(),
      remainingUnit: remainingUnitSchema.nullable(),
    }),
  ),
});

export type DataFreshness = z.infer<typeof dataFreshnessSchema>;

/**
 * 鮮度を読む（ユーザーのセッション＝RLS の経路）。失敗・形の違いは null（例外を投げない）。
 * 呼び出し側は、null を「警告なし」として描画を続ける（保護画面の枠）か、「確認できませんでした」と示す（ダッシュボード）。
 */
export async function fetchDataFreshness(supabase: Pick<SupabaseClient, "rpc">): Promise<DataFreshness | null> {
  try {
    const { data, error } = await supabase.rpc("data_freshness");
    if (error) {
      console.error("[freshness] データの鮮度の取得に失敗しました", error.message);
      return null;
    }
    const parsed = dataFreshnessSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[freshness] データの鮮度の形式が想定と異なります", parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.error("[freshness] データの鮮度の取得に失敗しました", error instanceof Error ? error.message : "不明");
    return null;
  }
}

/** 残りのある target（未取得の残りの注記。定期実行の順）。 */
export function remainingTargets(freshness: DataFreshness | null) {
  if (!freshness) return [];
  return freshness.targets.flatMap((t) =>
    t.remainingCount !== null && t.remainingUnit !== null
      ? [{ target: t.target, count: t.remainingCount, unit: t.remainingUnit }]
      : [],
  );
}
