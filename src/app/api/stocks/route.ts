import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { fetchFinancialMetrics } from "@/lib/financials/queries";
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
 * 財務指標は DB の financial_metrics の値: revenue_cagr・operating_margin は比率（小数点以下10桁）、
 * *_display_pct は百分率の小数点以下1桁に切り捨てた数値、*_unavailable_reason は算出不可の理由コード。
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
  const codes = stocks.map((stock) => stock.code);
  const [ages, reference, metrics] = await Promise.all([
    fetchListingAges(auth.supabase, codes),
    fetchReferenceDate(auth.supabase),
    fetchFinancialMetrics(auth.supabase, codes),
  ]);
  if (!ages.ok || !reference.ok || !metrics.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });

  return jsonNoStore({
    data: stocks.map((stock) => {
      const age = ages.value.get(stock.code);
      const metric = metrics.value.get(stock.code);
      return {
        ...stock,
        first_price_date: age?.first_price_date ?? null,
        data_start_date: age?.data_start_date ?? null,
        listed_before_data_start: age?.listed_before_data_start ?? null,
        listing_years_exact: age?.listing_years_exact ?? null,
        estimated_listing_years: age?.estimated_listing_years ?? null,
        listing_years_lower_bound: age?.listing_years_lower_bound ?? null,
        revenue_cagr: metric?.revenue_cagr ?? null,
        revenue_cagr_display_pct: metric?.revenue_cagr_display_pct ?? null,
        revenue_cagr_unavailable_reason: metric?.revenue_cagr_unavailable_reason ?? null,
        revenue_cagr_mixed_basis: metric?.revenue_cagr_mixed_basis ?? null,
        operating_margin: metric?.operating_margin ?? null,
        operating_margin_display_pct: metric?.operating_margin_display_pct ?? null,
        operating_margin_unavailable_reason: metric?.operating_margin_unavailable_reason ?? null,
        latest_fiscal_year_end: metric?.latest_fiscal_year_end ?? null,
      };
    }),
    meta: { referenceDate: reference.value },
  });
}
