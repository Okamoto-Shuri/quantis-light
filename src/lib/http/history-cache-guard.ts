/**
 * 「戻る／進む」でキャッシュ済みの画面が表示されるのを防ぐスクリプト（ハイドレーション前に実行）。
 *
 * - 本番の動的ページは Next.js が `no-store` を付けるが、開発サーバー（next dev）は戻る／進むでの
 *   HTTP キャッシュ復元を許す `no-cache` を付ける。さらにブラウザの bfcache もある。
 * - どちらの経路でも、ログアウト後に保護画面の内容が見えないよう、キャッシュから表示された場合は
 *   画面を隠してサーバーに問い合わせ直す（未ログインならログイン画面にリダイレクトされる）。
 */
export const HISTORY_CACHE_GUARD_SCRIPT = `(() => {
  const hide = () => { document.documentElement.style.visibility = "hidden"; };
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav && nav.type === "back_forward" && nav.transferSize === 0) {
      hide();
      location.reload();
      return;
    }
  } catch {}
  addEventListener("pagehide", (e) => { if (e.persisted) hide(); });
  addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });
})();`;
