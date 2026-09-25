/**
 * 手動補正のメモの規則（Sprint 11。契約の第2章の6）。画面・API・DB（ownership_overrides の check 制約とトリガー）で同じ定義にする。
 * - 空白の文字集合は JavaScript の正規表現 \s と同じ（DB のマイグレーションは同じ文字を明示した文字クラスで書く）
 * - 保存する値は前後の空白を除いた値（途中の改行・空白は保つ）
 * - 除いた後が 1〜1,000 コードポイント（String.length の UTF-16 の単位ではなく、「𠮷」は1文字）
 */

/** 空白の文字（JavaScript の \s と同じ集合）。DB の文字クラス `[\t\n\v\f\r    -     　﻿]` と一致させる */
export const MEMO_WHITESPACE_CLASS = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

const LEADING = new RegExp(`^${MEMO_WHITESPACE_CLASS}+`, "u");
const TRAILING = new RegExp(`${MEMO_WHITESPACE_CLASS}+$`, "u");

export const MEMO_MAX_LENGTH = 1000;

/** 前後の空白を除く */
export function trimMemo(memo: string): string {
  return memo.replace(LEADING, "").replace(TRAILING, "");
}

/** コードポイントの数 */
export function memoLength(memo: string): number {
  return [...memo].length;
}

export type MemoError = "memo_required" | "memo_too_long";

/** 検証（前後の空白を除いた値で数える）。問題が無ければ null */
export function validateMemo(memo: string): MemoError | null {
  const length = memoLength(trimMemo(memo));
  if (length === 0) return "memo_required";
  if (length > MEMO_MAX_LENGTH) return "memo_too_long";
  return null;
}

export const MEMO_ERROR_MESSAGES: Record<MemoError, string> = {
  memo_required: "理由のメモを入力してください",
  memo_too_long: "メモは 1,000 文字以内で入力してください",
};
