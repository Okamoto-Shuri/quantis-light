import { formatCount } from "@/lib/format";

import type { RunStatus, RunTarget } from "./runs";

type RunForMessage = {
  target: RunTarget;
  status: RunStatus;
  processedCount: number;
  errorMessage: string | null;
  /** 実行履歴の details（株価の取り込みでは noPriceData を使う）。 */
  details?: unknown;
};

function noPriceData(details: unknown): number {
  const value = (details as { noPriceData?: unknown } | null | undefined)?.noPriceData;
  return typeof value === "number" && value > 0 ? value : 0;
}

/** 「今すぐ取り込み」の結果の文言（ボタンの近くの role="status" に表示する）。 */
export function formatRunResult(run: RunForMessage): string {
  const quotes = run.target === "daily_quotes";
  switch (run.status) {
    case "running":
      return "実行中…";
    case "succeeded": {
      if (!quotes) return `成功: ${formatCount(run.processedCount)} 件を保存しました`;
      const missing = noPriceData(run.details);
      const note = missing > 0 ? `（株価データがまだ無い銘柄: ${formatCount(missing)}）` : "";
      if (run.processedCount === 0 && missing === 0) {
        return "成功: 新たに初出日を保存した銘柄はありません（すべて確定済み）";
      }
      return `成功: ${formatCount(run.processedCount)} 銘柄の初出日を保存しました${note}`;
    }
    case "partial": {
      const saved = quotes
        ? `${formatCount(run.processedCount)} 銘柄の初出日を保存しました`
        : `${formatCount(run.processedCount)} 件を保存しました`;
      return `一部失敗: ${saved}${run.errorMessage ? `（${run.errorMessage}）` : ""}`;
    }
    case "failed":
      return `失敗: ${run.errorMessage ?? "原因不明のエラー"}`;
  }
}
