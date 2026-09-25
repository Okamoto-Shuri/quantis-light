import "server-only";

import type { Result } from "@/lib/listing/queries";
import type { createClient } from "@/lib/supabase/server";

import { presetRowSchema, toPreset, type Preset } from "./presets";

/**
 * 条件プリセットの読み出し（Sprint 13）。ユーザーのセッション（RLS で本人の行だけ）で読む。サービスロールは使わない。
 * 失敗は ok: false（呼び出し側が「読み込めませんでした」の表示・500 にする。0件として扱わない）。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const COLUMNS = "id, name, query, is_default, created_at, updated_at";

/** 自分のプリセット（作成の古い順） */
export async function fetchPresets(supabase: SupabaseServerClient): Promise<Result<Preset[]>> {
  const { data, error } = await supabase.from("screening_presets").select(COLUMNS).order("created_at").order("id");
  if (error) {
    console.error("[presets] プリセットの取得に失敗しました", error.message);
    return { ok: false };
  }
  const parsed = presetRowSchema.array().safeParse(data ?? []);
  if (!parsed.success) {
    console.error("[presets] プリセットの形式が想定と異なります", parsed.error.message);
    return { ok: false };
  }
  return { ok: true, value: parsed.data.map(toPreset) };
}

/** 既定のプリセット（無ければ null）。銘柄詳細（条件のパラメータなし）で使う */
export async function fetchDefaultPreset(supabase: SupabaseServerClient): Promise<Result<Preset | null>> {
  const { data, error } = await supabase.from("screening_presets").select(COLUMNS).eq("is_default", true).limit(1);
  if (error) {
    console.error("[presets] 既定のプリセットの取得に失敗しました", error.message);
    return { ok: false };
  }
  const parsed = presetRowSchema.array().safeParse(data ?? []);
  if (!parsed.success) {
    console.error("[presets] プリセットの形式が想定と異なります", parsed.error.message);
    return { ok: false };
  }
  return { ok: true, value: parsed.data[0] ? toPreset(parsed.data[0]) : null };
}
