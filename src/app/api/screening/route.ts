import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { withApiOverride } from "@/lib/ownership/override";
import { parseScreeningParams, searchParamsToRecord, toApiConditions } from "@/lib/screening/params";
import { runScreening } from "@/lib/screening/queries";

export const dynamic = "force-dynamic";

/**
 * スクリーニング（条件①〜④。条件④は呼び出したユーザーの手動補正を含む）。クエリは画面の URL と同じ（契約の第2章の6）。保存済みデータだけを検索し、外部 API は呼ばない。
 * 画面と違い、不正なクエリは既定値に置き換えずに 400 `{"error":"invalid_params","fields":[...]}` にする。
 * ページ番号が最終ページを超えるときは rows を空にして 200（page は要求の値）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(request.nextUrl.searchParams));
  if (invalidFields.length > 0) return jsonNoStore({ error: "invalid_params", fields: invalidFields }, { status: 400 });

  const result = await runScreening(auth.supabase, conditions, { clampPage: false });
  if (!result.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });

  const rows = result.value.rows.map((row) => ({ ...row, ownership: withApiOverride(row.ownership) }));
  return jsonNoStore({ data: { ...result.value, rows, conditions: toApiConditions(conditions) } });
}
