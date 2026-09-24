import "server-only";

import type { User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { isSupabaseAuthCookie } from "@/lib/supabase/cookies";

import { buildLoginPath, sanitizeNextPath } from "./next-path";
import { getAuthState } from "./session";

/**
 * 保護画面の共通ガード。proxy に頼らず、サーバー側で毎リクエスト検証する。
 * サーバーコンポーネントは Cookie を書けないため、セッションの破棄が必要な場合は
 * Route Handler（/auth/signout）へリダイレクトする。
 */
export async function requireAllowedUser(): Promise<User> {
  const state = await getAuthState();
  if (state.status === "allowed") return state.user;

  // 許可リストから外された: セッションを破棄して /login?reason=revoked へ
  if (state.status === "forbidden") redirect("/auth/signout?reason=revoked");

  const requested = sanitizeNextPath((await headers()).get("x-quantis-pathname") ?? "/");

  // Auth / DB に到達できない: セッションは残したままログイン画面へ（ログイン画面が障害の案内を出す）
  if (state.status === "unavailable") redirect(buildLoginPath(requested));

  // 無効になったセッションの Cookie が残っている: 破棄してからログイン画面へ
  const hasStaleSession = (await cookies()).getAll().some(({ name }) => isSupabaseAuthCookie(name));
  if (hasStaleSession) {
    redirect(requested === "/" ? "/auth/signout" : `/auth/signout?next=${encodeURIComponent(requested)}`);
  }
  redirect(buildLoginPath(requested));
}
