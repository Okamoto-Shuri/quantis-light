import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { buildLoginPath, sanitizeNextPath } from "@/lib/auth/next-path";
import { resolveAuthState } from "@/lib/auth/session";
import { NO_STORE_HEADERS } from "@/lib/http/no-store";
import { isSupabaseAuthCookie } from "@/lib/supabase/cookies";
import { createClient } from "@/lib/supabase/server";

/**
 * セッションを破棄する。サーバーコンポーネントは Cookie を書けないため、破棄はここで行う。
 *
 * 破棄の応答には `Clear-Site-Data: "cache"` を付け、ブラウザの HTTP キャッシュと bfcache に残った
 * 保護画面を消す。これにより、ログアウト後に「戻る」を押しても、保護画面は必ずサーバーに
 * 取り直され、未ログインとしてログイン画面にリダイレクトされる（Next.js の開発サーバーは画面を
 * `no-cache` で返すため、Cache-Control だけでは戻る操作でのキャッシュ表示を防げない）。
 */
const SIGNED_OUT_HEADERS = { ...NO_STORE_HEADERS, "Clear-Site-Data": '"cache"' } as const;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function destroySession(request: NextRequest, supabase: SupabaseServerClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error("[signout] Auth サーバーでのセッション破棄に失敗しました（Cookie は削除します）", error);
  }
  // signOut が失敗した場合や、分割 Cookie が残った場合に備えて明示的に削除する。
  const store = await cookies();
  for (const { name } of request.cookies.getAll()) {
    if (isSupabaseAuthCookie(name)) store.delete(name);
  }
}

/** ヘッダーの「ログアウト」から fetch で呼ぶ。同一オリジンからの要求だけを受け付ける（CSRF 対策）。 */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }
  await destroySession(request, await createClient());
  return new NextResponse(null, { status: 204, headers: SIGNED_OUT_HEADERS });
}

/**
 * 保護画面のガードからのリダイレクト専用。
 * 外部サイトからのリンクや画像でログアウトさせられないよう、セッションが有効で許可されている
 * ユーザーのセッションは破棄しない（許可取り消し・無効なセッションの後片付けだけを行う）。
 * クエリの reason は参考情報で、破棄するかどうかはサーバー側の判定だけで決める。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const state = await resolveAuthState(supabase);
  const next = sanitizeNextPath(request.nextUrl.searchParams.get("next"));
  const redirectTo = (path: string, headers: Record<string, string>) =>
    NextResponse.redirect(new URL(path, request.nextUrl.origin), { status: 303, headers });

  switch (state.status) {
    case "allowed":
      return redirectTo(next, NO_STORE_HEADERS);
    case "unavailable":
      // 一時的な障害でセッションを消さない
      return redirectTo(buildLoginPath(next), NO_STORE_HEADERS);
    case "forbidden":
      await destroySession(request, supabase);
      return redirectTo("/login?reason=revoked", SIGNED_OUT_HEADERS);
    case "anonymous": {
      // クライアント遷移中にガードが /auth/signout?reason=revoked へ送ると、ルーターがこの URL を
      // 同時に2回要求することがある。先に処理された要求がセッションを破棄するため、後の要求は
      // 「未ログイン」と判定される。その場合も取り消しの理由を伝える（Sprint 2 評価の N1）。
      // 条件は、破棄するセッションの Cookie を持っていたこと。Cookie の無い要求（外部のリンクなど）には
      // 理由を付けない。理由はログイン画面の表示にしか使わない（アクセスの判定には使わない）。
      const hadSession = request.cookies.getAll().some(({ name }) => isSupabaseAuthCookie(name));
      await destroySession(request, supabase);
      if (hadSession && request.nextUrl.searchParams.get("reason") === "revoked") {
        return redirectTo("/login?reason=revoked", SIGNED_OUT_HEADERS);
      }
      return redirectTo(buildLoginPath(next), SIGNED_OUT_HEADERS);
    }
  }
}
