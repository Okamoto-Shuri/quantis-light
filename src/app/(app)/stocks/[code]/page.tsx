import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { IngestionRunningNote } from "@/components/imports/ingestion-notes";
import { AnnualReportSection } from "@/components/stocks/annual-report-section";
import { StockBreadcrumb } from "@/components/stocks/breadcrumb";
import { FinancialChart } from "@/components/stocks/financial-chart";
import { OwnershipBreakdown, OwnershipEvidence } from "@/components/stocks/ownership-sections";
import { AllPeriods, FivePeriodTable } from "@/components/stocks/period-tables";
import { StockEvaluation } from "@/components/stocks/stock-evaluation";
import { StockMetrics } from "@/components/stocks/stock-metrics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight, Ban, CircleDashed } from "lucide-react";
import Link from "next/link";
import { requireAllowedUser } from "@/lib/auth/guard";
import { fetchActiveRun } from "@/lib/ingestion/history";
import { normalizeStockCode } from "@/lib/listing/ages";
import type { RawParams } from "@/lib/screening/params";
import { fetchDefaultPreset } from "@/lib/screening/preset-queries";
import { detailConditionsWithPreset, hasScreeningParams } from "@/lib/stocks/detail";
import { fetchCompanyName, fetchStockPage } from "@/lib/stocks/queries";
import { buildFiscalSlots } from "@/lib/stocks/slots";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<RawParams>;
};

const NOT_FOUND_TITLE = "銘柄が見つかりません";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const code = normalizeStockCode((await params).code);
  if (code === null) return { title: NOT_FOUND_TITLE };
  const name = await fetchCompanyName(code);
  return { title: name === null ? NOT_FOUND_TITLE : `${code} ${name}` };
}

/** クエリを保ったまま URL を作る（リダイレクト用。未知のパラメータもそのまま残す）。 */
function withQuery(path: string, raw: RawParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * 銘柄詳細（F7）。保存済みデータだけを表示する（外部 API は呼ばない）。
 * - コードは正規化する。正規形と違えば正規形の URL にリダイレクト（クエリは保つ）、形が不正・銘柄マスタに無ければ notFound()（404）
 * - クエリはスクリーニングの条件（判定の閾値と戻り先）。不正な項目は既定値にして注記する
 * - クエリが無ければ、既定のプリセット（Sprint 13）があればその条件で判定する
 */
export default async function StockPage({ params, searchParams }: Props) {
  await requireAllowedUser();
  const [{ code: rawCode }, raw] = await Promise.all([params, searchParams]);
  const code = normalizeStockCode(rawCode);
  if (code === null) notFound();
  if (code !== rawCode) redirect(withQuery(`/stocks/${code}`, raw));

  const supabase = await createClient();
  // 条件のパラメータが無ければ、既定のプリセットの条件で判定する（Sprint 13）
  const dc = detailConditionsWithPreset(raw, hasScreeningParams(raw) ? { ok: true, value: null } : await fetchDefaultPreset(supabase));
  const [result, active] = await Promise.all([fetchStockPage(supabase, code, dc.conditions), fetchActiveRun(supabase)]);
  const activeRun = active.ok ? active.activeRun : null;

  if (!result.ok) {
    return (
      <div className="space-y-5">
        <StockBreadcrumb screeningHref={dc.screeningHref} current={code} />
        <Alert variant="destructive">
          <AlertTitle>銘柄の情報を読み込めませんでした</AlertTitle>
          <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (result.value === null) notFound();

  const { detail, financial, annualReport } = result.value;
  const { stock } = detail;
  const slots = buildFiscalSlots(financial.periods);

  return (
    <div className="space-y-5">
      <StockBreadcrumb screeningHref={dc.screeningHref} current={`${stock.code} ${stock.company_name}`} />

      <header className="space-y-1.5" data-testid="stock-header">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="tabular rounded-md border bg-card px-2 py-0.5 font-mono text-sm" data-testid="stock-code">
            {stock.code}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{stock.company_name}</h1>
          {stock.delisted_on && (
            <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className="inline-flex items-center gap-1 self-center rounded-sm border border-destructive/30 bg-destructive-muted px-1.5 py-0.5 text-xs font-medium text-destructive-strong"
                data-testid="delisted-badge"
              >
                <Ban aria-hidden="true" className="size-3.5" />
                上場廃止
              </span>
              <span className="text-xs text-muted-foreground" data-testid="delisted-note">
                <span className="tabular font-mono">{stock.delisted_on}</span> の銘柄マスタで確認
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs" data-testid="stock-market">
            {stock.market_name ?? "市場区分なし"}
          </span>
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs" data-testid="stock-sector">
            {stock.sector33_name ?? "業種なし"}
          </span>
          <span className="text-muted-foreground">
            保存済みデータ（
            {detail.referenceDate ? (
              <>
                基準日 <span className="tabular font-mono">{detail.referenceDate}</span>
              </>
            ) : (
              "基準日なし（株価の取り込み実績がありません）"
            )}
            ）
          </span>
        </div>
      </header>

      {activeRun && <IngestionRunningNote run={activeRun} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <StockEvaluation detail={detail} metrics={financial.metrics} dc={dc} />
        <StockMetrics detail={detail} entry={financial} />
      </div>

      <section aria-labelledby="financials-heading" className="space-y-3 rounded-lg border bg-card p-4" data-testid="stock-financials">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="financials-heading" className="text-base font-semibold tracking-tight">
            業績推移（通期・直近5期）
          </h2>
          <p className="text-xs text-muted-foreground">通期実績（決算短信。無い期は EDINET の有価証券報告書・届出書から補う。業績予想・四半期は含まない）。金額は百万円</p>
        </div>
        {slots.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-dashed px-4 py-6" data-testid="financials-empty">
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleDashed aria-hidden="true" className="size-4" />
              財務データがありません（未取り込み）
            </p>
            <Link href="/imports" className="inline-flex items-center gap-1 text-sm text-signal-strong underline-offset-2 hover:underline">
              取り込み状況を見る
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        ) : (
          <>
            <FinancialChart slots={slots} />
            <FivePeriodTable slots={slots} metrics={financial.metrics} />
            <AllPeriods periods={financial.periods} slots={slots} />
          </>
        )}
      </section>

      <OwnershipEvidence code={stock.code} ownership={detail.ownership} conditions={dc.conditions} />
      <OwnershipBreakdown ownership={detail.ownership} />

      <AnnualReportSection row={annualReport} />
    </div>
  );
}
