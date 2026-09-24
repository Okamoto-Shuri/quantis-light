import { after, type NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { executeIngestionRun, isSupportedTarget, startIngestionRun } from "@/lib/ingestion/runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
/** after() の取り込み処理も、このルートの制限時間の中で動く（応答なしとみなす 15 分より十分短い）。 */
export const maxDuration = 300;

/** 本文が無ければ銘柄マスタ。JSON でなければ null。 */
async function readTarget(request: NextRequest): Promise<{ ok: true; target: unknown } | { ok: false }> {
  const text = await request.text();
  if (!text.trim()) return { ok: true, target: "stock_master" };
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
    const target = (body as { target?: unknown }).target;
    return { ok: true, target: target === undefined ? "stock_master" : target };
  } catch {
    return { ok: false };
  }
}

/**
 * 手動取り込みを開始する（「今すぐ取り込み」）。
 * 実行を「実行中」として記録したら 202 を返し、取り込みの本体は応答の後に動かす。
 * 実行中の実行があれば 409（二重に実行しない）。
 */
export async function POST(request: NextRequest) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  // CSRF 対策: 同一オリジンからの要求だけを受け付ける
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return jsonNoStore({ error: "forbidden" }, { status: 403 });
  }

  const body = await readTarget(request);
  if (!body.ok) return jsonNoStore({ error: "invalid_request" }, { status: 400 });
  if (!isSupportedTarget(body.target)) return jsonNoStore({ error: "unsupported_target" }, { status: 400 });
  const target = body.target;

  const admin = createAdminClient();
  let start;
  try {
    start = await startIngestionRun(admin, target, "manual");
  } catch (error) {
    console.error("[api/ingestion/runs] 取り込みを開始できませんでした", error);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  if (!start.started) {
    return jsonNoStore({ error: "already_running", data: { activeRun: start.activeRun } }, { status: 409 });
  }

  const runId = start.runId;
  after(async () => {
    await executeIngestionRun(runId, target, { admin });
  });
  return jsonNoStore({ data: { runId, status: "running" } }, { status: 202 });
}
