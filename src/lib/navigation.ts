/**
 * ナビゲーションの項目（表示順）。実装済みの画面だけを載せる（仕様 AC2.1: 未実装の画面は出さない）。
 * 仕様上の順序: ダッシュボード、スクリーニング、ウォッチリスト、取り込み状況、設定。
 * 画面を追加したら、この配列の該当位置に1行足す。
 */
export const NAV_ITEMS = [
  { href: "/", label: "ダッシュボード" },
  { href: "/screening", label: "スクリーニング" },
  { href: "/watchlist", label: "ウォッチリスト" },
  { href: "/imports", label: "取り込み状況" },
  { href: "/settings", label: "設定" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];

/** 現在のパスがその項目の画面（または配下の画面）かどうか。 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
