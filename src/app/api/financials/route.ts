import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { toApiPeriods } from "@/lib/financials/display";
import { fetchFinancialEntry } from "@/lib/financials/queries";
import { jsonNoStore } from "@/lib/http/no-store";
import { normalizeStockCode } from "@/lib/listing/ages";

export const dynamic = "force-dynamic";

/**
 * 1銘柄の財務指標と通期実績（`?code=` が必須。4文字なら末尾に 0 を足す）。ユーザー自身のセッションで読む（RLS が効く経路）。
 * metrics は financial_metrics の行（通期実績が無ければ null）、periods は financial_periods の行（古い順、全期間）。
 * 値は DB が算出したもの（revenue_cagr・operating_margin は比率、*_display_pct は百分率の小数点以下1桁に切り捨て）。
 */
export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const codeParam = request.nextUrl.searchParams.get("code");
  const code = codeParam === null ? null : normalizeStockCode(codeParam);
  if (code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  const stock = await auth.supabase.from("stocks").select("code").eq("code", code).limit(1);
  if (stock.error) {
    console.error("[api/financials] 銘柄の取得に失敗しました", stock.error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  if ((stock.data ?? []).length === 0) return jsonNoStore({ error: "not_found" }, { status: 404 });

  const entry = await fetchFinancialEntry(auth.supabase, code);
  if (!entry.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  return jsonNoStore({ data: { code, metrics: entry.value.metrics, periods: toApiPeriods(entry.value.periods) } });
}
