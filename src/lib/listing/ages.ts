import { z } from "zod";

/**
 * 推定上場年数の表示。値はすべて DB のビュー public.stock_listing_ages が算出したものを使い、
 * アプリ側では計算しない（丸めの食い違いを作らないため）。
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** numeric は PostgREST から数値（または文字列）で返る。 */
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);

export const listingAgeSchema = z.object({
  code: z.string(),
  first_price_date: dateString.nullable(),
  data_start_date: dateString.nullable(),
  reference_date: dateString.nullable(),
  listed_before_data_start: z.boolean().nullable(),
  listing_years_exact: numeric.nullable(),
  estimated_listing_years: numeric.nullable(),
  listing_years_lower_bound: z.number().int().nullable(),
});

export type ListingAge = z.infer<typeof listingAgeSchema>;

export const LISTING_AGE_COLUMNS =
  "code, first_price_date, data_start_date, reference_date, listed_before_data_start, listing_years_exact, estimated_listing_years, listing_years_lower_bound";

export type ListingAgeDisplay =
  | { kind: "years"; text: string }
  | { kind: "before_data_start"; text: string }
  | { kind: "undetermined"; text: string }
  | { kind: "no_reference"; text: string };

/** 推定上場年数の表示（例: 「3.0年」「データ期間開始以前から上場（9年超）」）。 */
export function describeListingAge(age: Pick<
  ListingAge,
  "first_price_date" | "reference_date" | "listed_before_data_start" | "estimated_listing_years" | "listing_years_lower_bound"
>): ListingAgeDisplay {
  if (!age.first_price_date) return { kind: "undetermined", text: "未確定（株価の初出日をまだ取り込んでいません）" };
  if (!age.reference_date) return { kind: "no_reference", text: "基準日がないため算出できません" };
  if (age.listed_before_data_start) {
    return { kind: "before_data_start", text: `データ期間開始以前から上場（${age.listing_years_lower_bound ?? 0}年超）` };
  }
  // DB で小数点以下1桁に切り上げ済みの値を、桁をそろえて表示するだけ
  return { kind: "years", text: `${(age.estimated_listing_years ?? 0).toFixed(1)}年` };
}

/** 銘柄コードの入力を正規化する。4文字なら末尾に 0 を足す（8697 → 86970）。 */
export function normalizeStockCode(input: string): string | null {
  const value = input.trim().toUpperCase();
  if (!/^[0-9A-Z]{4,5}$/.test(value)) return null;
  return value.length === 4 ? `${value}0` : value;
}
