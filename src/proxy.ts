import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { buildLoginPath } from "@/lib/auth/next-path";
import { NO_STORE_HEADERS } from "@/lib/http/no-store";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";

/** ログインしていなくても開けるパス。 */
const PUBLIC_PATHS = new Set(["/login", "/auth/signout"]);

/**
 * 1. Supabase のセッションを更新し、Cookie をレスポンスに書き戻す。
 * 2. 未ログインなら、画面は /login へリダイレクト、/api は 401 を返す（楽観的チェック）。
 * 許可リストを含む最終的な判定は、保護画面のレイアウトと各 Route Handler が行う。
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // 保護画面のガードが、未ログイン時の next を組み立てるために使う（値は sanitizeNextPath で検証される）。
  request.headers.set("x-quantis-pathname", `${pathname}${search}`);

  let response = NextResponse.next({ request });
  const { url, publishableKey } = getPublicSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  let isAuthenticated = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    isAuthenticated = !error && Boolean(data?.claims?.sub);
  } catch {
    isAuthenticated = false; // 検証できなければ未ログイン扱い
  }

  if (PUBLIC_PATHS.has(pathname)) return response;

  if (!isAuthenticated) {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
    }
    const redirect = NextResponse.redirect(new URL(buildLoginPath(pathname, search), request.url));
    redirect.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
    return redirect;
  }

  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export const config = {
  // 静的アセットは拡張子ではなく明示的なパスで除外する（/stocks/72030.png なども保護対象にするため）。
  matcher: ["/((?!_next/static/|_next/image|favicon\\.ico$).*)"],
};
