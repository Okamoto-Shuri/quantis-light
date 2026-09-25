"use client";

import { fiscalPeriodLabel, mixedBasisNotes, sourceLabel, type PeriodSourceEntry } from "@/lib/financials/display";

import { HoverPopover } from "./hover-popover";

/**
 * 売上CAGR の「補完」の印（AC15.3）。CAGR の算出に EDINET から補った期を含む行にだけ出す。
 * マウスを乗せる、またはクリック（Enter・Space）で、どの期をどの書類から補ったかを示す。
 * 行のクリック（銘柄詳細へ移る）に伝わらないよう、印とポップオーバーの中のイベントは止める（HoverPopover）。
 * 内容は表示中の結果の行（サーバーの応答）から作る。
 */
export function SupplementMark({
  supplement,
  mixedConsolidation,
  mixedStandard,
}: {
  supplement: readonly PeriodSourceEntry[];
  mixedConsolidation: boolean;
  mixedStandard: boolean;
}) {
  const periods = [...supplement].sort((a, b) => (a.fiscal_year_end < b.fiscal_year_end ? -1 : 1));
  const notes = mixedBasisNotes({ revenue_cagr_mixed_consolidation: mixedConsolidation, revenue_cagr_mixed_standard: mixedStandard });

  return (
    <HoverPopover
      ariaLabel="補完あり: EDINET から補った期を表示"
      testId="cagr-supplement-mark"
      contentTestId="cagr-supplement-detail"
      triggerClassName="ml-1 inline-flex h-4 items-center rounded-sm border border-info/40 bg-info-muted px-1 align-middle text-[0.6rem] leading-none font-medium whitespace-nowrap text-info-strong not-italic hover:border-info"
      trigger="補完"
    >
      <p className="font-medium">補完あり（EDINET から補った期）</p>
      <ul className="space-y-0.5">
        {periods.map((p) => (
          <li key={p.fiscal_year_end} data-testid="cagr-supplement-period" data-fiscal-year-end={p.fiscal_year_end}>
            <span className="tabular font-mono">{fiscalPeriodLabel(p.fiscal_year_end)}</span> {sourceLabel(p.source)}{" "}
            <span className="tabular font-mono">{p.document_id}</span>（<span className="tabular font-mono">{p.document_date}</span> 提出）
          </li>
        ))}
      </ul>
      {notes.map((note) => (
        <p key={note.key} className="text-caution-strong" data-testid={`cagr-supplement-mixed-${note.key}`}>
          {note.text}
        </p>
      ))}
      <p className="text-muted-foreground">決算短信に無い期を、有価証券報告書・届出書の「主要な経営指標等の推移」から補っています。</p>
    </HoverPopover>
  );
}
