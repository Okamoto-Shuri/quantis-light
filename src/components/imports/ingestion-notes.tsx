import { Info, LoaderCircle } from "lucide-react";

import { formatDateTimeJst } from "@/lib/format";
import { formatRemainingShort, RUN_TARGET_LABELS, type RemainingUnit, type RunTarget } from "@/lib/ingestion/runs";

/**
 * 取り込み中の検索の注記（AC11.5。契約 sprint-12 の第2章の5）。
 * - 実行中の注記: 銘柄ごとの値は1回の保存でそろって変わり、途中の状態は見えない。保存が済んだ銘柄から順に反映される。
 * - 未取得の残りの注記: target ごとの最新の終了済みの実行に残りがあれば、その件数（初回の取り込みの期間にも伝わるように）。
 */
export function IngestionRunningNote({ run }: { run: { target: RunTarget; started_at: string } }) {
  const time = formatDateTimeJst(run.started_at)?.slice(11) ?? "";
  return (
    <p
      className="flex items-start gap-2 rounded-md border border-info/30 bg-info-muted px-3 py-2 text-sm text-info-strong"
      data-testid="ingestion-running-note"
    >
      <LoaderCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      <span>
        取り込みを実行中です（{RUN_TARGET_LABELS[run.target]}・<span className="tabular font-mono">{time}</span> 開始）。
        保存が済んだ銘柄から順に新しいデータが反映されます。1つの銘柄の値が途中まで更新された状態で表示されることはありません。
      </span>
    </p>
  );
}

export function IngestionRemainingNote({
  remaining,
}: {
  remaining: { target: RunTarget; count: number; unit: RemainingUnit }[];
}) {
  if (remaining.length === 0) return null;
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="ingestion-remaining-note">
      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        未取得の残りがあります（{remaining.map((r) => formatRemainingShort(r.target, r.count, r.unit)).join("・")}
        ）。残りは次回以降の取り込みで処理します。
      </span>
    </p>
  );
}
