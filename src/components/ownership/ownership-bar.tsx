import {
  CATEGORY_LABELS,
  CATEGORY_SHORT_LABELS,
  formatTruncPct,
  isEstimatedCategory,
  OWNER_CATEGORIES,
  type CategoryPct,
  type OwnerCategory,
} from "@/lib/ownership/display";
import { cn } from "@/lib/utils";

/**
 * 保有状態の内訳の小さな積み上げバーと凡例（Sprint 10。一覧の要約と詳細の区分別の合計で共有する）。
 * フックを使わない部品なので、サーバーからもクライアントからも使える。
 * バーは 0〜100% の目盛り。区分1〜4を色分けし、オーナー系以外は淡いグレー、残り（大株主の外）は空ける。
 * 区分どうしは1px の隙間で区切る。色だけに頼らず、role="img" と内訳を読み上げる aria-label を付ける。
 */

export const CATEGORY_SWATCH: Record<OwnerCategory, string> = {
  president: "bg-owner-president",
  officer: "bg-owner-officer",
  family: "bg-owner-family",
  asset_company: "bg-owner-asset",
  other: "bg-owner-other",
};

/** 幅（%）。十進の文字列を数にするのは表示の幅だけ（値の表示には使わない） */
function width(value: string): number {
  return Math.max(0, Math.min(100, Number(value)));
}

export function barAriaLabel(pct: CategoryPct, ownerTotal: string): string {
  const parts = OWNER_CATEGORIES.map((category) => `${CATEGORY_LABELS[category]} ${formatTruncPct(pct[category])}`);
  return `保有状態の内訳: オーナー系合計 ${formatTruncPct(ownerTotal)}（${parts.join("、")}）`;
}

export function OwnershipBar({
  pct,
  ownerTotal,
  className,
  testId = "ownership-bar",
}: {
  pct: CategoryPct;
  ownerTotal: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      role="img"
      aria-label={barAriaLabel(pct, ownerTotal)}
      className={cn("flex h-2 w-full overflow-hidden rounded-[2px] bg-muted ring-1 ring-border ring-inset", className)}
      data-testid={testId}
    >
      {OWNER_CATEGORIES.map((category) => {
        const w = width(pct[category]);
        if (w <= 0) return null;
        return (
          <span
            key={category}
            className={cn("h-full shrink-0 border-r border-card last:border-r-0", CATEGORY_SWATCH[category])}
            style={{ width: `${w}%` }}
            data-category={category}
            data-width={pct[category]}
          />
        );
      })}
    </span>
  );
}

/**
 * 凡例の1行（色の見本・区分名）。value を渡すと右端に切り捨て1桁の比率を出す。
 * label が full なら「同姓の親族（推定）」の形、badge なら「同姓の親族」と「推定」のラベル。
 */
export function CategoryLegendItem({
  category,
  value,
  label = "full",
  className,
}: {
  category: OwnerCategory;
  value?: string;
  label?: "full" | "badge";
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1.5", className)} data-category={category}>
      <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-[2px]", CATEGORY_SWATCH[category])} />
      <span>{label === "full" ? CATEGORY_LABELS[category] : CATEGORY_SHORT_LABELS[category]}</span>
      {label === "badge" && isEstimatedCategory(category) && <EstimatedLabel />}
      {value !== undefined && <span className="tabular ml-auto pl-3 font-mono">{formatTruncPct(value)}</span>}
    </span>
  );
}

/** 「推定」のラベル（AC9.15） */
export function EstimatedLabel() {
  return (
    <span
      className="inline-flex h-4 items-center rounded-sm border border-caution/50 bg-caution-muted px-1 text-[0.6rem] leading-none font-medium whitespace-nowrap text-caution-strong"
      data-testid="estimated-label"
    >
      推定
    </span>
  );
}

/** 「自動判定」のラベル（デザインの方向性: ヒューリスティック判定には必ず付ける） */
export function AutoJudgmentLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center rounded-sm border border-info/40 bg-info-muted px-1 text-[0.6rem] leading-none font-medium whitespace-nowrap text-info-strong",
        className,
      )}
      data-testid="auto-judgment-label"
    >
      自動判定
    </span>
  );
}
