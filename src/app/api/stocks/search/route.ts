import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { parseStockSearchQuery, searchStocks } from "@/lib/stocks/search";

export const dynamic = "force-dynamic";

/**
 * 銘柄の検索（ヘッダーのコマンドパレット）。`?q=` はコード（前方一致）・社名・英文社名（部分一致）。
 * 空なら 0 件、50 文字を超えたら 400 `invalid_query`。上場中の銘柄が先、最大 20 件。ユーザーのセッションで読む（RLS）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const query = parseStockSearchQuery(request.nextUrl.searchParams.get("q"));
  if (query === null) return jsonNoStore({ error: "invalid_query" }, { status: 400 });

  const result = await searchStocks(auth.supabase, query);
  if (!result.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  return jsonNoStore({ data: result.value });
}
