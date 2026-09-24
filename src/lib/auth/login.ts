import { z } from "zod";

import { isValidEmail, normalizeEmail } from "./email";
import { classifyAuthError, isNetworkError, LOGIN_ERROR_MESSAGES, type LoginErrorCode } from "./login-errors";
import { sanitizeNextPath } from "./next-path";

export type LoginState = {
  email: string;
  formError?: string;
  fieldErrors?: { email?: string; password?: string };
};

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .refine(isValidEmail, "メールアドレスの形式が正しくありません"),
  password: z.string().min(1, "パスワードを入力してください"),
});

/** ログイン処理が使う外部依存。テストで差し替えられるように注入する。 */
export type LoginDeps = {
  isEmailAllowed(email: string): Promise<boolean>;
  signInWithPassword(email: string, password: string): Promise<{ error: unknown }>;
};

export type LoginResult = { ok: true; redirectTo: string } | { ok: false; state: LoginState };

function failure(email: string, code: LoginErrorCode): LoginResult {
  return { ok: false, state: { email, formError: LOGIN_ERROR_MESSAGES[code] } };
}

export async function performLogin(formData: FormData, deps: LoginDeps): Promise<LoginResult> {
  const rawEmail = String(formData.get("email") ?? "");
  const parsed = loginSchema.safeParse({ email: rawEmail, password: String(formData.get("password") ?? "") });
  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "email" || key === "password") && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, state: { email: rawEmail, fieldErrors } };
  }

  const email = normalizeEmail(parsed.data.email);
  const redirectTo = sanitizeNextPath(formData.get("next"));

  // パスワード照合より前に許可リストを確認する。
  let allowed: boolean;
  try {
    allowed = await deps.isEmailAllowed(email);
  } catch (error) {
    if (isNetworkError(error)) return failure(rawEmail, "unavailable");
    console.error("[login] 許可リストの確認に失敗しました", error);
    return failure(rawEmail, "unavailable");
  }
  if (!allowed) return failure(rawEmail, "not_allowed");

  let authError: unknown;
  try {
    ({ error: authError } = await deps.signInWithPassword(email, parsed.data.password));
  } catch (error) {
    authError = error;
  }
  if (authError) {
    const code = isNetworkError(authError) ? "unavailable" : classifyAuthError(authError);
    if (code === "unknown") console.error("[login] 想定外の認証エラー", authError);
    return failure(rawEmail, code);
  }

  return { ok: true, redirectTo };
}
