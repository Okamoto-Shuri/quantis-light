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
  jquantsUnexpectedStatus: (status: number) => `J-Quants から予期しない応答がありました（HTTP ${status}）`,
  jquantsUnreachable: (reason: string) => `J-Quants に接続できませんでした（${reason}）`,
  jquantsInvalidFormat: "J-Quants の応答の形式が想定と異なります",
  jquantsNoTargets: "J-Quants から取り込み対象の銘柄が1件も返りませんでした",
  saveFailed: "銘柄マスタの保存に失敗しました",
  unexpected: "予期しないエラーで取り込みを完了できませんでした",
} as const;
