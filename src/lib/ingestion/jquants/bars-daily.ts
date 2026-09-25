import { z } from "zod";

import { JQUANTS_API_BASE_URL, type FetchLike } from "./equities-master";
import { requestJQuants } from "./http";

export { JQUANTS_KEY_ERROR_MESSAGES } from "./http";

/**
 * J-Quants API V2 の株価四本値（GET /v2/equities/bars/daily）。
 * https://jpx-jquants.com/ja/spec/eq-bars-daily
 * `code` か `date` が必須。`from`/`to` で期間を絞れる。応答に pagination_key があれば、同じ条件に付けて次のページを取る。
 * 初出日の判定に使うのは各行の Date と Code だけ（四本値は検証も保存もしない。売買の無い日は四本値が null）。
 */
export const BARS_DAILY_URL = `${JQUANTS_API_BASE_URL}/equities/bars/daily`;

const barRowSchema = z.object({
  Date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  Code: z.string().regex(/^[0-9A-Z]{4,5}$/),
});

const barsResponseSchema = z.object({
  data: z.array(z.unknown()),
  pagination_key: z.string().min(1).nullish(),
});

export type BarRow = { date: string; code: string };

/**
 * 1回の要求の結果。呼び出し側（データ期間の開始日の探索、コード別の取得）が扱いを決める。
 * どの種類にも、キーの値や応答の本文（株価、エラーの文言）は含めない。
 */
export type BarsPage =
  | { kind: "rows"; rows: BarRow[]; paginationKey: string | null }
  /** 210 No Content (Partial)。データを取得できなかった */
  | { kind: "no_content" }
  /** 403 で、本文がキーの無効・欠如 */
  | { kind: "key_rejected"; status: 403 }
  /** 401 */
  | { kind: "unauthorized"; status: 401 }
  | { kind: "rate_limited"; retryAfterSeconds?: number }
  /** そのほかの状態コード（400、キー以外の 403、500 など） */
  | { kind: "http_error"; status: number }
  | { kind: "unreachable"; reason: string }
  | { kind: "invalid_format" };

export type BarsQuery = { date: string } | { code: string; from: string };

function buildUrl(query: BarsQuery, paginationKey: string | null): string {
  const params = new URLSearchParams();
  if ("date" in query) {
    params.set("date", query.date);
  } else {
    params.set("code", query.code);
    params.set("from", query.from);
  }
  if (paginationKey) params.set("pagination_key", paginationKey);
  return `${BARS_DAILY_URL}?${params.toString()}`;
}

/** 株価四本値を1ページ取得して分類する。例外は投げない。 */
export async function requestBarsPage({
  apiKey,
  query,
  paginationKey = null,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  apiKey: string;
  query: BarsQuery;
  paginationKey?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<BarsPage> {
  const response = await requestJQuants({ url: buildUrl(query, paginationKey), apiKey, fetchImpl, timeoutMs });
  if (response.kind !== "ok") return response;
  const json = response.json;
  const parsed = barsResponseSchema.safeParse(json);
  if (!parsed.success) return { kind: "invalid_format" };

  const rows: BarRow[] = [];
  for (const raw of parsed.data.data) {
    const row = barRowSchema.safeParse(raw);
    if (!row.success) return { kind: "invalid_format" };
    rows.push({ date: row.data.Date, code: row.data.Code });
  }
  return { kind: "rows", rows, paginationKey: parsed.data.pagination_key ?? null };
}
