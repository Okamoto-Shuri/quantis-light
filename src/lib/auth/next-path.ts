const PARSE_BASE = "http://app.invalid";
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * ログイン後の遷移先（`next`）を検証する。アプリ内の相対パスだけを受け付け、それ以外は "/" を返す。
 * 引数は URLSearchParams などでデコード済みの値を渡すこと。
 */
export function sanitizeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "/";
  if (CONTROL_CHARS.test(raw)) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw[1] === "/" || raw.includes("\\")) return "/";

  let parsed: URL;
  try {
    parsed = new URL(raw, PARSE_BASE);
  } catch {
    return "/";
  }
  if (parsed.origin !== PARSE_BASE) return "/";

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** 未ログイン時のリダイレクト先。元のパスを `next` に付ける。 */
export function buildLoginPath(pathname: string, search = ""): string {
  const next = sanitizeNextPath(`${pathname}${search}`);
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
