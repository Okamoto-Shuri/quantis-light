/**
 * 同一オリジンの確認（CSRF 対策）。Next.js の Server Actions と同じく、`Origin` ヘッダーのホスト（ポートを含む）を、
 * 要求のホスト（`X-Forwarded-Host` の最初の値、無ければ `Host`）と比べる。
 *
 * `request.nextUrl.origin` はサーバーの既定のホスト名（localhost など）から作られるため、`127.0.0.1` や
 * 別名のドメインで開いた正規の要求まで拒否してしまう（Sprint 3 評価の M1）。
 * 別のサイトのページは `Host` を書き換えられず、`X-Forwarded-Host` を付けると CORS のプリフライトになるので、
 * この比べ方でも別のサイトからの要求は拒否される。
 */
export function isSameOriginRequest(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return false;

  let originHost: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    originHost = url.host;
  } catch {
    return false;
  }

  const requestHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")?.trim();
  if (!requestHost) return false;
  return originHost.toLowerCase() === requestHost.toLowerCase();
}
