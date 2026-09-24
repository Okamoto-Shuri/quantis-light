import { History } from "lucide-react";
import type { Metadata } from "next";

import { ConnectionPanel } from "@/components/imports/connection-panel";
import { ManualIngestion } from "@/components/imports/manual-ingestion";
import { RunHistory } from "@/components/imports/run-history";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAllowedUser } from "@/lib/auth/guard";
import { getIngestionConfigStatus } from "@/lib/ingestion/config";
import { fetchActiveRun, fetchLastCompletedBySource, fetchRunHistory } from "@/lib/ingestion/history";
import { RUN_HISTORY_LIMIT, toApiRun } from "@/lib/ingestion/runs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "取り込み状況" };

/**
 * 取り込み状況: データソースと定期実行の設定状態、手動取り込み、実行履歴。
 * 設定状態は環境変数の有無だけで判定し、画面を開いても外部 API は呼ばない。
 */
export default async function ImportsPage() {
  await requireAllowedUser();
  const supabase = await createClient();
  const now = new Date();
  const [result, active, lastCompleted] = await Promise.all([
    fetchRunHistory(supabase),
    fetchActiveRun(supabase, now),
    fetchLastCompletedBySource(supabase),
  ]);
  const config = getIngestionConfigStatus();

  return (
    <div className="space-y-6">
      <PageHeader title="取り込み状況" description="データソースの設定、手動取り込み、実行履歴" />

      <ConnectionPanel config={config} lastCompleted={lastCompleted.ok ? lastCompleted.value : null} />

      {result.ok && active.ok ? (
        <ManualIngestion
          activeRun={active.activeRun ? toApiRun(active.activeRun) : null}
          recentRuns={result.runs.map(toApiRun)}
        />
      ) : null}

      <section aria-labelledby="history-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="history-heading" className="text-sm font-medium">
            実行履歴
          </h2>
          {result.ok && result.hasMore && (
            <p className="text-xs text-muted-foreground">
              件数が多いため、新しい {RUN_HISTORY_LIMIT} 件だけを表示しています
            </p>
          )}
        </div>

        {!result.ok || !active.ok ? (
          <Alert variant="destructive" className="max-w-2xl">
            <AlertTitle>実行履歴を取得できませんでした</AlertTitle>
            <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
          </Alert>
        ) : result.runs.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed bg-card px-4 py-8">
            <History aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">実行履歴はまだありません</p>
              <p className="text-sm text-muted-foreground">取り込みが実行されると、結果がここに記録されます。</p>
            </div>
          </div>
        ) : (
          <RunHistory runs={result.runs} now={now} />
        )}
      </section>
    </div>
  );
}
