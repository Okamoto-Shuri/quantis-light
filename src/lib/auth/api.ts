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
 * 未ログインは 401、許可リスト外は 403、認証サーバーに到達できない場合は 503（いずれもデータを含めない）。
 */
export async function requireApiUser(): Promise<ApiAuthResult> {
  const supabase = await createClient();
  const state = await resolveAuthState(supabase);
  switch (state.status) {
    case "allowed":
      return { ok: true, supabase };
    case "anonymous":
      return { ok: false, response: jsonNoStore({ error: "unauthorized" }, { status: 401 }) };
    case "forbidden":
      return { ok: false, response: jsonNoStore({ error: "forbidden" }, { status: 403 }) };
    case "unavailable":
      return { ok: false, response: jsonNoStore({ error: "auth_unavailable" }, { status: 503 }) };
  }
}
