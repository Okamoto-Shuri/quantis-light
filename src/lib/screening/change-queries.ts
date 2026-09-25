import "server-only";

import { z } from "zod";

import type { Result } from "@/lib/listing/queries";
import type { createClient } from "@/lib/supabase/server";

import { cycleRunSchema, screeningChangesSchema, type CycleRun, type ScreeningChanges } from "./changes";
import { toScreenStocksParams, type ScreeningConditions } from "./params";

/**
 * 新たに該当・外れた（Sprint 14）の読み出し。ユーザーのセッション（RLS が効く経路。条件④は呼び出したユーザーの今の補正）で
 * DB 関数 screening_changes を1回呼ぶ。外部 API は呼ばない。失敗は ok: false（0件として扱わない）。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function fail(label: string, message: string): { ok: false } {
  console.error(`[changes] ${label}に失敗しました`, message);
  return { ok: false };
}

export async function fetchScreeningChanges(supabase: SupabaseServerClient, conditions: ScreeningConditions): Promise<Result<ScreeningChanges>> {
  const { data, error } = await supabase.rpc("screening_changes", { p_params: toScreenStocksParams(conditions, { clampPage: false }) });
  if (error) return fail("新たに該当・外れた銘柄の取得", error.message);
  const parsed = screeningChangesSchema.safeParse(data);
  if (!parsed.success) return fail("新たに該当・外れた銘柄の形式の確認", parsed.error.message);
  return { ok: true, value: parsed.data };
}

/** 記録（capturedAt）の後に始まった実行（開始の古い順）。今回の取り込みの注記に使う */
export async function fetchCycleRuns(supabase: SupabaseServerClient, capturedAt: string): Promise<Result<CycleRun[]>> {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("target, status, started_at")
    .gte("started_at", capturedAt)
    .order("started_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return fail("今回の取り込みの実行の取得", error.message);
  const parsed = z.array(cycleRunSchema).safeParse(data ?? []);
  if (!parsed.success) return fail("今回の取り込みの実行の形式の確認", parsed.error.message);
  return { ok: true, value: parsed.data };
}
