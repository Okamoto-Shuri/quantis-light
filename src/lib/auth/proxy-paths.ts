/**
 * ログインのセッションではなく、ハンドラー自身が認証するパス（定期実行。CRON_SECRET で認証する）。
 * proxy の未ログイン判定から外す。配下（末尾のスラッシュ付きの前方一致）だけを外し、
 * /api/cron・/api/cronx・/API/cron/... などは外さない（それらは通常どおり未ログインなら 401）。
 */
export function isSelfAuthenticatedPath(pathname: string): boolean {
  return pathname.startsWith("/api/cron/");
}
