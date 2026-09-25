import { ArrowRight, CircleAlert, CircleDashed, ExternalLink, FileText, Hourglass, Info } from "lucide-react";
import Link from "next/link";

import {
  docTypeLabel,
  edinetViewerUrl,
  fiscalPeriodLabel,
  formatRatioPct,
  formatShares,
  jstDateOf,
  sectionReason,
  type AnnualReportRow,
  type SectionStatus,
} from "@/lib/stocks/annual-report";
import { cn } from "@/lib/utils";

/**
 * 銘柄詳細の「大株主・役員（有価証券報告書）」（Sprint 8）。値は DB の annual_report_detail（書類の選び方は DB の1か所）。
 * 区分・照合・判定（条件④）は Sprint 10 で加える。ここでは有報の記載をそのまま表示する。
 */

function EdinetLink({ docId, label = "EDINET で開く", className }: { docId: string; label?: string; className?: string }) {
  return (
    <a
      href={edinetViewerUrl(docId)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 text-signal-strong underline-offset-2 hover:underline", className)}
      data-testid="edinet-link"
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <span className="sr-only">（新しいタブで開きます）</span>
    </a>
  );
}

function DocId({ docId }: { docId: string }) {
  return <span className="tabular rounded-sm border bg-background px-1.5 py-0.5 font-mono text-xs">{docId}</span>;
}

function DocTypeBadge({ code }: { code: string }) {
  return (
    <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs" data-testid="doc-type">
      {docTypeLabel(code)}
    </span>
  );
}

function periodText(row: AnnualReportRow): string {
  const { period_start: start, period_end: end } = row.document;
  return `${fiscalPeriodLabel(end)}（${start ?? ""}〜${end}）`;
}

function SourceDocument({ row }: { row: AnnualReportRow }) {
  const { document, siblings } = row;
  const active = siblings.filter((s) => !s.withdrawn && !s.withheld);
  const inactive = siblings.filter((s) => s.withdrawn || s.withheld);
  return (
    <div className="space-y-2 rounded-md border bg-surface px-3 py-2.5" data-testid="annual-report-source" data-doc-id={document.doc_id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <DocTypeBadge code={document.doc_type_code} />
        <DocId docId={document.doc_id} />
        <span className="text-muted-foreground">
          提出日 <span className="tabular font-mono text-foreground">{jstDateOf(document.submitted_at)}</span>
        </span>
        <span className="text-muted-foreground">
          対象の事業年度 <span className="tabular font-mono text-foreground">{periodText(row)}</span>
        </span>
        <EdinetLink docId={document.doc_id} className="text-sm" />
      </div>
      {siblings.length > 0 && (
        <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground" data-testid="annual-report-siblings">
          {active.length > 0 &&
            (row.shareholders.fallback || row.officers.fallback ? (
              // 区画のどれかが元の有報の記載のときは「最新の提出分を使っています」と書かない（Sprint 8 評価の m2）
              <p data-testid="annual-report-siblings-summary">
                同じ事業年度の書類が{row.candidate_count}件あります（訂正を含む）。最新の提出分: {docTypeLabel(document.doc_type_code)}{" "}
                <span className="tabular font-mono">{document.doc_id}</span>（<span className="tabular font-mono">{jstDateOf(document.submitted_at)}</span>{" "}
                提出）。区画によっては元の有報の記載を表示しています。
              </p>
            ) : (
              <p data-testid="annual-report-siblings-summary">
                同じ事業年度の書類が{row.candidate_count}件あります（訂正を含む）。最新の提出分を使っています。
              </p>
            ))}
          {active.length === 0 && inactive.length > 0 && <p>同じ事業年度には、使っていない書類があります。</p>}
          <ul className="flex flex-col gap-1">
            {siblings.map((sibling) => (
              <li key={sibling.doc_id} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="sibling" data-doc-id={sibling.doc_id}>
                <span>{docTypeLabel(sibling.doc_type_code)}</span>
                <DocId docId={sibling.doc_id} />
                {sibling.submitted_at && (
                  <span>
                    <span className="tabular font-mono">{jstDateOf(sibling.submitted_at)}</span> 提出
                  </span>
                )}
                {sibling.withdrawn && (
                  <span className="rounded-sm border border-dashed px-1.5 text-xs" data-testid="sibling-withdrawn">
                    取り下げ（使っていません）
                  </span>
                )}
                {!sibling.withdrawn && sibling.withheld && (
                  <span className="rounded-sm border border-dashed px-1.5 text-xs">不開示（使っていません）</span>
                )}
                <EdinetLink docId={sibling.doc_id} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Section = AnnualReportRow["shareholders"] | AnnualReportRow["officers"];

function SectionSource({ row, section, label }: { row: AnnualReportRow; section: Section; label: string }) {
  if (section.status === "pending") return null;
  const latest = row.document;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p data-testid="section-source" data-doc-id={section.source_doc_id} data-fallback={section.fallback ? "true" : "false"}>
        出典: {section.source_doc_type_code ? docTypeLabel(section.source_doc_type_code) : "書類"}{" "}
        <span className="tabular font-mono">{section.source_doc_id}</span>
        {section.source_submitted_at && (
          <>
            （<span className="tabular font-mono">{jstDateOf(section.source_submitted_at)}</span> 提出）
          </>
        )}
      </p>
      {section.fallback && (
        <p className="flex items-start gap-1.5 rounded-sm bg-caution-muted px-2 py-1 text-caution-strong" data-testid="section-fallback">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {docTypeLabel(latest.doc_type_code)} {latest.doc_id}（{jstDateOf(latest.submitted_at)} 提出）には『{label}』の記載が無いため、
            {section.source_doc_type_code ? docTypeLabel(section.source_doc_type_code) : "書類"} {section.source_doc_id}（
            {jstDateOf(section.source_submitted_at)} 提出）の記載を表示しています
          </span>
        </p>
      )}
    </div>
  );
}

function SectionFailure({ kind, status, detail }: { kind: "shareholders" | "officers"; status: SectionStatus; detail: string | null }) {
  const label = kind === "shareholders" ? "大株主情報" : "役員情報";
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed px-3 py-3 text-sm" data-testid="section-failure">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive-strong" />
      <div className="space-y-0.5">
        <p className="font-medium">有報から{label}を抽出できませんでした</p>
        <p className="text-xs text-muted-foreground">{sectionReason(kind, status, detail)}</p>
      </div>
    </div>
  );
}

/** 区画だけが取り込み待ち（記載を確かめる書類が未処理）。待っている書類の種類・書類ID・提出日を示す（Sprint 8 評価の m3）。 */
function SectionPending({ section }: { section: Section }) {
  return (
    <p className="flex items-center gap-1.5 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground" data-testid="section-pending">
      <Hourglass aria-hidden="true" className="size-4 shrink-0" />
      <span>
        記載を確かめる書類（{section.source_doc_type_code ? docTypeLabel(section.source_doc_type_code) : "書類"}{" "}
        <span className="tabular font-mono">{section.source_doc_id}</span>
        {section.source_submitted_at && (
          <>
            、<span className="tabular font-mono">{jstDateOf(section.source_submitted_at)}</span> 提出
          </>
        )}
        ）が取り込み待ちです（次の EDINET の取り込みで表示されます）
      </span>
    </p>
  );
}

function Shareholders({ row }: { row: AnnualReportRow }) {
  const section = row.shareholders;
  return (
    <section aria-labelledby="shareholders-heading" className="min-w-0 space-y-2" data-testid="major-shareholders" data-status={section.status}>
      <div className="space-y-0.5">
        <h3 id="shareholders-heading" className="text-sm font-semibold">
          大株主の状況
        </h3>
        <p className="text-xs text-muted-foreground">持株比率は発行済株式（自己株式を除く）の総数に対する割合。有報の記載どおり</p>
      </div>
      <SectionSource row={row} section={section} label="大株主の状況" />
      {section.status === "ok" ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm sm:min-w-[30rem]" data-testid="shareholders-table">
            <thead className="border-b bg-surface text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-2 py-2 text-right font-medium whitespace-nowrap sm:w-12 sm:px-3">
                  順位
                </th>
                <th scope="col" className="px-2 py-2 text-left font-medium sm:px-3">
                  氏名・名称
                </th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium whitespace-nowrap sm:table-cell">
                  所有株式数（株）
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  持株比率（%）
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {section.rows.map((holder) => (
                <tr key={holder.rank} data-rank={holder.rank}>
                  <td className="tabular px-2 py-2 text-right font-mono whitespace-nowrap sm:px-3">{holder.rank}</td>
                  <td className="px-2 py-2 break-words sm:px-3" data-testid="holder-name">
                    <span className="block">{holder.name}</span>
                    {holder.address && <span className="block text-xs text-muted-foreground">{holder.address}</span>}
                    {/* 狭い画面では所有株式数の列を隠し、ここに出す（Sprint 8 評価の m1。情報は消さない） */}
                    <span className="tabular block font-mono text-xs text-muted-foreground sm:hidden" aria-hidden="true">
                      {formatShares(holder.shares_held) ?? "—"} 株
                    </span>
                  </td>
                  <td className="tabular hidden px-3 py-2 text-right font-mono whitespace-nowrap sm:table-cell" data-testid="holder-shares">
                    {formatShares(holder.shares_held) ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td
                    className="tabular px-2 py-2 text-right font-mono whitespace-nowrap sm:px-3"
                    data-testid="holder-ratio"
                    data-ratio-pct={holder.ratio_pct}
                  >
                    {formatRatioPct(holder.ratio_pct, holder.ratio_decimals)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : section.status === "pending" ? (
        <SectionPending section={section} />
      ) : (
        <SectionFailure kind="shareholders" status={section.status} detail={section.detail} />
      )}
    </section>
  );
}

function Officers({ row }: { row: AnnualReportRow }) {
  const section = row.officers;
  return (
    <section aria-labelledby="officers-heading" className="min-w-0 space-y-2" data-testid="officers" data-status={section.status}>
      <div className="space-y-0.5">
        <h3 id="officers-heading" className="text-sm font-semibold">
          役員の状況
        </h3>
        <p className="text-xs text-muted-foreground">提出日現在の役員。書類の記載順</p>
      </div>
      <SectionSource row={row} section={section} label="役員の状況" />
      {section.status === "ok" && section.has_post_agm_table && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="post-agm-note">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          この有報には定時株主総会後の役員の予定も記載されています（表示は提出日現在の役員）
        </p>
      )}
      {section.status === "ok" ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[22rem] text-sm" data-testid="officers-table">
            <thead className="border-b bg-surface text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  氏名
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  役職名
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {section.rows.map((officer) => (
                <tr key={officer.seq} data-seq={officer.seq}>
                  <td className="px-3 py-2 align-top whitespace-nowrap" data-testid="officer-name">
                    {officer.name}
                  </td>
                  <td className="px-3 py-2 align-top whitespace-pre-line" data-testid="officer-title">
                    {officer.title}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : section.status === "pending" ? (
        <SectionPending section={section} />
      ) : (
        <SectionFailure kind="officers" status={section.status} detail={section.detail} />
      )}
    </section>
  );
}

function Frame({ state, children }: { state: string; children: React.ReactNode }) {
  return (
    <section
      id="annual-report"
      aria-labelledby="annual-report-heading"
      className="scroll-mt-20 space-y-3 rounded-lg border bg-card p-4"
      data-testid="annual-report"
      data-state={state}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="annual-report-heading" className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
          <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
          大株主・役員（有価証券報告書）
        </h2>
        <p className="text-xs text-muted-foreground">EDINET の直近の有価証券報告書の記載</p>
      </div>
      {children}
    </section>
  );
}

export function AnnualReportSection({ row }: { row: AnnualReportRow | null }) {
  if (row === null) {
    return (
      <Frame state="not_fetched">
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed px-4 py-5" data-testid="annual-report-empty">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <CircleDashed aria-hidden="true" className="size-4 text-muted-foreground" />
            有価証券報告書が未取得です
          </p>
          <p className="text-xs text-muted-foreground">
            EDINET の取り込みがまだ行われていないか、この銘柄の有報が取り込み期間（直近 450 日）に提出されていません。
          </p>
          <Link href="/imports" className="inline-flex items-center gap-1 text-sm text-signal-strong underline-offset-2 hover:underline">
            取り込み状況を見る
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      </Frame>
    );
  }

  if (row.document.status === "pending") {
    return (
      <Frame state="pending">
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed px-4 py-5" data-testid="annual-report-pending">
          <p className="inline-flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <Hourglass aria-hidden="true" className="size-4 text-muted-foreground" />
            有価証券報告書（{row.document.doc_id}、{jstDateOf(row.document.submitted_at)} 提出）は取り込み待ちです
          </p>
          <p className="text-xs text-muted-foreground">次の EDINET の取り込みで、大株主と役員の状況が表示されます。</p>
          <EdinetLink docId={row.document.doc_id} className="text-sm" />
        </div>
      </Frame>
    );
  }

  const failed = (status: SectionStatus) => status !== "ok" && status !== "pending";
  const bothFailed = failed(row.shareholders.status) && failed(row.officers.status);
  return (
    <Frame state="fetched">
      <SourceDocument row={row} />
      {bothFailed && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive-strong" data-testid="annual-report-failed">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          有報から大株主／役員情報を抽出できませんでした
        </p>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Shareholders row={row} />
        <Officers row={row} />
      </div>
    </Frame>
  );
}
