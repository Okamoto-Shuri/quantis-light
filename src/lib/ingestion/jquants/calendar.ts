import { z } from "zod";

import { JQUANTS_API_BASE_URL, type FetchLike } from "./equities-master";
import { requestJQuants, type JQuantsFailure } from "./http";

/**
 * J-Quants API V2 の取引カレンダー（GET /v2/markets/calendar）。
 * https://jpx-jquants.com/ja/spec/mkt-cal
 * from/to（両端を含む）の全暦日が、Date と HolDiv（休日区分）で返る。
 * 休日区分: 0 非営業日、1 営業日、2 東証半日立会日、3 非営業日（祝日取引あり）
 * （https://jpx-jquants.com/ja/spec/mkt-cal/holiday-division）。東証の営業日は 1 と 2。
 */
export const MARKETS_CALENDAR_URL = `${JQUANTS_API_BASE_URL}/markets/calendar`;

/** 東証の営業日とみなす休日区分。 */
export const BUSINESS_DAY_DIVISIONS: ReadonlySet<string> = new Set(["1", "2"]);

const envelopeSchema = z.object({
  data: z.array(z.unknown()),
  pagination_key: z.string().min(1).nullish(),
});

const rowSchema = z.object({
  Date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  HolDiv: z.string().regex(/^\d$/),
});

export type CalendarPage =
  | { kind: "rows"; businessDays: string[]; paginationKey: string | null }
  | JQuantsFailure;

export function parseCalendar(json: unknown): CalendarPage {
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return { kind: "invalid_format" };
  const businessDays: string[] = [];
  for (const raw of envelope.data.data) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) return { kind: "invalid_format" };
    if (BUSINESS_DAY_DIVISIONS.has(row.data.HolDiv)) businessDays.push(row.data.Date);
  }
  return { kind: "rows", businessDays, paginationKey: envelope.data.pagination_key ?? null };
}

/** 取引カレンダーを1ページ取得し、営業日を取り出す。例外は投げない。 */
export async function requestCalendarPage({
  apiKey,
  from,
  to,
  paginationKey = null,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  apiKey: string;
  from: string;
  to: string;
  paginationKey?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<CalendarPage> {
  const params = new URLSearchParams({ from, to });
  if (paginationKey) params.set("pagination_key", paginationKey);
  const response = await requestJQuants({ url: `${MARKETS_CALENDAR_URL}?${params.toString()}`, apiKey, fetchImpl, timeoutMs });
  if (response.kind !== "ok") return response;
  return parseCalendar(response.json);
}
