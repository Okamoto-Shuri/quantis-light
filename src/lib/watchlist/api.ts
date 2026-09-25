import { jsonNoStore } from "@/lib/http/no-store";
import type { ScreeningChanges } from "@/lib/screening/changes";
import { toJstIso } from "@/lib/stocks/annual-report";
import { containsNul } from "@/lib/text/whitespace";

import type { WatchlistEntry } from "./entries";
import { normalizeWatchlistMemo, validateWatchlistMemo } from "./memo";

/**
 * ウォッチリストの API（Sprint 14）の本文の検証、DB のエラーの分類、応答の形。
 * 書き込みはユーザーのセッション（RLS）で watchlist_items に直接行う（行の中身はトリガーと check 制約が守る）。
 */

/** PATCH の本文 {"memo": string | null}。空白だけ・null は「メモを消す」（null） */
export function parseMemoInput(body: unknown): { ok: true; memo: string | null } | { ok: false } {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("memo" in body)) return { ok: false };
  const memo = (body as { memo: unknown }).memo;
  if (memo === null) return { ok: true, memo: null };
  if (typeof memo !== "string" || containsNul(memo) || validateWatchlistMemo(memo) !== null) return { ok: false };
  return { ok: true, memo: normalizeWatchlistMemo(memo) };
}

type DbError = { code?: string; message: string };

/** DB のエラーを応答にする。上限（QW500）→ 409、存在しない銘柄（外部キー 23503）→ 404、check 違反 → 400 */
export function watchlistDbErrorResponse(error: DbError, label: string): Response {
  if (error.code === "QW500") return jsonNoStore({ error: "watchlist_limit" }, { status: 409 });
  if (error.code === "23503") return jsonNoStore({ error: "stock_not_found" }, { status: 404 });
  if (error.code === "23514") return jsonNoStore({ error: "invalid_memo", fields: ["memo"] }, { status: 400 });
  console.error(`[api/watchlist] ${label}に失敗しました`, error.code ?? "", error.message);
  return jsonNoStore({ error: "internal_error" }, { status: 500 });
}

/** 行の基本の項目（PUT・PATCH の応答） */
export function toApiWatchlistItem(item: { code: string; memo: string | null; created_at: string; updated_at: string }) {
  return {
    code: item.code,
    memo: item.memo,
    addedAt: toJstIso(item.created_at) ?? item.created_at,
    memoUpdatedAt: toJstIso(item.updated_at) ?? item.updated_at,
  };
}

/** GET /api/watchlist の1行（change は比較できないとき null） */
export function toApiWatchlistEntry(entry: WatchlistEntry, changes: ScreeningChanges | null) {
  const { row } = entry;
  const added = changes?.status === "ok" && changes.added.some((change) => change.code === entry.code);
  const removed = changes?.status === "ok" && changes.removed.some((change) => change.code === entry.code);
  return {
    ...toApiWatchlistItem(entry),
    stock: {
      company_name: row.company_name,
      market_code: row.market_code,
      market_name: row.market_name,
      sector33_name: row.sector33_name,
      delisted_on: entry.delisted_on,
    },
    metrics: {
      revenue_cagr: row.revenue_cagr,
      revenue_cagr_display_pct: row.revenue_cagr_display_pct,
      revenue_cagr_unavailable_reason: row.revenue_cagr_unavailable_reason,
      revenue_cagr_supplemented: row.revenue_cagr_supplemented,
      operating_margin: row.operating_margin,
      operating_margin_display_pct: row.operating_margin_display_pct,
      operating_margin_unavailable_reason: row.operating_margin_unavailable_reason,
      has_financials: row.has_financials,
      first_price_date: row.first_price_date,
      data_start_date: row.data_start_date,
      listed_before_data_start: row.listed_before_data_start,
      estimated_listing_years: row.estimated_listing_years,
      listing_years_lower_bound: row.listing_years_lower_bound,
    },
    evaluation: {
      status: row.status,
      ownerResult: row.ownership.result,
      ownerAutoResult: row.ownership.auto_result,
      ownerOverride: row.ownership.override?.verdict ?? null,
      included: entry.included,
      exclusion: entry.exclusion,
      blocking: entry.blocking,
      delisted: entry.delisted_on !== null,
    },
    change: added ? "added" : removed ? "removed" : null,
  };
}
