import { formatCount } from "@/lib/format";

import type { RunStatus, RunTarget } from "./runs";

type RunForMessage = {
  target: RunTarget;
  status: RunStatus;
  processedCount: number;
  errorMessage: string | null;
  /** 実行履歴の details（株価の取り込みでは noPriceData、財務では datesFetched を使う）。 */
  details?: unknown;
};

function detailCount(details: unknown, key: string): number {
  const value = (details as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && value > 0 ? value : 0;
}

/** 有報の抽出の内訳（大株主・役員とも抽出できた書類の数と、どちらかを抽出できなかった書類の数）。 */
function edinetExtractionNote(details: unknown): string {
  const both = detailCount(details, "documentsBothExtracted");
  const failed = detailCount(details, "documentsNotExtracted");
  if (both + failed === 0) return "";
  return `（大株主・役員の抽出 ${formatCount(both)} 件、抽出できず ${formatCount(failed)} 件）`;
}

function savedText(run: RunForMessage): string {
  switch (run.target) {
    case "daily_quotes":
      return `${formatCount(run.processedCount)} 銘柄の初出日を保存しました`;
    case "financials":
      return `通期決算 ${formatCount(run.processedCount)} 件を保存しました`;
    case "edinet_reports":
      return `書類 ${formatCount(run.processedCount)} 件を処理しました${edinetExtractionNote(run.details)}`;
    default:
      return `${formatCount(run.processedCount)} 件を保存しました`;
  }
}

/** 「今すぐ取り込み」の結果の文言（ボタンの近くの role="status" に表示する）。 */
export function formatRunResult(run: RunForMessage): string {
  switch (run.status) {
    case "running":
      return "実行中…";
    case "succeeded": {
      if (run.target === "daily_quotes") {
        const missing = detailCount(run.details, "noPriceData");
        const note = missing > 0 ? `（株価データがまだ無い銘柄: ${formatCount(missing)}）` : "";
        if (run.processedCount === 0 && missing === 0) {
          return "成功: 新たに初出日を保存した銘柄はありません（すべて確定済み）";
        }
        return `成功: ${savedText(run)}${note}`;
      }
      if (run.target === "edinet_reports") {
        const dates = formatCount(detailCount(run.details, "listDatesFetched"));
        if (run.processedCount === 0) return `成功: 新しい有報はありません（書類一覧 ${dates} 日分を確認）`;
        return `成功: ${savedText(run)}（書類一覧 ${dates} 日分を取得）`;
      }
      if (run.target === "financials") {
        const dates = formatCount(detailCount(run.details, "datesFetched"));
        if (run.processedCount === 0) return `成功: 新しい通期決算はありません（開示日 ${dates} 日分を確認）`;
        return `成功: ${savedText(run)}（開示日 ${dates} 日分を取得）`;
      }
      return `成功: ${savedText(run)}`;
    }
    case "partial":
      return `一部失敗: ${savedText(run)}${run.errorMessage ? `（${run.errorMessage}）` : ""}`;
    case "failed":
      return `失敗: ${run.errorMessage ?? "原因不明のエラー"}`;
  }
}
