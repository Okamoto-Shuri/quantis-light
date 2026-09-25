import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 既定のプリセットの注記（Sprint 14。Sprint 13 評価の m3）: 無効な項目がある・正規形でないときに、どう判定したかを示す。
 * ダッシュボード・ウォッチリスト・銘柄詳細（条件のパラメータなし）で共有する。フックを使わないので server からも使える。
 */
export function DefaultPresetNote({ note, size = "sm", testId = "default-preset-invalid-note" }: { note: string | null; size?: "xs" | "sm"; testId?: string }) {
  if (!note) return null;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border border-caution/40 bg-caution-muted px-3 py-2 text-caution-strong",
        size === "xs" ? "text-xs" : "text-sm",
      )}
      data-testid={testId}
    >
      <CircleAlert aria-hidden="true" className={cn("mt-0.5 shrink-0", size === "xs" ? "size-3.5" : "size-4")} />
      {note}
    </p>
  );
}
