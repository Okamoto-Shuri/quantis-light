import { describeNetworkError, type FetchLike } from "./equities-master";

/**
 * J-Quants API V2 への1回の GET 要求と、応答の分類（株価四本値・財務情報・取引カレンダーで共通）。
 * https://jpx-jquants.com/ja/spec/response-status
 * どの種類にも、キーの値や応答の本文（市場データ、エラーの文言）は含めない。
 */

/** J-Quants がキーの無効・欠如のときに 403 の本文に返す message（実 API で確認済み）。 */
export const JQUANTS_KEY_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  "The incoming api key is invalid or expired.",
  "The api key is required.",
]);

export type JQuantsResponse =
  | { kind: "ok"; json: unknown }
  /** 210 No Content (Partial)。データを取得できなかった */
  | { kind: "no_content" }
  /** 403 で、本文がキーの無効・欠如 */
  | { kind: "key_rejected"; status: 403 }
  /** 401 */
  | { kind: "unauthorized"; status: 401 }
  /** 429。Retry-After（秒の整数）があればその値 */
  | { kind: "rate_limited"; retryAfterSeconds?: number }
  /** そのほかの状態コード（400、キー以外の 403、500 など） */
  | { kind: "http_error"; status: number }
  | { kind: "unreachable"; reason: string }
  /** 200 だが JSON として読めない */
  | { kind: "invalid_format" };

/** 失敗の種類（ok 以外）。 */
export type JQuantsFailure = Exclude<JQuantsResponse, { kind: "ok" }>;

async function isKeyErrorBody(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown } | null)?.message;
    return typeof message === "string" && JQUANTS_KEY_ERROR_MESSAGES.has(message.trim());
  } catch {
    return false;
  }
}

/** Retry-After ヘッダー（秒の整数だけを読む。HTTP 日付の形・数でない値は null）。 */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

/** 1回の GET を送って分類する。例外は投げない。 */
export async function requestJQuants({
  url,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  url: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<JQuantsResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    return { kind: "unreachable", reason: describeNetworkError(error) };
  }

  if (response.status === 210) return { kind: "no_content" };
  if (response.status === 401) return { kind: "unauthorized", status: 401 };
  if (response.status === 403) {
    return (await isKeyErrorBody(response)) ? { kind: "key_rejected", status: 403 } : { kind: "http_error", status: 403 };
  }
  if (response.status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
    return retryAfterSeconds === null ? { kind: "rate_limited" } : { kind: "rate_limited", retryAfterSeconds };
  }
  if (response.status !== 200) return { kind: "http_error", status: response.status };

  try {
    return { kind: "ok", json: await response.json() };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { kind: "unreachable", reason: "タイムアウト" };
    }
    return { kind: "invalid_format" };
  }
}

/** 失敗の状態コード（記録用。接続できない・形式の違いは null）。 */
export function failureStatus(failure: JQuantsFailure): number | null {
  switch (failure.kind) {
    case "no_content":
      return 210;
    case "key_rejected":
    case "unauthorized":
    case "http_error":
      return failure.status;
    case "rate_limited":
      return 429;
    default:
      return null;
  }
}
