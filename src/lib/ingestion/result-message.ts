import { formatCount } from "@/lib/format";

import type { RunStatus } from "./runs";

/** 「今すぐ取り込み」の結果の文言（ボタンの近くの role="status" に表示する）。 */
export function formatRunResult(run: {
  status: RunStatus;
  processedCount: number;
  errorMessage: string | null;
}): string {
  switch (run.status) {
    case "running":
      return "実行中…";
    case "succeeded":
      return `成功: ${formatCount(run.processedCount)} 件を保存しました`;
    case "partial":
      return `一部失敗: ${formatCount(run.processedCount)} 件を保存しました${run.errorMessage ? `（${run.errorMessage}）` : ""}`;
    case "failed":
      return `失敗: ${run.errorMessage ?? "原因不明のエラー"}`;
  }
}
