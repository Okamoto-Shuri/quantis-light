import "server-only";

import { z } from "zod";

import type { Result } from "@/lib/listing/queries";
import { toScreenStocksParams, type ScreeningConditions } from "@/lib/screening/params";
import type { createClient } from "@/lib/supabase/server";

import { watchlistEntrySchema, type WatchlistEntry } from "./entries";

/**
 * ウォッチリストの読み出し（Sprint 14）。ユーザーのセッション（RLS で本人の行だけ）で読む。サービスロールは使わない。
 * 失敗は ok: false（呼び出し側が「読み込めませんでした」の表示・500 にする。空として扱わない）。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function fail(label: string, message: string): { ok: false } {
  console.error(`[watchlist] ${label}に失敗しました`, message);
  return { ok: false };
}

/** 自分のウォッチリスト（追加日時の新しい順）と、各銘柄の表示の値・判定（conditions の条件） */
export async function fetchWatchlist(supabase: SupabaseServerClient, conditions: ScreeningConditions): Promise<Result<WatchlistEntry[]>> {
  const { data, error } = await supabase.rpc("watchlist_entries", { p_params: toScreenStocksParams(conditions, { clampPage: false }) });
  if (error) return fail("ウォッチリストの取得", error.message);
  const parsed = z.array(watchlistEntrySchema).safeParse(data ?? []);
  if (!parsed.success) return fail("ウォッチリストの形式の確認", parsed.error.message);
  return { ok: true, value: parsed.data };
}

const itemSchema = z.object({ code: z.string(), memo: z.string().nullable(), created_at: z.string(), updated_at: z.string() });
export type WatchlistItem = z.infer<typeof itemSchema>;

/** 指定の銘柄のうち、登録済みのもの（コード → 行）。codes が null なら全部 */
export async function fetchWatchlistItems(supabase: SupabaseServerClient, codes: string[] | null): Promise<Result<Map<string, WatchlistItem>>> {
  if (codes !== null && codes.length === 0) return { ok: true, value: new Map() };
  let query = supabase.from("watchlist_items").select("code, memo, created_at, updated_at");
  if (codes !== null) query = query.in("code", codes);
  const { data, error } = await query;
  if (error) return fail("ウォッチリストの登録の確認", error.message);
  const parsed = z.array(itemSchema).safeParse(data ?? []);
  if (!parsed.success) return fail("ウォッチリストの登録の形式の確認", parsed.error.message);
  return { ok: true, value: new Map(parsed.data.map((item) => [item.code, item])) };
}
