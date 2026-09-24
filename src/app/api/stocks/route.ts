import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { normalizeStockCode } from "@/lib/listing/ages";
import { fetchListingAges, fetchReferenceDate } from "@/lib/listing/queries";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 100;

const STOCK_COLUMNS =
  "code, company_name, company_name_en, market_code, market_name, sector17_code, sector17_name, sector33_code, sector33_name, scale_category, product_category, listed_info_date, updated_at";

/**
 * 銘柄マスタの一覧と、株価の初出日・推定上場年数。ユーザー自身のセッションで読む（RLS が効く経路）。
 * `?code=` で1銘柄に絞れる（4文字なら末尾に 0 を足す）。年数は DB のビュー（stock_listing_ages）の値をそのまま返す:
 * estimated_listing_years は小数点以下1桁に切り上げた数値、listing_years_exact は丸める前の値。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const codeParam = request.nextUrl.searchParams.get("code");
  const code = codeParam === null ? null : normalizeStockCode(codeParam);
  if (codeParam !== null && code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  let query = auth.supabase.from("stocks").select(STOCK_COLUMNS);
  if (code) query = query.eq("code", code);
  const { data, error } = await query.order("code", { ascending: true }).limit(PAGE_LIMIT);
  if (error) {
    console.error("[api/stocks] 銘柄の取得に失敗しました", error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }

  const stocks = (data ?? []) as unknown as ({ code: string } & Record<string, unknown>)[];
  const [ages, reference] = await Promise.all([
    fetchListingAges(
      auth.supabase,
      stocks.map((stock) => stock.code),
    ),
    fetchReferenceDate(auth.supabase),
  ]);
  if (!ages.ok || !reference.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });

  return jsonNoStore({
    data: stocks.map((stock) => {
      const age = ages.value.get(stock.code);
      return {
        ...stock,
        first_price_date: age?.first_price_date ?? null,
        data_start_date: age?.data_start_date ?? null,
        listed_before_data_start: age?.listed_before_data_start ?? null,
        listing_years_exact: age?.listing_years_exact ?? null,
        estimated_listing_years: age?.estimated_listing_years ?? null,
        listing_years_lower_bound: age?.listing_years_lower_bound ?? null,
      };
    }),
    meta: { referenceDate: reference.value },
  });
}
