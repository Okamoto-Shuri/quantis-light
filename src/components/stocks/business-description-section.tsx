import { CircleAlert, CircleDashed, ExternalLink, FileSearch, Hourglass, Info, Quote } from "lucide-react";

import { docTypeLabel, edinetViewerUrl, fiscalPeriodLabel, jstDateOf } from "@/lib/stocks/annual-report";
import {
  BUSINESS_DESCRIPTION_LABEL,
  businessDescriptionFallbackNote,
  businessDescriptionMessage,
  businessDescriptionReason,
  businessDescriptionStatus,
  type BusinessDescriptionRow,
} from "@/lib/stocks/business-description";

/**
 * 銘柄詳細の「事業の内容」（Sprint 16。F16）。有報の「事業の内容」の最初の段落を原文のまま表示する（要約・言い換えはしない）。
 * 位置は「条件の判定」の直前。状態（取得済み・未取得・取り込み待ち・記載なし・抽出失敗）にかかわらず同じ枠を出す。
 * 段落は React のテキストとして描画する（HTML として解釈しない。AC16.11）。
 */

function EdinetLink({ docId }: { docId: string }) {
  return (
    <a
      href={edinetViewerUrl(docId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-signal-strong underline-offset-2 hover:underline"
      data-testid="business-description-edinet-link"
    >
      EDINET で開く
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <span className="sr-only">（新しいタブで開きます）</span>
    </a>
  );
}

function DocId({ docId }: { docId: string }) {
  return <span className="tabular rounded-sm border bg-background px-1.5 py-0.5 font-mono text-xs">{docId}</span>;
}

/** 出典（書類の種類・書類ID・提出日・対象の事業年度・EDINET のリンク） */
function Source({ row }: { row: BusinessDescriptionRow }) {
  const { document } = row;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground"
      data-testid="business-description-source"
      data-doc-id={document.doc_id}
    >
      <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-foreground" data-testid="business-description-doc-type">
        {docTypeLabel(document.doc_type_code)}
      </span>
      <DocId docId={document.doc_id} />
      <span>
        提出日 <span className="tabular font-mono text-foreground">{jstDateOf(document.submitted_at)}</span>
      </span>
      <span>
        対象の事業年度{" "}
        <span className="tabular font-mono text-foreground">
          {fiscalPeriodLabel(document.period_end)}（{document.period_start ?? ""}〜{document.period_end}）
        </span>
      </span>
      <EdinetLink docId={document.doc_id} />
    </div>
  );
}

function Paragraph({ row }: { row: BusinessDescriptionRow }) {
  const note = businessDescriptionFallbackNote(row);
  return (
    <div className="space-y-3">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-info-strong" data-testid="business-description-label">
        <Quote aria-hidden="true" className="size-3.5" />
        {BUSINESS_DESCRIPTION_LABEL}
      </p>
      <blockquote cite={edinetViewerUrl(row.document.doc_id)} className="border-l-2 border-info/40 pl-3 sm:pl-4">
        <p
          className="max-w-[46rem] text-[0.9375rem] leading-[1.9] whitespace-pre-line [overflow-wrap:anywhere]"
          data-testid="business-description-text"
        >
          {row.paragraph}
        </p>
      </blockquote>
      {note && (
        <p
          className="flex max-w-[46rem] items-start gap-1.5 rounded-sm bg-caution-muted px-2 py-1 text-xs text-caution-strong"
          data-testid="business-description-fallback"
        >
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{note}</span>
        </p>
      )}
      <Source row={row} />
    </div>
  );
}

/** 段落を表示できない状態。書類があれば書類ID・提出日・リンクを添える。 */
function StateNotice({ row }: { row: BusinessDescriptionRow | null }) {
  const status = businessDescriptionStatus(row);
  const message = businessDescriptionMessage(status, row);
  const reason = businessDescriptionReason(status, row?.detail ?? null);
  const Icon =
    status === "pending" ? Hourglass : status === "no_annual_report" ? CircleDashed : status === "section_not_found" ? FileSearch : CircleAlert;
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed px-3 py-3 text-sm" data-testid="business-description-state">
      <Icon
        aria-hidden="true"
        className={status === "no_xbrl" || status === "invalid_values" ? "mt-0.5 size-4 shrink-0 text-destructive-strong" : "mt-0.5 size-4 shrink-0 text-muted-foreground"}
      />
      <div className="min-w-0 space-y-1">
        <p className={status === "no_xbrl" || status === "invalid_values" ? "font-medium" : "text-muted-foreground"} data-testid="business-description-message">
          {message}
        </p>
        {reason && (
          <p className="text-xs text-muted-foreground" data-testid="business-description-reason">
            {reason}
          </p>
        )}
        {status === "pending" && <p className="text-xs text-muted-foreground">次の EDINET の取り込みで表示されます</p>}
        {row && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="business-description-source" data-doc-id={row.document.doc_id}>
            <span>{docTypeLabel(row.document.doc_type_code)}</span>
            <DocId docId={row.document.doc_id} />
            <span>
              <span className="tabular font-mono">{jstDateOf(row.document.submitted_at)}</span> 提出
            </span>
            <span data-testid="business-description-period">
              対象の事業年度 <span className="tabular font-mono">{fiscalPeriodLabel(row.document.period_end)}</span>
            </span>
            <EdinetLink docId={row.document.doc_id} />
          </p>
        )}
      </div>
    </div>
  );
}

export function BusinessDescriptionSection({ row }: { row: BusinessDescriptionRow | null }) {
  const status = businessDescriptionStatus(row);
  return (
    <section
      aria-labelledby="business-description-heading"
      className="min-w-0 space-y-3 rounded-lg border bg-card p-4"
      data-testid="business-description"
      data-status={status}
      data-fallback={row?.fallback ? "true" : "false"}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="business-description-heading" className="text-base font-semibold tracking-tight">
          事業の内容
        </h2>
        {/* 引用の趣旨の文は、段落を表示するときだけ出す（段落の無い状態には引用のラベルを付けない。AC16.5。評価 B1） */}
        {status === "ok" && (
          <p className="text-xs text-muted-foreground" data-testid="business-description-quote-note">
            有価証券報告書（EDINET）の記載から引用。要約・言い換えはしていません
          </p>
        )}
      </div>
      {status === "ok" && row ? <Paragraph row={row} /> : <StateNotice row={row} />}
    </section>
  );
}
