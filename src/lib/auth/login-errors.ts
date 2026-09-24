export type LoginErrorCode =
  | "invalid_credentials"
  | "not_allowed"
  | "rate_limited"
  | "unavailable"
  | "unknown";

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません",
  not_allowed: "このメールアドレスは利用が許可されていません",
  rate_limited: "ログインの試行回数が上限に達しました。しばらくしてから再度お試しください",
  unavailable: "認証サーバーに接続できません。しばらくしてから再度お試しください",
  unknown: "ログインに失敗しました。しばらくしてから再度お試しください",
};

export const REVOKED_MESSAGE = "このアカウントの利用許可が取り消されました";

type AuthErrorLike = {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
};

/** Supabase Auth のエラーを、画面に出すエラー種別に変換する。 */
export function classifyAuthError(error: unknown): LoginErrorCode {
  if (!error || typeof error !== "object") return "unknown";
  const { name, status, code } = error as AuthErrorLike;

  if (status === 429 || code === "over_request_rate_limit") return "rate_limited";
  if (code === "invalid_credentials" || code === "email_not_confirmed" || status === 400) {
    return "invalid_credentials";
  }
  // Custom Access Token Hook が許可リスト外として拒否した（HTTP 403）
  if (status === 403) return "not_allowed";
  // fetch 自体の失敗（接続拒否など）や、Auth / ゲートウェイの 5xx
  if (name === "AuthRetryableFetchError" || status === 0 || (typeof status === "number" && status >= 500)) {
    return "unavailable";
  }
  return "unknown";
}

/** fetch の失敗（サーバーに到達できない）かどうか。 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as AuthErrorLike;
  return (
    name === "AuthRetryableFetchError" ||
    (name === "TypeError" && typeof message === "string" && /fetch failed|network|ECONNREFUSED/i.test(message)) ||
    (typeof message === "string" && /fetch failed|ECONNREFUSED/i.test(message))
  );
}
