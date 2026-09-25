/**
 * 取り込みで失敗した対象（契約 sprint-12 の第2章の2）。DB（ingestion_run_failures）には理由のコードだけを保存し、
 * 画面・API の文言はこのファイルの1か所で作る。外部 API の応答の本文・URL・キーは扱わない。
 * 画面（サーバー）と取り込みの両方から使うので server-only にしない。
 */

export const FAILURE_ITEM_TYPES = ["stock", "disclosure_date", "list_date", "document"] as const;
export type FailureItemType = (typeof FAILURE_ITEM_TYPES)[number];

export const FAILURE_REASONS = [
  "http_error",
  "not_found",
  "unreachable",
  "invalid_format",
  "row_mismatch",
  "pdf_returned",
  "invalid_archive",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export type NetworkErrorKind = "timeout" | "network";

export type FailureRecord = {
  itemType: FailureItemType;
  itemKey: string;
  code: string | null;
  reason: FailureReason;
  httpStatus: number | null;
  networkError: NetworkErrorKind | null;
};

/** 1回の実行で保存する失敗の行の上限（failed_count は全数）。 */
export const FAILURE_ROWS_LIMIT = 1_000;

/** 失敗の記録（上限を超えた分は数えるだけ）。 */
export class FailureLog {
  readonly records: FailureRecord[] = [];
  total = 0;
  private readonly keys = new Set<string>();

  add(record: FailureRecord): void {
    const key = `${record.itemType}:${record.itemKey}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.total += 1;
    if (this.records.length < FAILURE_ROWS_LIMIT) this.records.push(record);
  }
}

export const FAILURE_ITEM_LABELS: Record<FailureItemType, string> = {
  stock: "銘柄",
  disclosure_date: "開示日",
  list_date: "書類一覧の日",
  document: "書類",
};

/** 接続の失敗の説明（describeNetworkError の文字列）を種類にする。 */
export function networkErrorKind(reason: string): NetworkErrorKind {
  return reason === "タイムアウト" ? "timeout" : "network";
}

const NETWORK_LABELS: Record<NetworkErrorKind, string> = { timeout: "タイムアウト", network: "ネットワークエラー" };

/** 失敗の文言（画面と API で共通）。 */
export function failureMessage(failure: {
  itemType: FailureItemType;
  reason: FailureReason;
  httpStatus: number | null;
  networkError: NetworkErrorKind | null;
}): string {
  const source = failure.itemType === "stock" || failure.itemType === "disclosure_date" ? "J-Quants" : "EDINET";
  const status = failure.httpStatus === null ? "" : `（HTTP ${failure.httpStatus}）`;
  switch (failure.reason) {
    case "http_error":
    case "not_found":
      if (failure.itemType === "document") return `EDINET から書類を取得できませんでした${status}`;
      return `${source} から予期しない応答がありました${status}`;
    case "unreachable":
      return `${source} に接続できませんでした（${NETWORK_LABELS[failure.networkError ?? "network"]}）`;
    case "invalid_format":
      return "応答の形式が想定と異なります";
    case "row_mismatch":
      return "応答に別の銘柄の行が含まれていました";
    case "pdf_returned":
      return "PDF の応答（不開示の書類など）";
    case "invalid_archive":
      return "ZIP を読めませんでした";
  }
}
