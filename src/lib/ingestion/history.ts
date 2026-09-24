import "server-only";

import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";

import { ingestionRunSchema, RUN_HISTORY_LIMIT, type IngestionRun } from "./runs";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type RunHistoryResult =
  | { ok: true; runs: IngestionRun[]; hasMore: boolean }
  | { ok: false };

/** 実行履歴を開始日時の新しい順に読む（ユーザーのセッション＝RLS の経路）。 */
export async function fetchRunHistory(supabase: SupabaseServerClient): Promise<RunHistoryResult> {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id, target, trigger, status, started_at, finished_at, processed_count, error_message")
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RUN_HISTORY_LIMIT + 1);

  if (error) {
    console.error("[imports] 実行履歴の取得に失敗しました", error.message);
    return { ok: false };
  }
  const parsed = z.array(ingestionRunSchema).safeParse(data);
  if (!parsed.success) {
    console.error("[imports] 実行履歴の形式が想定と異なります", parsed.error.message);
    return { ok: false };
  }
  return {
    ok: true,
    runs: parsed.data.slice(0, RUN_HISTORY_LIMIT),
    hasMore: parsed.data.length > RUN_HISTORY_LIMIT,
  };
}
