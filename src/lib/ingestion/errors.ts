/**
 * 取り込みの失敗。message はそのまま実行履歴と画面に出す日本語の説明で、
 * キーの値や外部 API の応答本文（市場データ）を含めてはいけない。
 */
export class IngestionFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionFailure";
  }
}

export const INGESTION_MESSAGES = {
  jquantsKeyMissing: "J-Quants の API キーが設定されていません",
  jquantsUnauthorized: (status: number) => `J-Quants の API キーが無効か、契約プランでは利用できません（HTTP ${status}）`,
  jquantsRateLimited: "J-Quants の呼び出し回数の上限に達しました（HTTP 429）。しばらくしてから再実行してください",
  jquantsRateLimitedRetriesExhausted: (retries: number) =>
    `J-Quants の呼び出し回数の上限に達しました（HTTP 429）。${retries} 回待って再試行しましたが解消しなかったため中断しました`,
  jquantsRateLimitedDeadline:
    "J-Quants の呼び出し回数の上限に達しました（HTTP 429）。待ち時間が取り込みの時間の上限を超えるため中断しました",
  pricesConsecutiveFailures: (count: number, lastResponse: string) =>
    `株価の取得に${count}回続けて失敗したため中断しました（最後の応答は ${lastResponse}）`,
  jquantsUnexpectedStatus: (status: number) => `J-Quants から予期しない応答がありました（HTTP ${status}）`,
  jquantsUnreachable: (reason: string) => `J-Quants に接続できませんでした（${reason}）`,
  jquantsInvalidFormat: "J-Quants の応答の形式が想定と異なります",
  jquantsNoTargets: "J-Quants から取り込み対象の銘柄が1件も返りませんでした",
  saveFailed: "銘柄マスタの保存に失敗しました",
  stockMasterTimeBudget: "時間の上限に達したため、銘柄マスタを取得できませんでした",
  unexpected: "予期しないエラーで取り込みを完了できませんでした",
  stockMasterEmpty: "銘柄マスタが未取り込みのため、株価の初出日を取り込めません。先に銘柄マスタを取り込んでください",
  dataStartNotFound: (days: number, lastResponse: string) =>
    `株価データの取得可能期間の開始日を特定できませんでした（${days} 日分を試し、最後の応答は ${lastResponse}）`,
  timeBudgetExceeded: (remaining: number) =>
    `時間内に処理しきれなかったため、残り ${remaining.toLocaleString("ja-JP")} 銘柄は次回の取り込みで処理します`,
  remainingNext: (remaining: number) => `残り ${remaining.toLocaleString("ja-JP")} 銘柄は次回の取り込みで処理します`,
  pricesFailed: (count: number) =>
    `${count.toLocaleString("ja-JP")} 銘柄で株価を取得できませんでした。次回の取り込みで再試行します`,
  listingDatesSaveFailed: "株価の初出日の保存に失敗しました",
  financialsStockMasterEmpty:
    "銘柄マスタが未取り込みのため、財務情報を取り込めません。先に銘柄マスタを取り込んでください",
  financialsTimeBudgetExceeded: (remaining: number) =>
    `時間内に処理しきれなかったため、残り ${remaining.toLocaleString("ja-JP")} 日分の開示日は次回の取り込みで処理します`,
  financialsRemainingNext: (remaining: number) =>
    `残り ${remaining.toLocaleString("ja-JP")} 日分の開示日は次回の取り込みで処理します`,
  financialsDatesFailed: (count: number) =>
    `${count.toLocaleString("ja-JP")} 日分の開示日で財務情報を取得できませんでした。次回の取り込みで再試行します`,
  financialsConsecutiveFailures: (count: number, lastResponse: string) =>
    `財務情報の取得に${count}回続けて失敗したため中断しました（最後の応答は ${lastResponse}）`,
  financialsInvalidRows: (count: number) =>
    `${count.toLocaleString("ja-JP")} 件の開示は形式が想定と異なるため保存しませんでした`,
  financialsSaveFailed: "財務情報の保存に失敗しました",
  // --- EDINET（Sprint 8）。URL・キー・応答の本文を含めない ---
  edinetKeyMissing: "EDINET の API キーが設定されていません",
  edinetUnauthorized: "EDINET の API キーが無効です（HTTP 401）",
  edinetRateLimited: (status: number) =>
    `EDINET の呼び出しが制限されました（HTTP ${status}）。しばらくしてから再実行してください`,
  edinetRateLimitedRetriesExhausted: (status: number, retries: number) =>
    `EDINET の呼び出しが制限されました（HTTP ${status}）。${retries} 回待って再試行しましたが解消しなかったため中断しました`,
  edinetRateLimitedDeadline: (status: number) =>
    `EDINET の呼び出しが制限されました（HTTP ${status}）。待ち時間が取り込みの時間の上限を超えるため中断しました`,
  edinetRedirect: "EDINET から予期しない応答がありました（リダイレクト）",
  edinetInvalidFormat: "EDINET の応答の形式が想定と異なります",
  edinetStockMasterEmpty: "銘柄マスタが未取り込みのため、EDINET の書類を取り込めません。先に銘柄マスタを取り込んでください",
  edinetListTimeBudgetExceeded: (remaining: number) =>
    `時間内に書類一覧を取得しきれなかったため、残り ${remaining.toLocaleString("ja-JP")} 日分は次回の取り込みで取得します`,
  edinetListRemainingNext: (remaining: number) =>
    `書類一覧の残り ${remaining.toLocaleString("ja-JP")} 日分は次回の取り込みで取得します`,
  edinetListDatesFailed: (count: number) =>
    `${count.toLocaleString("ja-JP")} 日分の書類一覧を取得できませんでした。次回の取り込みで再試行します`,
  edinetDocumentsTimeBudgetExceeded: (remaining: number) =>
    `時間内に処理しきれなかったため、残り ${remaining.toLocaleString("ja-JP")} 件の書類は次回の取り込みで処理します`,
  edinetDocumentsRemainingNext: (remaining: number) =>
    `残り ${remaining.toLocaleString("ja-JP")} 件の書類は次回の取り込みで処理します`,
  edinetDocumentsFailed: (count: number) =>
    `${count.toLocaleString("ja-JP")} 件の書類を取得できませんでした。次回の取り込みで再試行します`,
  edinetConsecutiveFailures: (count: number, lastResponse: string) =>
    `EDINET からの取得に${count}回続けて失敗したため中断しました（最後の応答は ${lastResponse}）`,
  edinetSaveFailed: "EDINET の書類の保存に失敗しました",
} as const;
