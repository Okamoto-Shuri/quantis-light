import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { NO_STORE_HEADERS } from "@/lib/http/no-store";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseAuthCookie } from "@/lib/supabase/cookies";

/**
 * セッションを破棄する。サーバーコンポーネントは Cookie を書けないため、破棄はここで行う。
 * - POST: ヘッダーの「ログアウト」から呼ぶ（204 を返し、画面側がフルリロードで /login へ遷移）。
 * - GET : ログイン中に許可リストから外されたユーザーを /login?reason=revoked へ送るためのリダイレクト専用。
 */
async function destroySession(request: NextRequest): Promise<void> {
  const supabase = await createClient();
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

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }
  await destroySession(request);
  return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  await destroySession(request);
  const reason = request.nextUrl.searchParams.get("reason") === "revoked" ? "?reason=revoked" : "";
  return NextResponse.redirect(new URL(`/login${reason}`, request.nextUrl.origin), {
    status: 303,
    headers: NO_STORE_HEADERS,
  });
}
