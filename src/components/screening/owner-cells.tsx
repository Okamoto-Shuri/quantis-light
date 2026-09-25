"use client";

import { CircleHelp, RefreshCw } from "lucide-react";

import { AutoJudgmentLabel, CategoryLegendItem, ManualOverrideLabel, OwnershipBar } from "@/components/ownership/ownership-bar";
import {
  formatJstDateTime,
  formatTruncPct,
  inlineTitle,
  OWNER_CATEGORIES,
  OVERRIDE_PRESIDENT_MODE_NOTE,
  OWNER_RESULT_LABELS,
  ownerConditionText,
  presidentBasisNote,
  topHolderName,
  undeterminableReasonText,
  type OwnershipSummary,
} from "@/lib/ownership/display";
import type { OwnerMode } from "@/lib/screening/params";
import { cn } from "@/lib/utils";

import { HoverPopover } from "./hover-popover";

/** 判定結果の見た目（該当 = アクセント、非該当 = グレー、判定不能 = 注意の色とアイコン） */
function resultTone(result: OwnershipSummary["result"]) {
  if (result === "president_top" || result === "owner_company") return "font-medium text-signal-strong";
  if (result === "undeterminable") return "text-caution-strong";
  return "text-muted-foreground";
}

function TopHolderLine({ ownership }: { ownership: OwnershipSummary }) {
  const name = topHolderName(ownership.top_holders);
  const first = ownership.top_holders[0];
  if (!name || !first) return null;
  return (
    <p data-testid="popover-top-holder">
      <span className="text-muted-foreground">筆頭株主 </span>
      {name} <span className="tabular font-mono">{formatTruncPct(first.ratio_pct)}</span>
    </p>
  );
}

/** 補正のメモの先頭（一覧のポップオーバー。120 コードポイント） */
function memoHead(memo: string): string {
  const chars = [...memo];
  return chars.length > 120 ? `${chars.slice(0, 120).join("")}…` : memo;
}

/**
 * 一覧の条件④（自動判定）のセル（AC9.6）。判定結果のラベルにマウスを乗せる、またはクリックで、
 * 筆頭株主の名前と比率、社長の名前と役職名を示す。
 * Sprint 11: 手動補正があれば、「手動補正」のラベルと補正後の判定、その下に小さく元の自動判定を出す（AC10.2）。
 * ポップオーバーの先頭に補正（メモの先頭・更新日・自動判定の更新の知らせ）を置き、その下に自動判定の内容を出す。
 */
export function OwnerJudgmentCell({
  ownership,
  mode,
  threshold,
}: {
  ownership: OwnershipSummary;
  mode: OwnerMode;
  threshold: string;
}) {
  const override = ownership.override;
  const label = OWNER_RESULT_LABELS[ownership.result];
  const autoLabel = OWNER_RESULT_LABELS[ownership.auto_result];
  const basisNote = ownership.presidents[0] ? presidentBasisNote(ownership.presidents[0].basis) : null;
  return (
    <HoverPopover
      ariaLabel={
        override
          ? `条件④（手動補正）: ${label}（自動判定: ${autoLabel}）。補正と根拠を表示`
          : `条件④（自動判定）: ${label}。根拠を表示`
      }
      testId="owner-judgment-trigger"
      contentTestId="owner-judgment-detail"
      align="start"
      triggerClassName="inline-flex flex-col items-start gap-0.5 rounded-sm text-left text-xs leading-snug"
      trigger={
        <>
          {override && <ManualOverrideLabel />}
          <span className={cn("inline-flex items-start gap-1 underline decoration-dotted underline-offset-2", resultTone(ownership.result))}>
            {ownership.result === "undeterminable" && <CircleHelp aria-hidden="true" className="mt-px size-3 shrink-0" />}
            <span data-testid="owner-judgment-label">{label}</span>
          </span>
          {override && (
            <span className="text-[0.65rem] text-muted-foreground" data-testid="owner-judgment-auto">
              自動: {autoLabel}
            </span>
          )}
        </>
      }
    >
      {override && (
        <div className="space-y-1 border-b pb-1.5" data-testid="owner-override-popover">
          <p className="flex items-center gap-1.5 font-medium">
            <ManualOverrideLabel />
            <span className={resultTone(ownership.result)}>{label}</span>
          </p>
          {mode === "president" && override.verdict === "owner_company" && (
            <p className="text-muted-foreground">{OVERRIDE_PRESIDENT_MODE_NOTE}</p>
          )}
          <p className="break-words whitespace-pre-line" data-testid="owner-override-popover-memo">
            {memoHead(override.memo)}
          </p>
          <p className="text-muted-foreground">
            更新 <span className="tabular font-mono">{formatJstDateTime(override.updated_at).slice(0, 10)}</span>
          </p>
          {override.auto_changed && (
            <p className="flex items-start gap-1 text-caution-strong" data-testid="owner-override-auto-changed-hint">
              <RefreshCw aria-hidden="true" className="mt-px size-3 shrink-0" />
              補正後に自動判定が更新されました（詳細で確認できます）
            </p>
          )}
        </div>
      )}
      <p className="flex items-center gap-1.5 font-medium">
        <AutoJudgmentLabel />
        <span className={resultTone(ownership.auto_result)}>{autoLabel}</span>
      </p>
      <p className="text-muted-foreground">条件: {ownerConditionText(mode, threshold)}</p>
      {ownership.status === "undeterminable" ? (
        <p className="text-caution-strong" data-testid="popover-undeterminable-reason">
          {undeterminableReasonText(ownership)}
        </p>
      ) : (
        <>
          <TopHolderLine ownership={ownership} />
          <div data-testid="popover-presidents">
            <span className="text-muted-foreground">社長 </span>
            {ownership.presidents.map((p, index) => (
              <span key={p.seq}>
                {index > 0 && "、"}
                {p.name}（{inlineTitle(p.title)}）
              </span>
            ))}
          </div>
          {basisNote && <p className="text-muted-foreground">{basisNote}</p>}
          {ownership.pending_doc_id && (
            <p className="text-muted-foreground">新しい有報（{ownership.pending_doc_id}）は取り込み待ちのため、直前の有報で判定しています</p>
          )}
        </>
      )}
      <p className="text-muted-foreground">根拠は銘柄詳細で確認できます。</p>
    </HoverPopover>
  );
}

/**
 * 一覧の保有状態の要約（AC9.10・AC9.11）。1行で積み上げバーと「オーナー系 35.0%」。
 * マウスを乗せる、またはクリックで、区分ごとの比率・オーナー系合計・筆頭株主・色の凡例を示す。
 */
export function OwnershipCell({ ownership }: { ownership: OwnershipSummary }) {
  if (ownership.status === "undeterminable" || !ownership.category_pct || ownership.owner_total_pct === null) {
    return (
      <span className="text-xs text-muted-foreground italic" data-testid="ownership-total" data-kind="undeterminable">
        内訳なし（判定不能）
      </span>
    );
  }
  const pct = ownership.category_pct;
  const total = ownership.owner_total_pct;
  return (
    <HoverPopover
      ariaLabel={`保有状態の内訳: オーナー系 ${formatTruncPct(total)}。内訳を表示`}
      testId="ownership-trigger"
      contentTestId="ownership-detail"
      triggerClassName="flex w-full items-center gap-2 rounded-sm text-left"
      trigger={
        <>
          <OwnershipBar pct={pct} ownerTotal={total} className="w-10 shrink-0" />
          <span className="tabular shrink-0 font-mono text-xs whitespace-nowrap" data-testid="ownership-total" data-value={total}>
            オーナー系 {formatTruncPct(total)}
          </span>
        </>
      }
    >
      <p className="font-medium">保有状態の内訳（大株主上位）</p>
      <OwnershipBar pct={pct} ownerTotal={total} testId="ownership-detail-bar" />
      <ul className="space-y-0.5" data-testid="ownership-detail-categories">
        {OWNER_CATEGORIES.filter((c) => c !== "other").map((category) => (
          <li key={category}>
            <CategoryLegendItem category={category} value={pct[category]} />
          </li>
        ))}
        <li className="flex items-center justify-between border-t pt-0.5 font-medium" data-category="owner_total">
          <span>オーナー系合計</span>
          <span className="tabular font-mono">{formatTruncPct(total)}</span>
        </li>
        <li>
          <CategoryLegendItem category="other" value={pct.other} />
        </li>
      </ul>
      <TopHolderLine ownership={ownership} />
      <p className="text-muted-foreground">推定の区分は姓の一致による推定です（自動判定）。</p>
    </HoverPopover>
  );
}
