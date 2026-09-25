import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { withApiOverride } from "@/lib/ownership/override";
import { toApiComparison } from "@/lib/screening/changes";
import { fetchScreeningChanges } from "@/lib/screening/change-queries";
import { parseScreeningParams, searchParamsToRecord, toApiConditions } from "@/lib/screening/params";
import { runScreening } from "@/lib/screening/queries";
import { fetchWatchlistItems } from "@/lib/watchlist/queries";

export const dynamic = "force-dynamic";

/**
 * スクリーニング（条件①〜④。条件④は呼び出したユーザーの手動補正を含む）。クエリは画面の URL と同じ（契約の第2章の6）。保存済みデータだけを検索し、外部 API は呼ばない。
 * 画面と違い、不正なクエリは既定値に置き換えずに 400 `{"error":"invalid_params","fields":[...]}` にする。
 * ページ番号が最終ページを超えるときは rows を空にして 200（page は要求の値）。
 * Sprint 14: 各行に watchlisted（ウォッチリストに登録済み）と isNew（前回の取り込みから新たに該当）、全体に comparison と newCount
 * （比較できないときは null）を足した。どれかの読み出しに失敗したら 500（部分的な結果を返さない）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(request.nextUrl.searchParams));
  if (invalidFields.length > 0) return jsonNoStore({ error: "invalid_params", fields: invalidFields }, { status: 400 });

  const [result, changes] = await Promise.all([
    runScreening(auth.supabase, conditions, { clampPage: false }),
    fetchScreeningChanges(auth.supabase, conditions),
  ]);
  if (!result.ok || !changes.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  const watchlist = await fetchWatchlistItems(auth.supabase, result.value.rows.map((row) => row.code));
  if (!watchlist.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });

  const comparable = changes.value.status === "ok";
  const added = new Set(changes.value.added.map((change) => change.code));
  const rows = result.value.rows.map((row) => ({
    ...row,
    ownership: withApiOverride(row.ownership),
    watchlisted: watchlist.value.has(row.code),
    isNew: comparable && added.has(row.code),
  }));
  return jsonNoStore({
    data: {
      ...result.value,
      rows,
      conditions: toApiConditions(conditions),
      comparison: toApiComparison(changes.value),
      newCount: comparable ? changes.value.added.length : null,
    },
  });
}
