import { describeNetworkError, type FetchLike } from "../jquants/equities-master";
import { parseRetryAfter } from "../jquants/http";

/**
 * EDINET API（Version 2）への1回の GET 要求と、応答の分類（書類一覧 API・書類取得 API で共通）。
 * 金融庁「EDINET API 仕様書（Version 2）」2026年6月版の 3-1・3-2・3-3 で確かめた内容:
 * - キーはクエリのパラメータ `Subscription-Key`。そのため**要求の URL は秘密**として扱い、URL・要求・fetch の例外（`cause`）を
 *   ログ・例外のメッセージ・実行履歴に出さない。この関数の戻り値にも URL を含めない。
 * - パラメータの誤り・キーの無効などのエラーでも HTTP ステータスは 200 で、本文の JSON にステータスが入る
 *   （400・404・500 は `metadata.status`、401・429 は `StatusCode`）。この環境で、キー無しの要求に
 *   HTTP 200 と `{"StatusCode": 401, ...}` が返ることを確かめた。
 * - 書類取得 API の成功は ZIP（Content-Type は application/octet-stream）。不開示の書類は PDF が返る。
 *   成功の判定は本文の先頭の ZIP のシグネチャ（PK\x03\x04）で行い、Content-Type だけで判定しない。
 * - リダイレクトは追わない（redirect: "manual"）。ホストの移設などで、キー付きの URL を別のホストへ送らないため。
 */

export const EDINET_API_BASE_URL = "https://api.edinet-fsa.go.jp/api/v2";

export type EdinetFailure =
  /** 401（HTTP、または本文の StatusCode）。キーが無効・欠如 */
  | { kind: "unauthorized"; status: 401 }
  /** 429、503 */
  | { kind: "rate_limited"; status: number; retryAfterSeconds?: number }
  /** 3xx。追わない */
  | { kind: "redirect"; status: number }
  /** 404（HTTP または本文） */
  | { kind: "not_found"; status: 404 }
  /** 400、500 など（HTTP または本文） */
  | { kind: "http_error"; status: number }
  | { kind: "unreachable"; reason: string }
  /** 200 だが HTML・JSON として読めない・必須の項目が無い・ZIP でない本文 */
  | { kind: "invalid_format"; status: number | null }
  /** 書類取得で PDF が返った（不開示の書類など） */
  | { kind: "pdf_returned" };

export type EdinetJsonResponse = { kind: "ok"; json: unknown } | EdinetFailure;
export type EdinetZipResponse = { kind: "ok"; bytes: Uint8Array } | EdinetFailure;

/** 実行を打ち切る失敗（キーの無効・呼び出しの制限・リダイレクト）。 */
export function isAbortingFailure(failure: EdinetFailure): boolean {
  return failure.kind === "unauthorized" || failure.kind === "rate_limited" || failure.kind === "redirect";
}

/** 記録用の状態コード（接続できない・形式の違いは null）。 */
export function failureStatus(failure: EdinetFailure): number | null {
  switch (failure.kind) {
    case "unauthorized":
    case "rate_limited":
    case "redirect":
    case "not_found":
    case "http_error":
      return failure.status;
    case "invalid_format":
      // 200 の HTML などは「形式の違い」（状態コードは記録しない。HTTP 200 を失敗の原因に見せない）
      return failure.status !== null && failure.status !== 200 ? failure.status : null;
    default:
      return null;
  }
}

/** 本文の JSON が示す「実効のステータス」。読めなければ null。 */
export function statusFromBody(json: unknown): number | null {
  if (typeof json !== "object" || json === null) return null;
  const direct = (json as { StatusCode?: unknown }).StatusCode;
  if (typeof direct === "number" && Number.isInteger(direct)) return direct;
  if (typeof direct === "string" && /^\d{3}$/.test(direct)) return Number(direct);
  const meta = (json as { metadata?: { status?: unknown } }).metadata;
  const status = meta?.status;
  if (typeof status === "string" && /^\d{3}$/.test(status)) return Number(status);
  if (typeof status === "number" && Number.isInteger(status)) return status;
  return null;
}

function classifyStatus(status: number): EdinetFailure | null {
  if (status === 200) return null;
  if (status === 401) return { kind: "unauthorized", status: 401 };
  if (status === 429 || status === 503) return { kind: "rate_limited", status };
  if (status >= 300 && status < 400) return { kind: "redirect", status };
  if (status === 404) return { kind: "not_found", status: 404 };
  return { kind: "http_error", status };
}

/** 呼び出しの制限の応答に、ヘッダーの Retry-After（秒の整数）を付ける（EDINET はふつう本文でステータスを返すので無い）。 */
function withRetryAfter<F extends EdinetFailure | null>(failure: F, response: Response): F {
  if (failure?.kind !== "rate_limited") return failure;
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  return (retryAfterSeconds === null ? failure : { ...failure, retryAfterSeconds }) as F;
}

function buildUrl(path: string, params: Record<string, string>, apiKey: string): string {
  const query = new URLSearchParams({ ...params, "Subscription-Key": apiKey });
  return `${EDINET_API_BASE_URL}${path}?${query.toString()}`;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // %PDF

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function send(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ kind: "response"; response: Response } | EdinetFailure> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    // redirect: "manual" の応答は、Node では 3xx、ブラウザ互換の実装では type = "opaqueredirect"・status 0
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      return { kind: "redirect", status: response.status || 302 };
    }
    return { kind: "response", response };
  } catch (error) {
    // 例外そのもの（cause に URL が入ることがある）は記録しない。分類の文字列だけを返す
    return { kind: "unreachable", reason: describeNetworkError(error) };
  }
}

/** 書類一覧 API など、JSON を返す要求。例外は投げない。 */
export async function requestEdinetJson({
  path,
  params,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  path: string;
  params: Record<string, string>;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<EdinetJsonResponse> {
  const sent = await send(buildUrl(path, params, apiKey), fetchImpl, timeoutMs);
  if (sent.kind !== "response") return sent;
  const { response } = sent;

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return isTimeout(error) ? { kind: "unreachable", reason: "タイムアウト" } : { kind: "invalid_format", status: response.status };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML（メンテナンスの画面・Sorry 画面）や壊れた JSON。HTTP のステータスがエラーならその分類
    return withRetryAfter(classifyStatus(response.status), response) ?? { kind: "invalid_format", status: response.status };
  }
  const bodyStatus = statusFromBody(json);
  const failure = classifyStatus(response.status) ?? (bodyStatus === null ? null : classifyStatus(bodyStatus));
  if (failure) return withRetryAfter(failure, response);
  return { kind: "ok", json };
}

/** 書類取得 API（ZIP を返す要求）。例外は投げない。 */
export async function requestEdinetZip({
  path,
  params,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 60_000,
}: {
  path: string;
  params: Record<string, string>;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<EdinetZipResponse> {
  const sent = await send(buildUrl(path, params, apiKey), fetchImpl, timeoutMs);
  if (sent.kind !== "response") return sent;
  const { response } = sent;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return isTimeout(error) ? { kind: "unreachable", reason: "タイムアウト" } : { kind: "invalid_format", status: response.status };
  }
  const httpFailure = classifyStatus(response.status);
  if (httpFailure) return withRetryAfter(httpFailure, response);
  if (startsWith(bytes, ZIP_SIGNATURE)) return { kind: "ok", bytes };
  if (startsWith(bytes, PDF_SIGNATURE)) return { kind: "pdf_returned" };

  // ZIP でない本文: エラーの JSON なら、その実効のステータスで分類する（200＋本文 401 はキーの無効として打ち切る）
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const bodyStatus = statusFromBody(json);
    if (bodyStatus !== null) {
      const failure = classifyStatus(bodyStatus);
      if (failure) return failure;
    }
  } catch {
    // HTML など
  }
  return { kind: "invalid_format", status: response.status };
}
