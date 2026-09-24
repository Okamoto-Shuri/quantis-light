import "server-only";

import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { buildLoginPath } from "./next-path";
import { getAuthState } from "./session";

/**
 * 保護画面の共通ガード。proxy に頼らず、サーバー側で毎リクエスト検証する。
 * - 未ログイン: /login?next=... へ
 * - 許可リストから外された: /auth/signout?reason=revoked（Cookie を削除できる Route Handler）へ
 */
export async function requireAllowedUser(): Promise<User> {
  const state = await getAuthState();
  if (state.status === "allowed") return state.user;
  if (state.status === "forbidden") redirect("/auth/signout?reason=revoked");

  const requested = (await headers()).get("x-quantis-pathname") ?? "/";
  redirect(buildLoginPath(requested));
}
