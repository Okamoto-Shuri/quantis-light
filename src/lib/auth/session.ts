import "server-only";

import type { User } from "@supabase/supabase-js";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { isNetworkError } from "./login-errors";

export type AuthState =
  | { status: "anonymous" }
  /** Auth / DB に到達できず、検証できない（アクセスは拒否するが、セッションは消さない） */
  | { status: "unavailable" }
  | { status: "forbidden"; user: User }
  | { status: "allowed"; user: User };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * セッションと許可リストを、サーバー側で毎回検証する。
 * - getUser は Auth サーバーに問い合わせるため、Cookie の値を鵜呑みにしない。
 * - 検証できない場合はアクセスを拒否する（fail closed）。
 */
export async function resolveAuthState(supabase: SupabaseServerClient): Promise<AuthState> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return isNetworkError(error) ? { status: "unavailable" } : { status: "anonymous" };
    if (!data.user) return { status: "anonymous" };

    const { data: allowed, error: rpcError } = await supabase.rpc("current_user_is_allowed");
    if (rpcError) {
      console.error("[auth] 許可リストの確認に失敗しました", rpcError.message);
      return { status: "unavailable" };
    }
    return allowed === true ? { status: "allowed", user: data.user } : { status: "forbidden", user: data.user };
  } catch (error) {
    console.error("[auth] セッションの検証に失敗しました", error);
    return { status: "unavailable" };
  }
}

/** 1リクエスト内で結果を共有する（レイアウトとページで二重に問い合わせない）。 */
export const getAuthState = cache(async (): Promise<AuthState> => resolveAuthState(await createClient()));
