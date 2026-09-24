import { requireApiUser } from "@/lib/auth/api";
import { jsonNoStore } from "@/lib/http/no-store";
import { getIngestionConfigStatus } from "@/lib/ingestion/config";
import { fetchActiveRun, fetchRunHistory } from "@/lib/ingestion/history";
import { toApiRun } from "@/lib/ingestion/runs";
import { CRON_SCHEDULE } from "@/lib/ingestion/schedule";

export const dynamic = "force-dynamic";

/**
 * 取り込み状況: データソースと定期実行の設定状態（真偽値だけ）、実行中の実行、実行履歴（新しい 50 件）。
 * 実行履歴はユーザーのセッション（RLS の経路）で読む。
 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const [history, active] = await Promise.all([fetchRunHistory(auth.supabase), fetchActiveRun(auth.supabase)]);
  if (!history.ok || !active.ok) return jsonNoStore({ error: "internal_error" }, { status: 500 });

  const config = getIngestionConfigStatus();
  return jsonNoStore({
    data: {
      sources: config.sources,
      cron: { configured: config.cron.configured, schedule: CRON_SCHEDULE },
      activeRun: active.activeRun ? toApiRun(active.activeRun) : null,
      runs: history.runs.map(toApiRun),
      hasMore: history.hasMore,
    },
  });
}
