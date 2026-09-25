import { CircleDashed, KeyRound } from "lucide-react";

import { RunStatusBadge } from "@/components/run-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCount, formatDateTimeJst } from "@/lib/format";
import type { Result } from "@/lib/listing/queries";
import { runStatusSchema } from "@/lib/ingestion/runs";
import type { AnnualReportsSummary } from "@/lib/stocks/annual-reports-summary";

import { SummaryNumber, SummaryTile } from "./summary-tile";

const Dash = () => <span className="text-muted-foreground">—</span>;

function Summary({ summary }: { summary: AnnualReportsSummary }) {
  const details = summary.lastRun?.details ?? null;
  const inWindow = typeof details?.listDatesInWindow === "number" ? details.listDatesInWindow : null;
  const remaining = typeof details?.listDatesRemaining === "number" ? details.listDatesRemaining : null;
  const lastProcessed = summary.lastRun ? summary.lastRun.processedCount : null;
  const lastStatus = summary.lastRun ? runStatusSchema.safeParse(summary.lastRun.status) : null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SummaryTile
        label="有報を取得できた銘柄"
        testId="annual-report-stock-count"
        value={<SummaryNumber value={`${formatCount(summary.fetchedStockCount)} / ${formatCount(summary.stockCount)}`} unit="銘柄" />}
        note="銘柄マスタの銘柄のうち、直近の有報の本文を処理済みの銘柄"
      />
      <SummaryTile
        label="大株主・役員とも抽出できた銘柄"
        testId="annual-report-extracted-count"
        value={<SummaryNumber value={formatCount(summary.bothExtractedCount)} unit="銘柄" />}
      />
      <SummaryTile
        label="抽出できなかった銘柄"
        testId="annual-report-not-extracted-count"
        value={<SummaryNumber value={formatCount(summary.notExtractedCount)} unit="銘柄" />}
        note="大株主・役員のどちらかを有報から読み取れなかった銘柄"
      />
      <SummaryTile
        label="取り込み待ちの書類"
        testId="annual-report-pending-count"
        value={<SummaryNumber value={formatCount(summary.pendingDocumentCount)} unit="件" />}
        note={
          lastProcessed === null ? (
            "有報の取り込み実績がありません"
          ) : (
            <>
              直前の取り込みでは <span className="tabular font-mono">{formatCount(lastProcessed)}</span> 件を処理
            </>
          )
        }
      />
      <SummaryTile
        label="取得済みの書類一覧"
        testId="annual-report-list-dates"
        value={
          inWindow !== null && remaining !== null ? (
            <SummaryNumber value={`${formatCount(Math.max(0, inWindow - remaining))} / ${formatCount(inWindow)}`} unit="日" />
          ) : (
            <Dash />
          )
        }
        note={
          details?.windowStart && details.windowEnd ? (
            <>
              期間 <span className="tabular font-mono">{details.windowStart}</span>〜
              <span className="tabular font-mono">{details.windowEnd}</span>（最後の有報の取り込み時点）
            </>
          ) : (
            "有報の取り込み実績がありません"
          )
        }
      />
      <SummaryTile
        label="最後の有報の取り込み"
        testId="annual-report-last-run"
        value={
          summary.lastRun && lastStatus?.success ? (
            <span className="inline-flex items-center gap-2">
              <RunStatusBadge status={lastStatus.data} />
              <span className="tabular font-mono text-xs">{formatDateTimeJst(summary.lastRun.finishedAt) ?? "—"}</span>
            </span>
          ) : (
            <Dash />
          )
        }
        note={summary.lastRun ? <>処理件数 {formatCount(summary.lastRun.processedCount)} 件</> : undefined}
      />
    </dl>
  );
}

/**
 * 取り込み状況の画面の「有価証券報告書（大株主・役員）」。値はすべて保存済みデータ（DB 関数）から作る。
 * 初回はすべての有報（約 3,900 通）を取り込むまでに何回もの取り込みが必要なので、取り込み待ちの件数と直前の処理件数を示す。
 */
export function AnnualReportsPanel({ summary, keyConfigured }: { summary: Result<AnnualReportsSummary>; keyConfigured: boolean }) {
  return (
    <section aria-labelledby="annual-reports-heading" className="space-y-3" data-testid="annual-reports-panel">
      <div className="space-y-1">
        <h2 id="annual-reports-heading" className="text-sm font-medium">
          有価証券報告書（大株主・役員）
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          EDINET の書類一覧から各銘柄の直近の有価証券報告書（訂正を含む最新の提出分）を探し、「大株主の状況」と「役員の状況」を抽出します。
          処理済みの書類は取り直しません。1回の取り込みで処理できる書類の数には上限があるため、取り込み待ちが残るときは「今すぐ取り込み」を続けて押すか、定期実行を待ってください。
        </p>
      </div>

      {!keyConfigured && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="annual-reports-key-missing">
          <KeyRound aria-hidden="true" className="size-4 shrink-0" />
          EDINET の API キーが設定されていません（取り込みを実行すると失敗として記録されます）
        </p>
      )}

      {!summary.ok ? (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>有報の取り込み状況を取得できませんでした</AlertTitle>
          <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
        </Alert>
      ) : (
        <>
          <Summary summary={summary.value} />
          {summary.value.documentCount === 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed bg-card px-4 py-5" data-testid="annual-reports-empty">
              <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">まだ有報が取り込まれていません</p>
                <p className="text-sm text-muted-foreground">
                  手動取り込みで対象「有報（EDINET）」を選んで「今すぐ取り込み」を押すか、定期実行を待ってください。
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
