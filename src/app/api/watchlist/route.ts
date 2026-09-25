import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { toApiComparison } from "@/lib/screening/changes";
import { fetchScreeningChanges } from "@/lib/screening/change-queries";
import { parseScreeningParams, searchParamsToRecord, toApiConditions } from "@/lib/screening/params";
import { toApiWatchlistEntry } from "@/lib/watchlist/api";
import { fetchWatchlist } from "@/lib/watchlist/queries";

export const dynamic = "force-dynamic";

/**
 * 自分のウォッチリスト（Sprint 14。追加日時の新しい順）。クエリにスクリーニングの条件のパラメータがあればその条件、無ければ
 * 標準の条件で、各銘柄の判定と前回の取り込みからの変化を付ける（既定のプリセットは当てない。Sprint 13 の規則）。
 * 不正な条件は 400 invalid_params。読み出しの失敗は 500（空の配列を返さない）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(request.nextUrl.searchParams));
  if (invalidFields.length > 0) return jsonNoStore({ error: "invalid_params", fields: invalidFields }, { status: 400 });

  const [entries, changes] = await Promise.all([fetchWatchlist(auth.supabase, conditions), fetchScreeningChanges(auth.supabase, conditions)]);
  if (!entries.ok || !changes.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  return jsonNoStore({
    data: {
      conditions: toApiConditions(conditions),
      comparison: toApiComparison(changes.value),
      items: entries.value.map((entry) => toApiWatchlistEntry(entry, changes.value)),
    },
  });
}
