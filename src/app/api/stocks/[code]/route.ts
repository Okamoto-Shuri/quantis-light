import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { toApiPeriods } from "@/lib/financials/display";
import { jsonNoStore } from "@/lib/http/no-store";
import { normalizeStockCode } from "@/lib/listing/ages";
import { parseScreeningParams, searchParamsToRecord, toApiConditions } from "@/lib/screening/params";
import { toApiAnnualReport } from "@/lib/stocks/annual-report";
import { conditionSource } from "@/lib/stocks/detail";
import { fetchStockPage } from "@/lib/stocks/queries";
import { buildFiscalSlots } from "@/lib/stocks/slots";

export const dynamic = "force-dynamic";

/**
 * 銘柄詳細（Sprint 7）。クエリはスクリーニングの URL と同じ（判定の条件）。画面と同じ読み出し（stock_detail・financial_periods・
 * financial_metrics）をユーザーのセッションで行う。外部 API は呼ばない。
 * コードは正規化する（4文字・小文字もそのまま扱い、リダイレクトしない）。形が不正なら 400 invalid_code、銘柄マスタに無ければ 404。
 * 画面と違い、不正な条件のクエリは既定値に置き換えずに 400 invalid_params にする。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const code = normalizeStockCode((await params).code);
  if (code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  const raw = searchParamsToRecord(request.nextUrl.searchParams);
  const { conditions, invalidFields } = parseScreeningParams(raw);
  if (invalidFields.length > 0) return jsonNoStore({ error: "invalid_params", fields: invalidFields }, { status: 400 });

  const result = await fetchStockPage(auth.supabase, code, conditions);
  if (!result.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  if (result.value === null) return jsonNoStore({ error: "not_found" }, { status: 404 });

  const { detail, financial, annualReport } = result.value;
  const slots = buildFiscalSlots(financial.periods).map((slot) => ({
    position: slot.position,
    fiscal_year_end: slot.fiscalYearEnd,
    missing: slot.period === null,
  }));
  return jsonNoStore({
    data: {
      stock: detail.stock,
      referenceDate: detail.referenceDate,
      listing: detail.listing,
      metrics: financial.metrics,
      periods: toApiPeriods(financial.periods),
      slots,
      evaluation: {
        conditions: toApiConditions(conditions),
        source: conditionSource(raw),
        ...detail.evaluation,
      },
      annualReport: annualReport ? toApiAnnualReport(annualReport) : null,
    },
  });
}
