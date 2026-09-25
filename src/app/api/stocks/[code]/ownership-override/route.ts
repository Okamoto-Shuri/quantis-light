import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { normalizeStockCode } from "@/lib/listing/ages";
import { parseOverrideInput, toApiOverride } from "@/lib/ownership/override";

export const dynamic = "force-dynamic";

/**
 * 条件④の手動補正（Sprint 11。F10）。ユーザーのセッション（RLS）で DB 関数を呼ぶ（サービスロールは使わない）。
 * - GET: 自分の補正（無ければ data: null）
 * - PUT: 新規・編集（{"verdict","memo"}。記録は DB が現在の自動判定で置き換える）
 * - DELETE: 取り消し（{"deleted": 消したか}）
 * 書き込みは同一オリジンの要求だけ（403 cross_origin）。コードの形が不正なら 400 invalid_code、銘柄マスタに無ければ 404。
 */

type Params = { params: Promise<{ code: string }> };

async function stockExists(supabase: Extract<Awaited<ReturnType<typeof requireApiUser>>, { ok: true }>["supabase"], code: string) {
  const { data, error } = await supabase.from("stocks").select("code").eq("code", code).limit(1);
  if (error) return { ok: false as const };
  return { ok: true as const, exists: (data ?? []).length > 0 };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const code = normalizeStockCode((await params).code);
  if (code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  const exists = await stockExists(auth.supabase, code);
  if (!exists.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  if (!exists.exists) return jsonNoStore({ error: "not_found" }, { status: 404 });

  const { data, error } = await auth.supabase.rpc("owner_override_summary", { p_code: code, p_params: {} });
  if (error) {
    console.error("[api/ownership-override] 補正の取得に失敗しました", error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  return jsonNoStore({ data: data === null ? null : toApiOverride(data) });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request.headers)) return jsonNoStore({ error: "cross_origin" }, { status: 403 });
  const code = normalizeStockCode((await params).code);
  if (code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return jsonNoStore({ error: "invalid_body" }, { status: 400 });
  }
  const input = parseOverrideInput(body);
  if (!input.ok) return jsonNoStore({ error: "invalid_override", fields: input.fields }, { status: 400 });

  const { data, error } = await auth.supabase.rpc("owner_override_save", {
    p_code: code,
    p_verdict: input.value.verdict,
    p_memo: input.value.memo,
  });
  if (error) {
    // check 制約の違反（23514）は、API の検証と DB の定義がずれたときだけ起こる
    if (error.code === "23514") return jsonNoStore({ error: "invalid_override", fields: ["verdict", "memo"] }, { status: 400 });
    console.error("[api/ownership-override] 補正の保存に失敗しました", error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  if (data === null) return jsonNoStore({ error: "not_found" }, { status: 404 });
  return jsonNoStore({ data: toApiOverride(data) });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request.headers)) return jsonNoStore({ error: "cross_origin" }, { status: 403 });
  const code = normalizeStockCode((await params).code);
  if (code === null) return jsonNoStore({ error: "invalid_code" }, { status: 400 });

  const exists = await stockExists(auth.supabase, code);
  if (!exists.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  if (!exists.exists) return jsonNoStore({ error: "not_found" }, { status: 404 });

  const { data, error } = await auth.supabase.rpc("owner_override_delete", { p_code: code });
  if (error) {
    console.error("[api/ownership-override] 補正の取り消しに失敗しました", error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  return jsonNoStore({ deleted: data === true });
}
