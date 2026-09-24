import "server-only";

import type { Result } from "@/lib/listing/queries";
import type { createClient } from "@/lib/supabase/server";

import { toScreenStocksParams, type ScreeningConditions } from "./params";
import { filterOptionsSchema, screeningResultSchema, type FilterOptions, type ScreeningResult } from "./result";

/**
 * スクリーニングの読み出し。ユーザーのセッション（RLS が効く経路）で DB 関数を呼ぶ。外部 API は呼ばない。
 * 失敗は 0 件として扱わない（呼び出し側がエラー表示にする）。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function fail(label: string, message: string): { ok: false } {
  console.error(`[screening] ${label}に失敗しました`, message);
  return { ok: false };
}

export async function runScreening(
  supabase: SupabaseServerClient,
  conditions: ScreeningConditions,
  options: { clampPage: boolean },
): Promise<Result<ScreeningResult>> {
  const { data, error } = await supabase.rpc("screen_stocks", { p_params: toScreenStocksParams(conditions, options) });
  if (error) return fail("スクリーニング", error.message);
  const parsed = screeningResultSchema.safeParse(data);
  if (!parsed.success) return fail("スクリーニングの結果の形式の確認", parsed.error.message);
  return { ok: true, value: parsed.data };
}

export async function fetchFilterOptions(supabase: SupabaseServerClient): Promise<Result<FilterOptions>> {
  const { data, error } = await supabase.rpc("screening_filter_options");
  if (error) return fail("絞り込みの選択肢の取得", error.message);
  const parsed = filterOptionsSchema.safeParse(data);
  if (!parsed.success) return fail("絞り込みの選択肢の形式の確認", parsed.error.message);
  return { ok: true, value: parsed.data };
}
