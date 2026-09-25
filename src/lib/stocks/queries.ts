import "server-only";

import { cache } from "react";

import { fetchFinancialEntry, type FinancialEntry } from "@/lib/financials/queries";
import type { Result } from "@/lib/listing/queries";
import { toScreenStocksParams, type ScreeningConditions } from "@/lib/screening/params";
import { createClient } from "@/lib/supabase/server";

import { annualReportRowSchema, type AnnualReportRow } from "./annual-report";
import { stockDetailSchema, type StockDetail } from "./detail";

/**
 * 銘柄詳細の読み出し。ユーザーのセッション（RLS が効く経路）で DB 関数 stock_detail と、通期実績・指標を読む。外部 API は呼ばない。
 * 銘柄マスタに無いコードは value が null。失敗は ok: false（呼び出し側がエラー表示・500 にする）。
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type StockPage = { detail: StockDetail; financial: FinancialEntry; annualReport: AnnualReportRow | null };

function fail(label: string, message: string): { ok: false } {
  console.error(`[stocks] ${label}に失敗しました`, message);
  return { ok: false };
}

export async function fetchStockPage(
  supabase: SupabaseServerClient,
  code: string,
  conditions: ScreeningConditions,
): Promise<Result<StockPage | null>> {
  const [detail, financial, annual] = await Promise.all([
    supabase.rpc("stock_detail", { p_code: code, p_params: toScreenStocksParams(conditions, { clampPage: false }) }),
    fetchFinancialEntry(supabase, code),
    supabase.rpc("annual_report_detail", { p_code: code }),
  ]);
  if (detail.error) return fail("銘柄詳細の取得", detail.error.message);
  if (detail.data === null) return { ok: true, value: null };
  const parsed = stockDetailSchema.safeParse(detail.data);
  if (!parsed.success) return fail("銘柄詳細の形式の確認", parsed.error.message);
  if (!financial.ok) return { ok: false };
  if (annual.error) return fail("有報の大株主・役員の取得", annual.error.message);
  let annualReport: AnnualReportRow | null = null;
  if (annual.data !== null) {
    const parsedAnnual = annualReportRowSchema.safeParse(annual.data);
    if (!parsedAnnual.success) return fail("有報の大株主・役員の形式の確認", parsedAnnual.error.message);
    annualReport = parsedAnnual.data;
  }
  return { ok: true, value: { detail: parsed.data, financial: financial.value, annualReport } };
}

/** 文書のタイトル用の社名（generateMetadata とページで1回だけ読む）。無ければ null。 */
export const fetchCompanyName = cache(async (code: string): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("stocks").select("company_name").eq("code", code).limit(1);
  if (error) {
    console.error("[stocks] 社名の取得に失敗しました", error.message);
    return null;
  }
  return (data?.[0]?.company_name as string | undefined) ?? null;
});
