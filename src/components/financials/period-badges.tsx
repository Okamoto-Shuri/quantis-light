import { FileStack, Shuffle } from "lucide-react";

import { Hint } from "@/components/shell/hint";

/** 変則決算の期の印（「変則決算（9か月）」）。取り込み状況のカードと銘柄詳細で共有する。 */
export function IrregularBadge({ months }: { months: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm bg-caution-muted px-1.5 py-0.5 text-xs whitespace-nowrap text-caution-strong"
      data-testid="irregular-badge"
    >
      <Shuffle aria-hidden="true" className="size-3" />
      変則決算（{months}か月）
    </span>
  );
}

/**
 * 同じ期に複数の開示がある期の印。件数は元の開示を含むので「開示2件（訂正あり）」と書き、ツールチップで補う
 * （「訂正あり（2件）」だと訂正が2回あったと読めるため。Sprint 7 契約レビューの推奨）。
 */
export function DisclosureCountBadge({ count, kind = "disclosure" }: { count: number; kind?: "disclosure" | "document" }) {
  if (count <= 1) return null;
  const noun = kind === "document" ? "書類" : "開示";
  const hint = `元の${noun}と訂正を合わせて${count}件。最新の${noun}の値を表示しています`;
  return (
    <Hint text={hint}>
      <span
        // フォーカスでも補足を開けるように（キーボード・読み上げ）。Tooltip は開いている間 aria-describedby を付ける
        tabIndex={0}
        className="inline-flex cursor-help items-center gap-1 rounded-sm text-xs whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        data-testid="corrected-badge"
      >
        <FileStack aria-hidden="true" className="size-3" />
        {noun}
        {count}件（訂正あり）
      </span>
    </Hint>
  );
}
