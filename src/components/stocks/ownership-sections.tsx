import { ArrowRight, CircleHelp, ExternalLink, Hourglass, Info } from "lucide-react";
import Link from "next/link";

import { AutoJudgmentLabel, CategoryLegendItem, EstimatedLabel, OwnershipBar } from "@/components/ownership/ownership-bar";
import {
  AUTO_JUDGMENT_NOTE,
  CATEGORY_SHORT_LABELS,
  categoryTotals,
  compactName,
  ESTIMATION_NOTE,
  formatTruncPct,
  holderReasonText,
  inlineTitle,
  isEstimatedCategory,
  OWNER_RESULT_LABELS,
  ownerConditionText,
  presidentBasisNote,
  topHolderName,
  undeterminableReasonText,
  type Holder,
  type OwnerCategory,
  type OwnershipDetail,
  type OwnershipDocument,
  type President,
} from "@/lib/ownership/display";
import type { ScreeningConditions } from "@/lib/screening/params";
import { docTypeLabel, edinetViewerUrl, formatRatioPct, jstDateOf } from "@/lib/stocks/annual-report";
import { cn } from "@/lib/utils";

/**
 * 銘柄詳細の「条件④ 判定根拠」と「保有状態の内訳」（Sprint 10。AC9.7・AC9.13〜AC9.15）。
 * 値はすべて DB（stock_detail の ownership。分類・合計・判定は DB の1か所）で、ここでは表示だけを行う。
 */

function resultTone(result: OwnershipDetail["result"]) {
  if (result === "president_top" || result === "owner_company") return "bg-signal-muted text-signal-strong";
  if (result === "undeterminable") return "bg-caution-muted text-caution-strong";
  return "bg-muted text-foreground";
}

function CategoryBadge({ category }: { category: OwnerCategory }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" data-testid="breakdown-category-label">
      <span>{CATEGORY_SHORT_LABELS[category]}</span>
      {isEstimatedCategory(category) && <EstimatedLabel />}
    </span>
  );
}

function DocumentLink({ docId }: { docId: string }) {
  return (
    <a
      href={edinetViewerUrl(docId)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-signal-strong underline-offset-2 hover:underline"
      data-testid="evidence-edinet-link"
    >
      EDINET で開く
      <ExternalLink aria-hidden="true" className="size-3.5" />
      <span className="sr-only">（新しいタブで開きます）</span>
    </a>
  );
}

function DocumentRow({ label, document }: { label: string; document: OwnershipDocument }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="evidence-document" data-doc-id={document.doc_id} data-role={document.role}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular rounded-sm border bg-background px-1.5 py-0.5 font-mono text-xs">{document.doc_id}</span>
      <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs">{docTypeLabel(document.doc_type_code)}</span>
      <span className="tabular font-mono text-xs">{jstDateOf(document.submitted_at)} 提出</span>
      <DocumentLink docId={document.doc_id} />
    </li>
  );
}

function Documents({ ownership }: { ownership: OwnershipDetail }) {
  const byRole = (role: OwnershipDocument["role"]) => ownership.documents.find((d) => d.role === role);
  const shareholders = byRole("shareholders");
  const officers = byRole("officers");
  const rows: { label: string; document: OwnershipDocument }[] = [];
  if (shareholders && officers && shareholders.doc_id === officers.doc_id) rows.push({ label: "大株主・役員", document: shareholders });
  else {
    if (shareholders) rows.push({ label: "大株主", document: shareholders });
    if (officers) rows.push({ label: "役員", document: officers });
  }
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="evidence-documents">
      <h3 className="text-xs font-medium text-muted-foreground">使った有報</h3>
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <DocumentRow key={row.label} label={row.label} document={row.document} />
        ))}
      </ul>
    </div>
  );
}

function PendingNote({ ownership }: { ownership: OwnershipDetail }) {
  const pending = ownership.documents.find((d) => d.role === "shareholders_pending") ?? ownership.documents.find((d) => d.role === "officers_pending");
  const used = ownership.documents.find((d) => d.role === (pending?.role === "officers_pending" ? "officers" : "shareholders"));
  if (!pending || ownership.status !== "determined") return null;
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-info-muted px-2.5 py-2 text-xs text-info-strong" data-testid="evidence-pending-note">
      <Hourglass aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        新しい有報（<span className="tabular font-mono">{pending.doc_id}</span>、
        <span className="tabular font-mono">{jstDateOf(pending.submitted_at)}</span> 提出）は取り込み待ちです。処理済みの直前の有報
        {used && (
          <>
            （<span className="tabular font-mono">{used.doc_id}</span>）
          </>
        )}
        で判定しています。
      </span>
    </p>
  );
}

function presidentOfTop(ownership: OwnershipDetail): President | null {
  const top = ownership.top_holders[0];
  if (!top) return null;
  const holder = ownership.holders.find((h) => h.rank === top.rank);
  if (holder?.category === "president" && holder.reason.president_name) {
    return ownership.presidents.find((p) => p.name === holder.reason.president_name) ?? ownership.presidents[0] ?? null;
  }
  return ownership.presidents[0] ?? null;
}

function SummaryLine({ ownership }: { ownership: OwnershipDetail }) {
  const top = ownership.top_holders[0];
  const president = presidentOfTop(ownership);
  if (!top || !president) return null;
  const same = ownership.president_is_top_holder === true;
  return (
    <p className="rounded-md border bg-surface px-3 py-2 text-sm" data-testid="evidence-summary" data-match={same}>
      <span className="text-muted-foreground">筆頭株主: </span>
      {topHolderName(ownership.top_holders)} <span className="tabular font-mono">{formatRatioPct(top.ratio_pct, top.ratio_decimals)}</span>
      <span className={cn("mx-2 font-semibold", same ? "text-signal-strong" : "text-muted-foreground")} aria-label={same ? "一致" : "不一致"}>
        {same ? "＝" : "≠"}
      </span>
      <span className="text-muted-foreground">{inlineTitle(president.title)}: </span>
      {compactName(president.name)}
    </p>
  );
}

function Presidents({ presidents }: { presidents: President[] }) {
  return (
    <div className="space-y-1" data-testid="evidence-presidents">
      <h3 className="text-xs font-medium text-muted-foreground">社長{presidents.length > 1 ? `（${presidents.length}名）` : ""}</h3>
      <ul className="space-y-1 text-sm">
        {presidents.map((p) => {
          const note = presidentBasisNote(p.basis);
          return (
            <li key={p.seq} data-testid="evidence-president" data-basis={p.basis}>
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 text-muted-foreground">{inlineTitle(p.title)}</span>
              <span className="ml-2 text-xs text-muted-foreground" data-testid="evidence-surname">
                {p.surname ? `姓: ${compactName(p.surname)}` : ""}
              </span>
              {!p.surname && (
                <span className="block text-xs text-caution-strong" data-testid="evidence-surname-unknown">
                  社長『{compactName(p.name)}』の姓を特定できないため、同姓の推定と、姓・読みによる資産管理会社の推定を行っていません
                </span>
              )}
              {note && (
                <span className="block text-xs text-caution-strong" data-testid="evidence-basis-note">
                  {note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Matches({ holders }: { holders: Holder[] }) {
  const matched = holders.filter((h) => h.category !== "other");
  return (
    <div className="space-y-1" data-testid="evidence-matches">
      <h3 className="text-xs font-medium text-muted-foreground">一致した株主と一致理由</h3>
      {matched.length === 0 ? (
        <p className="text-sm text-muted-foreground">一致した株主はいません（大株主上位に社長・役員・その関係者と推定される株主がいません）</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {matched.map((h) => (
            <li key={h.rank} className="space-y-0.5 px-3 py-2" data-testid="evidence-match" data-category={h.category}>
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">{h.name}</span>
                <span className="tabular font-mono">{formatRatioPct(h.ratio_pct, h.ratio_decimals)}</span>
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <CategoryBadge category={h.category} />
                <span className="text-muted-foreground">{holderReasonText(h)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OwnershipEvidence({ ownership, conditions }: { ownership: OwnershipDetail; conditions: ScreeningConditions }) {
  const top = ownership.top_holders[0];
  const off = conditions.off.includes("owner");
  return (
    <section
      id="ownership-evidence"
      aria-labelledby="ownership-evidence-heading"
      className="scroll-mt-20 space-y-3 rounded-lg border bg-card p-4"
      data-testid="ownership-evidence"
      data-result={ownership.result}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="ownership-evidence-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          条件④ 判定根拠
          <AutoJudgmentLabel />
        </h2>
        <p className="text-xs text-muted-foreground">
          条件: {ownerConditionText(conditions.ownerMode, conditions.owner)}
          {off && "（スクリーニングではオフ）"}
        </p>
      </div>

      <p className={cn("inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-medium", resultTone(ownership.result))} data-testid="evidence-result">
        {ownership.result === "undeterminable" && <CircleHelp aria-hidden="true" className="size-4" />}
        {OWNER_RESULT_LABELS[ownership.result]}
      </p>

      {ownership.status === "undeterminable" ? (
        <div className="space-y-2">
          <p className="text-sm text-caution-strong" data-testid="evidence-undeterminable">
            {undeterminableReasonText(ownership)}
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href="#annual-report" className="inline-flex items-center gap-1 text-signal-strong underline-offset-2 hover:underline">
              有報の大株主・役員を見る
            </a>
            <Link href="/imports" className="inline-flex items-center gap-1 text-signal-strong underline-offset-2 hover:underline">
              取り込み状況を見る
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </p>
        </div>
      ) : (
        <>
          <SummaryLine ownership={ownership} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1" data-testid="evidence-top-holder">
              <h3 className="text-xs font-medium text-muted-foreground">筆頭株主</h3>
              {top && (
                <p className="text-sm">
                  <span className="font-medium">{topHolderName(ownership.top_holders)}</span>
                  <span className="tabular ml-2 font-mono">{formatRatioPct(top.ratio_pct, top.ratio_decimals)}</span>
                  <span className="ml-2 text-xs">
                    <CategoryBadge category={top.category} />
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-1" data-testid="evidence-owner-total">
              <h3 className="text-xs font-medium text-muted-foreground">オーナー系合計比率</h3>
              <p className="text-sm">
                <span className="tabular font-mono font-medium">{formatTruncPct(ownership.owner_total_pct ?? "0")}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {conditions.ownerMode === "president" ? "（『社長が筆頭株主のみ』では閾値を使いません）" : `閾値 ${conditions.owner}%`}
                </span>
              </p>
            </div>
          </div>
          <Presidents presidents={ownership.presidents} />
          <Matches holders={ownership.holders} />
        </>
      )}

      <PendingNote ownership={ownership} />
      <Documents ownership={ownership} />
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {AUTO_JUDGMENT_NOTE}
      </p>
    </section>
  );
}

export function OwnershipBreakdown({ ownership }: { ownership: OwnershipDetail }) {
  const totals = categoryTotals(ownership);
  return (
    <section aria-labelledby="ownership-breakdown-heading" className="space-y-3 rounded-lg border bg-card p-4" data-testid="ownership-breakdown">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="ownership-breakdown-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          保有状態の内訳
          <AutoJudgmentLabel />
        </h2>
        <p className="text-xs text-muted-foreground">持株比率は、有報の『発行済株式（自己株式を除く）の総数に対する所有株式数の割合』</p>
      </div>

      {ownership.status === "undeterminable" || !totals || !ownership.category_pct || ownership.owner_total_pct === null ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground" data-testid="breakdown-undeterminable">
          内訳なし（判定不能）— {undeterminableReasonText(ownership)}
        </p>
      ) : (
        <>
          <div className="space-y-2" data-testid="breakdown-totals">
            <OwnershipBar pct={ownership.category_pct} ownerTotal={ownership.owner_total_pct} className="h-3" testId="breakdown-bar" />
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {totals.map((row) => (
                <li
                  key={row.key}
                  className={cn("flex items-center justify-between gap-3 border-b border-dashed py-0.5", row.key === "owner_total" && "font-semibold")}
                  data-testid="breakdown-total"
                  data-category={row.key}
                >
                  {row.key === "owner_total" ? (
                    <span>オーナー系合計</span>
                  ) : (
                    <CategoryLegendItem category={row.key} label="badge" />
                  )}
                  <span className="tabular font-mono">{formatTruncPct(row.value)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm" data-testid="breakdown-holders">
              <thead className="border-b bg-surface text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-2 py-2 text-right font-medium whitespace-nowrap sm:w-12 sm:px-3">
                    順位
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium sm:px-3">
                    氏名・名称
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap sm:px-3">
                    持株比率
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium whitespace-nowrap sm:px-3">
                    区分
                  </th>
                  <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                    分類理由
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ownership.holders.map((h) => (
                  <tr key={h.rank} data-testid="breakdown-holder" data-rank={h.rank} data-category={h.category}>
                    <td className="tabular px-2 py-2 text-right align-top font-mono sm:px-3">{h.rank}</td>
                    <td className="px-2 py-2 align-top break-words sm:px-3" data-testid="breakdown-name">
                      {h.name}
                    </td>
                    <td className="tabular px-2 py-2 text-right align-top font-mono whitespace-nowrap sm:px-3" data-testid="breakdown-ratio" data-ratio-pct={h.ratio_pct}>
                      {formatRatioPct(h.ratio_pct, h.ratio_decimals)}
                    </td>
                    <td className="px-2 py-2 align-top text-xs sm:px-3" data-testid="breakdown-category">
                      <CategoryBadge category={h.category} />
                      <span className="mt-0.5 block text-muted-foreground sm:hidden">{holderReasonText(h)}</span>
                    </td>
                    <td className="hidden px-3 py-2 align-top text-xs text-muted-foreground sm:table-cell" data-testid="breakdown-reason">
                      {holderReasonText(h)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="flex items-start gap-1.5 rounded-md bg-caution-muted px-2.5 py-2 text-xs leading-relaxed text-caution-strong" data-testid="estimation-note">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {ESTIMATION_NOTE}
      </p>
    </section>
  );
}
