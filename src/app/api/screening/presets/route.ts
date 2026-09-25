import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { invalidPresetResponse, parsePresetInput, presetDbErrorResponse, presetFunctionResponse, toApiPreset } from "@/lib/screening/preset-api";
import { fetchPresets } from "@/lib/screening/preset-queries";

export const dynamic = "force-dynamic";

/**
 * 条件プリセット（Sprint 13。F12）。ユーザーのセッション（RLS）で読み書きする（サービスロールは使わない）。
 * - GET: 自分のプリセット（作成の古い順）。読み出しの失敗は 500（空の配列にしない）
 * - POST: 作成（{"name","query","isDefault"?}。既定つきも1トランザクション）。201
 * 書き込みは同一オリジンの要求だけ（403 cross_origin）。
 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const result = await fetchPresets(auth.supabase);
  if (!result.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  return jsonNoStore({ data: result.value.map(toApiPreset) });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  if (!isSameOriginRequest(request.headers)) return jsonNoStore({ error: "cross_origin" }, { status: 403 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return jsonNoStore({ error: "invalid_body" }, { status: 400 });
  }
  const input = parsePresetInput(body, "create");
  if (!input.ok) return invalidPresetResponse(input);

  const { data, error } = await auth.supabase.rpc("create_screening_preset", {
    p_name: input.value.name,
    p_query: input.value.query,
    p_default: input.value.isDefault ?? false,
  });
  if (error) return presetDbErrorResponse(error, "プリセットの作成");
  return presetFunctionResponse(data, 201);
}
