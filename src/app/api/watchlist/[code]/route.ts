import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { normalizeStockCode } from "@/lib/listing/ages";
import { parseMemoInput, toApiWatchlistItem, watchlistDbErrorResponse } from "@/lib/watchlist/api";

export const dynamic = "force-dynamic";

/**
 * ウォッチリストの1銘柄（Sprint 14。F13）。ユーザーのセッション（RLS で本人の行だけ）で watchlist_items に書く。
 * - PUT: 追加（冪等）。新しく追加したら 201、既に登録済みなら 200（行は変えない）。本文は不要
 * - PATCH: メモの変更 {"memo": string | null}（null・空白だけで消す）
 * - DELETE: 外す
 * コードは正規化する（形が不正なら 400 invalid_code）。銘柄マスタに無ければ 404 stock_not_found（PUT）、
 * ウォッチリストに無ければ 404 not_found（PATCH・DELETE）。書き込みは同一オリジンだけ。
 */
type Params = { params: Promise<{ code: string }> };

const COLUMNS = "code, memo, created_at, updated_at";

async function guard(request: NextRequest, params: Params["params"]) {
  const auth = await requireApiUser();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  if (!isSameOriginRequest(request.headers)) return { ok: false as const, response: jsonNoStore({ error: "cross_origin" }, { status: 403 }) };
  const code = normalizeStockCode((await params).code);
  if (code === null) return { ok: false as const, response: jsonNoStore({ error: "invalid_code" }, { status: 400 }) };
  return { ok: true as const, supabase: auth.supabase, code };
}

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard(request, params);
  if (!g.ok) return g.response;
  // 既に登録済みなら何もしない（トリガーは同じ行があれば上限を確かめない。R1）
  const inserted = await g.supabase
    .from("watchlist_items")
    .upsert({ code: g.code }, { onConflict: "user_id,code", ignoreDuplicates: true })
    .select(COLUMNS);
  if (inserted.error) return watchlistDbErrorResponse(inserted.error, "ウォッチリストへの追加");
  if ((inserted.data ?? []).length > 0) return jsonNoStore({ data: toApiWatchlistItem(inserted.data![0]) }, { status: 201 });
  const existing = await g.supabase.from("watchlist_items").select(COLUMNS).eq("code", g.code).limit(1);
  if (existing.error) return watchlistDbErrorResponse(existing.error, "ウォッチリストの確認");
  if ((existing.data ?? []).length === 0) {
    console.error("[api/watchlist] 追加の後に行が見つかりません");
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  return jsonNoStore({ data: toApiWatchlistItem(existing.data![0]) });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const g = await guard(request, params);
  if (!g.ok) return g.response;
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return jsonNoStore({ error: "invalid_body" }, { status: 400 });
  }
  const input = parseMemoInput(body);
  if (!input.ok) return jsonNoStore({ error: "invalid_memo", fields: ["memo"] }, { status: 400 });
  const { data, error } = await g.supabase.from("watchlist_items").update({ memo: input.memo }).eq("code", g.code).select(COLUMNS);
  if (error) return watchlistDbErrorResponse(error, "メモの変更");
  if ((data ?? []).length === 0) return jsonNoStore({ error: "not_found" }, { status: 404 });
  return jsonNoStore({ data: toApiWatchlistItem(data![0]) });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guard(request, params);
  if (!g.ok) return g.response;
  const { data, error } = await g.supabase.from("watchlist_items").delete().eq("code", g.code).select("code");
  if (error) return watchlistDbErrorResponse(error, "ウォッチリストから外す");
  if ((data ?? []).length === 0) return jsonNoStore({ error: "not_found" }, { status: 404 });
  return jsonNoStore({ deleted: true });
}
