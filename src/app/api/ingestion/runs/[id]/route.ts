import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { fetchRunDetail, parseRunId, toApiRunDetail } from "@/lib/ingestion/run-detail";

export const dynamic = "force-dynamic";

/**
 * 実行の詳細（Sprint 12）: 実行（打ち切りの理由・残り・失敗の件数・API の呼び出しと制限の記録）と、失敗した対象の一覧。
 * ユーザーのセッション（RLS の経路）で読む。id の形が違えば 400 invalid_id、無ければ 404 not_found。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const id = parseRunId((await params).id);
  if (id === null) return jsonNoStore({ error: "invalid_id" }, { status: 400 });

  const result = await fetchRunDetail(auth.supabase, id);
  if (!result.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });
  if (result.value === null) return jsonNoStore({ error: "not_found" }, { status: 404 });
  return jsonNoStore({ data: toApiRunDetail(result.value) });
}
