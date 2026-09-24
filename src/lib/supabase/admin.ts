import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv } from "./env";

/**
 * サービスロール（シークレットキー）で動くクライアント。RLS を無視するため、用途を限定する。
 * このモジュールは server-only で、クライアントのバンドルには含まれない。
 */
export function createAdminClient() {
  const { url } = getPublicSupabaseEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY が設定されていません（ローカルでは `pnpm env:local`）。");
  }
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
