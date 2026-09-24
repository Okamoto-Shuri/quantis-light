import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicSupabaseEnv } from "./env";

/**
 * リクエストしたユーザーのセッションで動く Supabase クライアント（RLS が効く）。
 * サーバーコンポーネントからは Cookie を書けないため、setAll の失敗は無視する。
 * セッションの更新は proxy と Route Handler / Server Action で行う。
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicSupabaseEnv();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // サーバーコンポーネントからの呼び出し。proxy がセッションを更新する。
        }
      },
    },
  });
}
