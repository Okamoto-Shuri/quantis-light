import { codePointLength, trimWhitespace } from "@/lib/text/whitespace";

/**
 * ウォッチリストのメモの規則（Sprint 14。契約の第2章の2）。画面・API・DB（watchlist_items の check 制約とトリガー）で同じ定義。
 * - 空白の文字集合は Sprint 11・13 と同じ（lib/text/whitespace.ts。JavaScript の \s）
 * - 保存する値は前後の空白を除いた値。除いた後が空なら「メモなし」（NULL）
 * - 前後の空白を除いた後の値で数えて、最大 1,000 コードポイント（「𠮷」は1文字）
 */
export const WATCHLIST_MEMO_MAX_LENGTH = 1000;
export const WATCHLIST_LIMIT = 500;

export const WATCHLIST_MESSAGES = {
  memo_too_long: "メモは 1,000 文字以内で入力してください",
  limit: "ウォッチリストは 500 銘柄まで登録できます",
  update_failed: "ウォッチリストを更新できませんでした。時間をおいてもう一度お試しください",
  memo_save_failed: "メモを保存できませんでした。時間をおいてもう一度お試しください",
  load_error: "ウォッチリストを読み込めませんでした",
} as const;

/** 保存する値（前後の空白を除き、空なら null） */
export function normalizeWatchlistMemo(memo: string | null): string | null {
  if (memo === null) return null;
  const trimmed = trimWhitespace(memo);
  return trimmed === "" ? null : trimmed;
}

/** 前後の空白を除いた後のコードポイントの数（画面の「N / 1,000」） */
export function watchlistMemoLength(memo: string): number {
  return codePointLength(trimWhitespace(memo));
}

/** 検証。問題が無ければ null */
export function validateWatchlistMemo(memo: string): "memo_too_long" | null {
  return watchlistMemoLength(memo) > WATCHLIST_MEMO_MAX_LENGTH ? "memo_too_long" : null;
}
