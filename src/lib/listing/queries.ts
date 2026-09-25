import "server-only";

import { z } from "zod";

import type { createClient } from "@/lib/supabase/server";

import { LISTING_AGE_COLUMNS, listingAgeSchema, type ListingAge } from "./ages";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 読み出しの結果。失敗は 0 件として扱わない。 */
export type Result<T> = { ok: true; value: T } | { ok: false };

const stockBasicsSchema = z.object({
  code: z.string(),
  company_name: z.string(),
  market_name: z.string().nullable(),
});
export type StockBasics = z.infer<typeof stockBasicsSchema>;

export type ListingSummary = {
  referenceDate: string | null;
  dataStartDate: string | null;
  stockCount: number;
  determinedCount: number;
  beforeDataStartCount: number;
};

function fail(label: string, message: string): { ok: false } {
  console.error(`[listing] ${label}に失敗しました`, message);
  return { ok: false };
}

/** 基準日（最新の株価の取り込み日。日本時間の日付）。ビュー public.listing_reference_date（常に1行）から読む。 */
export async function fetchReferenceDate(supabase: SupabaseServerClient): Promise<Result<string | null>> {
  const { data, error } = await supabase.from("listing_reference_date").select("reference_date").limit(1);
  if (error) return fail("基準日の取得", error.message);
  const parsed = z.array(z.object({ reference_date: z.string().nullable() })).safeParse(data);
  if (!parsed.success) return fail("基準日の形式の確認", parsed.error.message);
  return { ok: true, value: parsed.data[0]?.reference_date ?? null };
}

/** 取り込み状況の画面の「株価の初出日と推定上場年数」の要約。 */
export async function fetchListingSummary(supabase: SupabaseServerClient): Promise<Result<ListingSummary>> {
  const [stocks, determined, beforeStart, latestStart, reference] = await Promise.all([
    // Sprint 14: 上場中の銘柄だけを数える（上場廃止の銘柄は初出日の取り込みの対象外）
    supabase.from("stocks").select("code", { count: "exact", head: true }).is("delisted_on", null),
    supabase.from("stock_listing_dates").select("code, stocks!inner(code)", { count: "exact", head: true }).is("stocks.delisted_on", null),
    supabase.from("stock_listing_ages").select("code", { count: "exact", head: true }).eq("listed_before_data_start", true).is("delisted_on", null),
    supabase.from("stock_listing_dates").select("data_start_date").order("data_start_date", { ascending: false }).limit(1),
    fetchReferenceDate(supabase),
  ]);
  for (const [label, result] of [
    ["銘柄数の取得", stocks],
    ["確定した銘柄数の取得", determined],
    ["データ期間開始以前の銘柄数の取得", beforeStart],
    ["データ期間の開始日の取得", latestStart],
  ] as const) {
    if (result.error) return fail(label, result.error.message);
  }
  if (!reference.ok) return reference;
  const start = z.array(z.object({ data_start_date: z.string() })).safeParse(latestStart.data);
  if (!start.success) return fail("データ期間の開始日の形式の確認", start.error.message);

  return {
    ok: true,
    value: {
      referenceDate: reference.value,
      dataStartDate: start.data[0]?.data_start_date ?? null,
      stockCount: stocks.count ?? 0,
      determinedCount: determined.count ?? 0,
      beforeDataStartCount: beforeStart.count ?? 0,
    },
  };
}

export type ListingEntry = { stock: StockBasics; age: ListingAge };

async function fetchStocks(supabase: SupabaseServerClient, codes: string[]): Promise<Result<Map<string, StockBasics>>> {
  if (codes.length === 0) return { ok: true, value: new Map() };
  const { data, error } = await supabase.from("stocks").select("code, company_name, market_name").in("code", codes);
  if (error) return fail("銘柄の取得", error.message);
  const parsed = z.array(stockBasicsSchema).safeParse(data);
  if (!parsed.success) return fail("銘柄の形式の確認", parsed.error.message);
  return { ok: true, value: new Map(parsed.data.map((stock) => [stock.code, stock])) };
}

/** 1銘柄の推定上場年数。銘柄マスタに無ければ null。 */
export async function fetchListingEntry(supabase: SupabaseServerClient, code: string): Promise<Result<ListingEntry | null>> {
  const { data, error } = await supabase.from("stock_listing_ages").select(LISTING_AGE_COLUMNS).eq("code", code).limit(1);
  if (error) return fail("推定上場年数の取得", error.message);
  const parsed = z.array(listingAgeSchema).safeParse(data);
  if (!parsed.success) return fail("推定上場年数の形式の確認", parsed.error.message);
  const age = parsed.data[0];
  if (!age) return { ok: true, value: null };
  const stocks = await fetchStocks(supabase, [code]);
  if (!stocks.ok) return stocks;
  const stock = stocks.value.get(code);
  return { ok: true, value: stock ? { stock, age } : null };
}

/** 初出日の新しい銘柄（データ期間開始以前の銘柄を除く）。 */
export async function fetchRecentListings(supabase: SupabaseServerClient, limit = 10): Promise<Result<ListingEntry[]>> {
  const { data, error } = await supabase
    .from("stock_listing_ages")
    .select(LISTING_AGE_COLUMNS)
    .eq("listed_before_data_start", false)
    .order("first_price_date", { ascending: false })
    .order("code", { ascending: true })
    .limit(limit);
  if (error) return fail("初出日の新しい銘柄の取得", error.message);
  const parsed = z.array(listingAgeSchema).safeParse(data);
  if (!parsed.success) return fail("初出日の新しい銘柄の形式の確認", parsed.error.message);
  const stocks = await fetchStocks(
    supabase,
    parsed.data.map((age) => age.code),
  );
  if (!stocks.ok) return stocks;
  return {
    ok: true,
    value: parsed.data.flatMap((age) => {
      const stock = stocks.value.get(age.code);
      return stock ? [{ stock, age }] : [];
    }),
  };
}

/** 複数の銘柄の推定上場年数（GET /api/stocks 用）。 */
export async function fetchListingAges(supabase: SupabaseServerClient, codes: string[]): Promise<Result<Map<string, ListingAge>>> {
  if (codes.length === 0) return { ok: true, value: new Map() };
  const { data, error } = await supabase.from("stock_listing_ages").select(LISTING_AGE_COLUMNS).in("code", codes);
  if (error) return fail("推定上場年数の取得", error.message);
  const parsed = z.array(listingAgeSchema).safeParse(data);
  if (!parsed.success) return fail("推定上場年数の形式の確認", parsed.error.message);
  return { ok: true, value: new Map(parsed.data.map((age) => [age.code, age])) };
}

