import { History } from "lucide-react";
import type { Metadata } from "next";

import { RunHistory } from "@/components/imports/run-history";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireAllowedUser } from "@/lib/auth/guard";
import { fetchRunHistory } from "@/lib/ingestion/history";
import { RUN_HISTORY_LIMIT } from "@/lib/ingestion/runs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "取り込み状況" };

/**
 * 取り込み状況（Sprint 2 は実行履歴の閲覧のみ）。
 * データソースの設定状態と手動実行は、取り込み処理とともに Sprint 3 で追加する。
 */
export default async function ImportsPage() {
  await requireAllowedUser();
  const result = await fetchRunHistory(await createClient());

  return (
    <div className="space-y-6">
      <PageHeader title="取り込み状況" description="データ取り込みの実行履歴（開始日時の新しい順）" />

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

        {!result.ok ? (
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
          <RunHistory runs={result.runs} />
        )}
      </section>
    </div>
  );
}
