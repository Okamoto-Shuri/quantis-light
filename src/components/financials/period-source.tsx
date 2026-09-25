import { ExternalLink } from "lucide-react";

import { edinetViewerUrl } from "@/lib/edinet";
import { isEdinetSource, periodDocument, sourceLabel, type FinancialPeriod } from "@/lib/financials/display";
import { cn } from "@/lib/utils";

import { DisclosureCountBadge } from "./period-badges";

/**
 * 期の値の出典の表示（Sprint 9。AC15.2）。銘柄詳細の5期の表と、取り込み状況の「銘柄コードで確認」のカードで共有する。
 * 1つの期の売上高と営業利益は、同じ出典・同じ書類から来る（DB の financial_periods が期ごとに1つの書類を選ぶ）。
 */

/** 出典の小さなラベル（「決算短信」「有価証券報告書」「有価証券届出書」）。 */
export function SourceLabel({ source }: { source: string }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-xs whitespace-nowrap",
        isEdinetSource(source) ? "border border-info/40 bg-info-muted text-info-strong" : "bg-muted",
      )}
      data-testid="cell-source-label"
    >
      {sourceLabel(source)}
    </span>
  );
}

/** EDINET の書類閲覧ページへのリンク（新しいタブ）。 */
export function EdinetDocumentLink({ docId, className }: { docId: string; className?: string }) {
  return (
    <a
      href={edinetViewerUrl(docId)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("relative inline-flex items-center gap-0.5 text-xs text-signal-strong underline-offset-2 hover:underline", className)}
      data-testid="period-edinet-link"
    >
      EDINET
      <ExternalLink aria-hidden="true" className="size-3" />
      <span className="sr-only">で {docId} を開く（新しいタブで開きます）</span>
    </a>
  );
}

/** 書類の列: EDINET の期は書類ID・訂正・提出日・リンク、決算短信の期は開示日。 */
export function PeriodDocument({ period }: { period: FinancialPeriod }) {
  const doc = periodDocument(period);
  if (!doc) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-testid="cell-document">
        <span className="tabular font-mono text-xs">{period.source_document_date}</span>
        <DisclosureCountBadge count={period.disclosure_count} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="cell-document" data-doc-id={doc.docId}>
      <span className="tabular rounded-sm border bg-background px-1 py-px font-mono text-xs">{doc.docId}</span>
      {doc.amendment && (
        <span className="rounded-sm border px-1 py-px text-xs text-muted-foreground" data-testid="amendment-badge">
          訂正
        </span>
      )}
      <span className="text-xs text-muted-foreground">
        <span className="tabular font-mono">{doc.submittedDate}</span> 提出
      </span>
      <EdinetDocumentLink docId={doc.docId} />
      <DisclosureCountBadge count={period.disclosure_count} kind="document" />
    </span>
  );
}
