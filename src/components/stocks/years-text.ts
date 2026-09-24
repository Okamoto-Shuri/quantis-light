import type { StockDetail } from "@/lib/stocks/detail";

export type ValueDisplay = { text: string; unavailable: boolean };

/** 推定上場年数の短い表示（判定の行・指標のカード）。値は DB の listing_years_between の結果をそのまま使う。 */
export function yearsSummary(listing: StockDetail["listing"], referenceDate: string | null): ValueDisplay {
  if (!listing) return { text: "未確定", unavailable: true };
  if (!referenceDate) return { text: "基準日なし", unavailable: true };
  if (listing.listed_before_data_start) return { text: `${listing.listing_years_lower_bound ?? 0}年超`, unavailable: false };
  return { text: `${(listing.estimated_listing_years ?? 0).toFixed(1)}年`, unavailable: false };
}
