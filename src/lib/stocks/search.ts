/**
 * 銘柄の検索（ヘッダーのコマンドパレット。GET /api/stocks/search）。比較の鍵と並びは DB 関数 search_stocks の1か所
 * （コードの前方一致・社名と英文社名の部分一致。ひらがな・全角を区別しない）。ここは入力の検査と値の形だけ。
 */
import "server-only";

import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 1回に返す最大の件数（DB 関数は 50 まで受け付ける） */
export const STOCK_SEARCH_LIMIT = 20;
/** 入力の最大の長さ（コードポイント）。これより長い入力は 400 */
export const STOCK_SEARCH_MAX_LENGTH = 50;

export type StockSearchHit = {
  code: string;
  companyName: string;
  marketName: string | null;
  sectorName: string | null;
  delisted: boolean;
};

/** 入力を検査する。前後の空白を除いた値（空なら検索しない）、長すぎるなら null。 */
export function parseStockSearchQuery(raw: string | null): string | null {
  const query = (raw ?? "").trim();
  return [...query].length > STOCK_SEARCH_MAX_LENGTH ? null : query;
}

type Row = { code: string; company_name: string; market_name: string | null; sector33_name: string | null; delisted: boolean };

export async function searchStocks(
  supabase: SupabaseServerClient,
  query: string,
): Promise<{ ok: true; value: StockSearchHit[] } | { ok: false }> {
  if (query === "") return { ok: true, value: [] };
  const { data, error } = await supabase.rpc("search_stocks", { p_query: query, p_limit: STOCK_SEARCH_LIMIT });
  if (error) {
    console.error("[stocks/search] 銘柄の検索に失敗しました", error.message);
    return { ok: false };
  }
  return {
    ok: true,
    value: ((data ?? []) as Row[]).map((row) => ({
      code: row.code,
      companyName: row.company_name,
      marketName: row.market_name,
      sectorName: row.sector33_name,
      delisted: row.delisted,
    })),
  };
}
