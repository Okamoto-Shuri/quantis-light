import type { Metadata } from "next";

import { DashboardEmptyState } from "@/components/dashboard/empty-state";
import { FreshnessPanel } from "@/components/dashboard/freshness-panel";
import { ScreeningChangesSection } from "@/components/dashboard/screening-changes";
import { StatBreakdown, StatTile } from "@/components/dashboard/stat-tile";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAllowedUser } from "@/lib/auth/guard";
import { formatCount } from "@/lib/format";
import { fetchDashboardSummary, isEmptyDashboard } from "@/lib/dashboard/summary";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ダッシュボード" };

export default async function DashboardPage() {
  await requireAllowedUser();
  const supabase = await createClient();
  const result = await fetchDashboardSummary(supabase);
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader title="ダッシュボード" description="保存済みデータの鮮度と件数" />

      {!result.ok ? (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>ダッシュボードの集計を取得できませんでした</AlertTitle>
          <AlertDescription>
            時間をおいて再読み込みしてください。解消しない場合は、データベースの状態を確認してください。
          </AlertDescription>
        </Alert>
      ) : isEmptyDashboard(result.summary) ? (
        <DashboardEmptyState latestRun={result.summary.latestRun} />
      ) : (
        <>
          <FreshnessPanel summary={result.summary} now={now} />
          <ScreeningChangesSection supabase={supabase} />
          <section aria-labelledby="counts-heading" className="space-y-3">
            <h2 id="counts-heading" className="text-sm font-medium">
              保存済みデータの件数
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatTile label="保存済みの銘柄数（上場中）" value={result.summary.stockCount} testId="stat-stocks">
                {result.summary.delistedCount > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="dashboard-delisted-count">
                    ほかに上場廃止 <span className="tabular font-mono">{formatCount(result.summary.delistedCount)}</span> 銘柄（スクリーニングの対象外）
                  </p>
                )}
              </StatTile>
              <StatTile
                label="財務指標を算出できた銘柄数"
                value={result.summary.financialMetrics.anyCount}
                total={result.summary.stockCount}
                testId="stat-financial"
              >
                <StatBreakdown
                  items={[
                    { label: "売上CAGR", value: result.summary.financialMetrics.revenueCagrCount },
                    { label: "営業利益率", value: result.summary.financialMetrics.operatingMarginCount },
                  ]}
                />
              </StatTile>
              <StatTile
                label="条件④を判定できた銘柄数"
                value={result.summary.ownershipDeterminedCount}
                total={result.summary.stockCount}
                testId="stat-ownership"
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
