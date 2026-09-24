import type { NextRequest } from "next/server";

import { jsonNoStore } from "@/lib/http/no-store";
import { getCronSecret, isAuthorizedCronRequest } from "@/lib/ingestion/config";
import { executeIngestionRun, startIngestionRun, SUPPORTED_TARGETS, type RunOutcome } from "@/lib/ingestion/runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 定期実行（Vercel Cron。vercel.json）。`Authorization: Bearer <CRON_SECRET>` だけで認証する
 * （ログインのセッションは使わない。proxy はこの配下を未ログイン判定から外している）。
 * 取り込みの完了まで待ってから、実行ごとの結果（件数と状態のみ）を返す。
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), getCronSecret())) {
    return jsonNoStore({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const runs: RunOutcome[] = [];
  for (const target of SUPPORTED_TARGETS) {
    let start;
    try {
      start = await startIngestionRun(admin, target, "cron");
    } catch (error) {
      console.error("[api/cron/daily] 取り込みを開始できませんでした", error);
      return jsonNoStore({ error: "internal_error" }, { status: 500 });
    }
    if (!start.started) return jsonNoStore({ error: "already_running" }, { status: 409 });
    runs.push(await executeIngestionRun(start.runId, target, { admin }));
  }
  return jsonNoStore({ data: { runs } });
}
