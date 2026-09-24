import "server-only";

import type { NextRequest } from "next/server";

import { jsonNoStore } from "@/lib/http/no-store";
import { createAdminClient } from "@/lib/supabase/admin";

import { REQUEST_BUDGET_MS, systemClock } from "./clock";
import { getCronSecret, isAuthorizedCronRequest } from "./config";
import { executeIngestionRun, startIngestionRun, type RunOutcome, type SupportedTarget } from "./runner";

/**
 * 定期実行（Vercel Cron）のルートの共通の処理。`Authorization: Bearer <CRON_SECRET>` だけで認証する
 * （ログインのセッションは使わない。proxy は /api/cron/ の配下を未ログイン判定から外している）。
 * targets をこの順に、それぞれ別の実行として動かし、完了まで待ってから結果（件数と状態のみ）を返す。
 * 外部 API への新しい要求は、ルートの開始から REQUEST_BUDGET_MS までに限る（対象をまたいで数える）。
 */
export async function handleCronRequest(request: NextRequest, targets: readonly SupportedTarget[], label: string) {
  const requestDeadline = systemClock.now() + REQUEST_BUDGET_MS;
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), getCronSecret())) {
    return jsonNoStore({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const runs: RunOutcome[] = [];
  const skipped: SupportedTarget[] = [];
  for (const [index, target] of targets.entries()) {
    let start;
    try {
      start = await startIngestionRun(admin, target, "cron");
    } catch (error) {
      console.error(`[${label}] 取り込みを開始できませんでした`, error);
      return jsonNoStore({ error: "internal_error" }, { status: 500 });
    }
    if (!start.started) {
      // 最初の対象を始められなければ何もしない。途中からほかの実行（手動など）が始まっていたら、残りは飛ばす
      if (index === 0) return jsonNoStore({ error: "already_running" }, { status: 409 });
      skipped.push(target);
      continue;
    }
    runs.push(await executeIngestionRun(start.runId, target, { admin, requestDeadline }));
  }
  return jsonNoStore({ data: skipped.length > 0 ? { runs, skipped } : { runs } });
}

/**
 * HEAD は Next.js では GET として処理されるため、明示的に 405 にする（死活監視などで取り込みが走らないように。Sprint 3 評価の M2）。
 */
export function methodNotAllowedForHead() {
  return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store, max-age=0" } });
}
