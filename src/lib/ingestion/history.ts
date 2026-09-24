import "server-only";

import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";

import { ingestionRunSchema, isStaleRun, RUN_HISTORY_LIMIT, type IngestionRun, type RunTarget } from "./runs";

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

export type ActiveRunResult = { ok: true; activeRun: IngestionRun | null } | { ok: false };

/**
 * 実行中の実行（応答の無くなったものを除く）。実行中は全体で1つまで（DB の一意制約）。
 * 応答の無くなった実行は、次の取り込みの開始時に「失敗」になるので、ボタンを押せる状態にする。
 */
export async function fetchActiveRun(supabase: SupabaseServerClient, now = new Date()): Promise<ActiveRunResult> {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id, target, trigger, status, started_at, finished_at, processed_count, error_message")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[imports] 実行中の実行の取得に失敗しました", error.message);
    return { ok: false };
  }
  const parsed = z.array(ingestionRunSchema).safeParse(data);
  if (!parsed.success) {
    console.error("[imports] 実行中の実行の形式が想定と異なります", parsed.error.message);
    return { ok: false };
  }
  const run = parsed.data[0] ?? null;
  return { ok: true, activeRun: run && !isStaleRun(run, now) ? run : null };
}

/** データソースごとの取り込み対象（実行履歴の target）。 */
export const SOURCE_TARGETS = {
  jquants: ["stock_master", "daily_quotes", "financials"],
  edinet: ["edinet_reports"],
} as const satisfies Record<string, readonly RunTarget[]>;

export type LastCompletedBySource = Record<keyof typeof SOURCE_TARGETS, string | null>;

/** データソースごとの、最後に完了した（成功または一部失敗の）実行の終了日時。 */
export async function fetchLastCompletedBySource(
  supabase: SupabaseServerClient,
): Promise<{ ok: true; value: LastCompletedBySource } | { ok: false }> {
  const entries = await Promise.all(
    (Object.keys(SOURCE_TARGETS) as (keyof typeof SOURCE_TARGETS)[]).map(async (source) => {
      const { data, error } = await supabase
        .from("ingestion_runs")
        .select("finished_at")
        .in("target", SOURCE_TARGETS[source])
        .in("status", ["succeeded", "partial"])
        .order("finished_at", { ascending: false })
        .limit(1);
      if (error) {
        console.error("[imports] 最終成功日時の取得に失敗しました", error.message);
        return null;
      }
      const parsed = z.array(z.object({ finished_at: z.string() })).safeParse(data);
      if (!parsed.success) return null;
      return [source, parsed.data[0]?.finished_at ?? null] as const;
    }),
  );
  if (entries.some((entry) => entry === null)) return { ok: false };
  return { ok: true, value: Object.fromEntries(entries as [string, string | null][]) as LastCompletedBySource };
}
