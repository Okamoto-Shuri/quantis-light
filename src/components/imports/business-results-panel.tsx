import { CircleDashed, KeyRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { BusinessResultsSummary } from "@/lib/financials/business-results-summary";
import { formatCount } from "@/lib/format";
import { RUN_TARGET_LONG_LABELS } from "@/lib/ingestion/runs";
import type { Result } from "@/lib/listing/queries";

import { SummaryNumber, SummaryTile } from "./summary-tile";

function Summary({ summary }: { summary: BusinessResultsSummary }) {
  const ok = summary.statusCounts.ok ?? 0;
  const notFound = summary.statusCounts.section_not_found ?? 0;
  const invalid = summary.statusCounts.invalid_values ?? 0;
  const noXbrl = summary.statusCounts.no_xbrl ?? 0;
  const lastProcessed = summary.lastRun ? summary.lastRun.processedCount : null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SummaryTile
        label="EDINET から期を補った銘柄"
        testId="supplemented-stock-count"
        value={<SummaryNumber value={`${formatCount(summary.supplementedStockCount)} / ${formatCount(summary.stockCount)}`} unit="銘柄" />}
        note="決算短信に無い期（主に上場前の期）を、有価証券報告書・届出書から補った銘柄"
      />
      <SummaryTile
        label="うち売上CAGR の算出に補った期を使った銘柄"
        testId="supplemented-cagr-count"
        value={<SummaryNumber value={formatCount(summary.supplementedCagrCount)} unit="銘柄" />}
        note="スクリーニングの売上CAGR に「補完」の印が付く銘柄"
      />
      <SummaryTile
        label="主要な経営指標等を処理した書類"
        testId="business-results-processed"
        value={
          <SummaryNumber
            value={`${formatCount(summary.processedAnnualReports + summary.processedRegistrationStatements)}`}
            unit="件"
          />
        }
        note={
          <span data-testid="business-results-processed-breakdown">
            有報 <span className="tabular font-mono">{formatCount(summary.processedAnnualReports)}</span>、届出書{" "}
            <span className="tabular font-mono">{formatCount(summary.processedRegistrationStatements)}</span>。読み取れた{" "}
            <span className="tabular font-mono">{formatCount(ok)}</span>、記載なし <span className="tabular font-mono">{formatCount(notFound)}</span>
            、読み取れず <span className="tabular font-mono">{formatCount(invalid)}</span>、XBRL なし{" "}
            <span className="tabular font-mono">{formatCount(noXbrl)}</span>
          </span>
        }
      />
      <SummaryTile
        label="取り込み待ちの書類"
        testId="business-results-pending-count"
        value={<SummaryNumber value={formatCount(summary.pendingDocumentCount)} unit="件" />}
        note={
          lastProcessed === null ? (
            "EDINET の取り込み実績がありません"
          ) : (
            <>
              主要な経営指標等が未処理の書類。直前の EDINET の取り込みでは <span className="tabular font-mono">{formatCount(lastProcessed)}</span>{" "}
              件を処理
            </>
          )
        }
      />
      <SummaryTile
        label="銘柄に結び付かない届出書"
        testId="business-results-unlinked"
        value={<SummaryNumber value={formatCount(summary.unlinkedRegistrationStatements)} unit="件" />}
        note="証券コードが無く、同じ提出者の上場後の書類もまだ無い届出書（社名では結び付けません）"
      />
    </dl>
  );
}

/**
 * 取り込み状況の画面の「上場前の期の補完（EDINET）」（Sprint 9。AC15.11）。値はすべて保存済みデータ（DB 関数）から作る。
 * 取り込みは有報の大株主・役員と同じ実行（EDINET）で行う。
 */
export function BusinessResultsPanel({ summary, keyConfigured }: { summary: Result<BusinessResultsSummary>; keyConfigured: boolean }) {
  const empty = summary.ok && summary.value.processedAnnualReports + summary.value.processedRegistrationStatements === 0;
  return (
    <section aria-labelledby="business-results-heading" className="space-y-3" data-testid="business-results-panel">
      <div className="space-y-1">
        <h2 id="business-results-heading" className="text-sm font-medium">
          上場前の期の補完（EDINET）
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          有価証券報告書・有価証券届出書の「主要な経営指標等の推移」から各期の売上高・営業利益を読み取り、決算短信に無い期（主に上場前の期）を補います。
          決算短信にある期は決算短信を優先します。取り込みは「{RUN_TARGET_LONG_LABELS.edinet_reports}」の実行で、有報の大株主・役員と一緒に行います。
        </p>
      </div>

      {!keyConfigured && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="business-results-key-missing">
          <KeyRound aria-hidden="true" className="size-4 shrink-0" />
          EDINET の API キーが設定されていません（取り込みを実行すると失敗として記録されます）
        </p>
      )}

      {!summary.ok ? (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>上場前の期の補完の状況を取得できませんでした</AlertTitle>
          <AlertDescription>時間をおいて再読み込みしてください。</AlertDescription>
        </Alert>
      ) : (
        <>
          <Summary summary={summary.value} />
          {empty && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed bg-card px-4 py-5" data-testid="business-results-empty">
              <CircleDashed aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">まだ上場前の期の補完は行われていません</p>
                <p className="text-sm text-muted-foreground">
                  手動取り込みで対象「{RUN_TARGET_LONG_LABELS.edinet_reports}」を選んで「今すぐ取り込み」を押すか、定期実行を待ってください。
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
