/**
 * 利用者が入力する文字列の空白の文字集合（Sprint 11 のメモ、Sprint 13 のプリセットの名前で共有）。
 * JavaScript の正規表現 \s と同じ集合。DB のマイグレーション（ownership_overrides・screening_presets の check 制約とトリガー）は、
 * 同じ文字を明示した文字クラスで書く（[[:space:]] や btrim の既定はロケール・範囲が違うので使わない）。
 *   U+0009〜000D、0020、00A0、1680、2000〜200A、2028、2029、202F、205F、3000、FEFF
 */
export const WHITESPACE_CLASS = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";

const LEADING = new RegExp(`^${WHITESPACE_CLASS}+`, "u");
const TRAILING = new RegExp(`${WHITESPACE_CLASS}+$`, "u");

/** 前後の空白を除く（途中は保つ） */
export function trimWhitespace(text: string): string {
  return text.replace(LEADING, "").replace(TRAILING, "");
}

/** コードポイントの数（String.length の UTF-16 の単位ではなく、「𠮷」は1文字） */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** NUL（U+0000）を含むか。Postgres の text は NUL を保存できないので、API の入力の検証で拒否する（Sprint 14 評価の m1） */
export function containsNul(text: string): boolean {
  return text.includes("\u0000");
}
