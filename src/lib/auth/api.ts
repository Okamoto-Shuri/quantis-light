import "server-only";

import type { NextResponse } from "next/server";

import { jsonNoStore } from "@/lib/http/no-store";
import { createClient } from "@/lib/supabase/server";

import { resolveAuthState } from "./session";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ApiAuthResult =
  | { ok: true; supabase: SupabaseServerClient }
  | { ok: false; response: NextResponse };

/**
 * データ取得用エンドポイントの共通ガード。proxy に頼らず、ハンドラー自身でも必ず呼ぶ。
 * 未ログインは 401、ログイン中だが許可リスト外は 403。
 */
export async function requireApiUser(): Promise<ApiAuthResult> {
  const supabase = await createClient();
  const state = await resolveAuthState(supabase);
  if (state.status === "anonymous") {
    return { ok: false, response: jsonNoStore({ error: "unauthorized" }, { status: 401 }) };
  }
  if (state.status === "forbidden") {
    return { ok: false, response: jsonNoStore({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, supabase };
}
