import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { normalizeStockCode } from "@/lib/listing/ages";
import { apiOverrideResponse } from "@/lib/ownership/override";

export const dynamic = "force-dynamic";

/**
 * 「確認済みにする」（Sprint 11。AC10.5）。補正の選択肢とメモはそのまま、補正時の自動判定の記録を現在の自動判定で置き換える。
 * 補正が無ければ 404 override_not_found。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request.headers)) return jsonNoStore({ error: "cross_origin" }, { status: 403 });
  const code = normalizeStockCode((await params).code);
  if (code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  const { data, error } = await auth.supabase.rpc("owner_override_acknowledge", { p_code: code });
  if (error) {
    console.error("[api/ownership-override/acknowledge] 確認済みにできませんでした", error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  if (data === null) return jsonNoStore({ error: "override_not_found" }, { status: 404 });
  return apiOverrideResponse(data);
}
