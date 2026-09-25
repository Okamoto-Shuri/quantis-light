import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { invalidPresetResponse, isPresetId, parsePresetInput, presetDbErrorResponse, presetFunctionResponse } from "@/lib/screening/preset-api";

export const dynamic = "force-dynamic";

/**
 * 1つの条件プリセット（Sprint 13）。
 * - PATCH: 名前の変更・上書き（query）・既定の切り替え（{"name"?,"query"?,"isDefault"?}。1つ以上）。1トランザクション
 * - DELETE: 削除
 * id が uuid の形でなければ 400 invalid_id。無い・他人の行なら 404 not_found（DB は変わらない）。
 */
type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request.headers)) return jsonNoStore({ error: "cross_origin" }, { status: 403 });
  const { id } = await params;
  if (!isPresetId(id)) return jsonNoStore({ error: "invalid_id" }, { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return jsonNoStore({ error: "invalid_body" }, { status: 400 });
  }
  const input = parsePresetInput(body, "update");
  if (!input.ok) return invalidPresetResponse(input);

  const { data, error } = await auth.supabase.rpc("update_screening_preset", {
    p_id: id,
    p_name: input.value.name ?? null,
    p_query: input.value.query ?? null,
    p_default: input.value.isDefault ?? null,
  });
  if (error) return presetDbErrorResponse(error, "プリセットの変更");
  return presetFunctionResponse(data);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request.headers)) return jsonNoStore({ error: "cross_origin" }, { status: 403 });
  const { id } = await params;
  if (!isPresetId(id)) return jsonNoStore({ error: "invalid_id" }, { status: 400 });

  const { data, error } = await auth.supabase.from("screening_presets").delete().eq("id", id).select("id");
  if (error) return presetDbErrorResponse(error, "プリセットの削除");
  if ((data ?? []).length === 0) return jsonNoStore({ error: "not_found" }, { status: 404 });
  return jsonNoStore({ deleted: true });
}
