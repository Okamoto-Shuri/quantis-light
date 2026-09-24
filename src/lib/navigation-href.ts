import { searchParamsToRecord } from "@/lib/screening/params";
import { detailConditionsFromParams } from "@/lib/stocks/detail";

/**
 * ナビゲーションの項目のリンク先。銘柄詳細（/stocks/<code>。「銘柄が見つかりません」を含む）を開いている間だけ、
 * 「スクリーニング」にパンくずと同じ正規形のクエリを付ける（Sprint 7 の契約の第2章の8・R3）。ほかの画面では項目の href のまま。
 */
export function navItemHref(href: string, pathname: string, search: string): string {
  if (href !== "/screening" || !/^\/stocks\/[^/]+$/.test(pathname)) return href;
  return detailConditionsFromParams(searchParamsToRecord(new URLSearchParams(search))).screeningHref;
}
