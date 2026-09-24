import { describe, expect, it, vi } from "vitest";

import { performLogin, type LoginDeps } from "./login";
import { LOGIN_ERROR_MESSAGES } from "./login-errors";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function deps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    isEmailAllowed: vi.fn(async () => true),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

/** supabase-js の AuthApiError に近い形のエラー */
function authError(status: number, code: string, name = "AuthApiError") {
  return Object.assign(new Error(code), { name, status, code });
}

const VALID = { email: "owner@quantis.local", password: "Quantis-Owner-2026!" };

describe("performLogin", () => {
  it("許可されたユーザーは next の遷移先へ", async () => {
    const d = deps();
    const result = await performLogin(form({ ...VALID, next: "/stocks/72030" }), d);
    expect(result).toEqual({ ok: true, redirectTo: "/stocks/72030" });
    expect(d.signInWithPassword).toHaveBeenCalledWith("owner@quantis.local", VALID.password);
  });

  it("メールアドレスは前後の空白を除き小文字にしてから照会する", async () => {
    const d = deps();
    await performLogin(form({ email: "  OWNER@Quantis.Local ", password: "x" }), d);
    expect(d.isEmailAllowed).toHaveBeenCalledWith("owner@quantis.local");
    expect(d.signInWithPassword).toHaveBeenCalledWith("owner@quantis.local", "x");
  });

  it("外部の next は / に置き換える", async () => {
    const result = await performLogin(form({ ...VALID, next: "//example.com" }), deps());
    expect(result).toEqual({ ok: true, redirectTo: "/" });
  });

  it("未入力・形式不正は日本語の入力エラーを返し、照会しない", async () => {
    const d = deps();
    const empty = await performLogin(form({ email: "", password: "" }), d);
    expect(empty).toMatchObject({
      ok: false,
      state: { fieldErrors: { email: "メールアドレスを入力してください", password: "パスワードを入力してください" } },
    });
    const invalid = await performLogin(form({ email: "not-an-email", password: "x" }), d);
    expect(invalid).toMatchObject({ ok: false, state: { fieldErrors: { email: "メールアドレスの形式が正しくありません" } } });
    expect(d.isEmailAllowed).not.toHaveBeenCalled();
  });

  it("許可リスト外は、パスワード照合をせずに拒否する", async () => {
    const d = deps({ isEmailAllowed: vi.fn(async () => false) });
    const result = await performLogin(form(VALID), d);
    expect(result).toMatchObject({ ok: false, state: { formError: LOGIN_ERROR_MESSAGES.not_allowed } });
    expect(d.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["パスワード誤り", authError(400, "invalid_credentials"), LOGIN_ERROR_MESSAGES.invalid_credentials],
    ["回数制限（429）", authError(429, "over_request_rate_limit"), LOGIN_ERROR_MESSAGES.rate_limited],
    ["フックによる拒否（403）", authError(403, "unknown"), LOGIN_ERROR_MESSAGES.not_allowed],
    ["Auth の 5xx", authError(502, "unexpected_failure"), LOGIN_ERROR_MESSAGES.unavailable],
    [
      "接続できない",
      Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }),
      LOGIN_ERROR_MESSAGES.unavailable,
    ],
    ["想定外", authError(418, "teapot"), LOGIN_ERROR_MESSAGES.unknown],
  ])("%s は対応するメッセージを返す", async (_label, error, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await performLogin(form(VALID), deps({ signInWithPassword: vi.fn(async () => ({ error })) }));
    expect(result).toEqual({ ok: false, state: { email: VALID.email, formError: message } });
  });

  it("許可リストの照会で接続できないときは、接続エラーを返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ isEmailAllowed: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) });
    const result = await performLogin(form(VALID), d);
    expect(result).toMatchObject({ ok: false, state: { formError: LOGIN_ERROR_MESSAGES.unavailable } });
    expect(d.signInWithPassword).not.toHaveBeenCalled();
  });

  it("サインインが例外を投げても未処理にしない", async () => {
    const d = deps({ signInWithPassword: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) });
    const result = await performLogin(form(VALID), d);
    expect(result).toMatchObject({ ok: false, state: { formError: LOGIN_ERROR_MESSAGES.unavailable } });
  });
});
