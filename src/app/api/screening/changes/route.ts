import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { toApiComparison } from "@/lib/screening/changes";
import { fetchScreeningChanges } from "@/lib/screening/change-queries";
import { parseScreeningParams, searchParamsToRecord, toApiConditions } from "@/lib/screening/params";
import { fetchWatchlistItems } from "@/lib/watchlist/queries";

export const dynamic = "force-dynamic";

/**
 * 新たに該当・外れた銘柄（Sprint 14。F13）。最新の比較の基準の記録（前回の取り込み時点）と今のデータを、同じ条件で比べる。
 * クエリにスクリーニングの条件のパラメータがあればその条件、無ければ標準の条件（既定のプリセットは当てない）。
 * 一覧は全件（上限なし）、コード順。読み出しの失敗は 500（部分的な結果を返さない）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(request.nextUrl.searchParams));
  if (invalidFields.length > 0) return jsonNoStore({ error: "invalid_params", fields: invalidFields }, { status: 400 });

  const changes = await fetchScreeningChanges(auth.supabase, conditions);
  if (!changes.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  const codes = [...changes.value.added, ...changes.value.removed].map((change) => change.code);
  const watchlist = await fetchWatchlistItems(auth.supabase, codes);
  if (!watchlist.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });

  const withMark = (list: typeof changes.value.added) => list.map((change) => ({ ...change, watchlisted: watchlist.value.has(change.code) }));
  return jsonNoStore({
    data: {
      conditions: toApiConditions(conditions),
      comparison: toApiComparison(changes.value),
      added: withMark(changes.value.added),
      removed: withMark(changes.value.removed),
    },
  });
}
