import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FailureLog } from "./failures";
import type { RemainingUnit, RunStatus, StoppedReason } from "./runs";

/** 実行の終わり方（契約 sprint-12 の第2章の1・2）。 */
export type RunOutcomeRecord = {
  stoppedReason?: StoppedReason | null;
  remainingCount?: number | null;
  remainingUnit?: RemainingUnit | null;
  failures?: FailureLog | null;
};

/**
 * 実行を終える。「実行中」の行だけを更新し、後片付け済みの行は上書きしない。
 * processedCount が null なら処理件数を変えない（保存のたびに件数を足している実行を、例外で終えるとき）。
 * outcome は打ち切りの理由・残り・失敗した対象（行は 1,000 行まで。failed_count は全数）。
 */
export async function finishRun(
  admin: SupabaseClient,
  runId: number,
  status: Exclude<RunStatus, "running">,
  processedCount: number | null,
  errorMessage: string | null,
  details: unknown = null,
  outcome: RunOutcomeRecord = {},
): Promise<void> {
  const remaining = outcome.remainingCount ?? null;
  const hasOutcome = Object.values(outcome).some((value) => value !== undefined && value !== null);
  const { data, error } = await admin.rpc("finish_ingestion_run", {
    p_run_id: runId,
    p_status: status,
    p_processed_count: processedCount,
    p_error_message: errorMessage,
    p_details: details,
    // 打ち切りの理由・残り・失敗が無い終わり方（キー未設定など）は、Sprint 3〜9 と同じ引数で呼ぶ
    ...(hasOutcome
      ? {
          p_outcome: {
            stoppedReason: outcome.stoppedReason ?? null,
            remainingCount: remaining,
            remainingUnit: remaining === null ? null : (outcome.remainingUnit ?? null),
            failedCount: outcome.failures?.total ?? 0,
            failures: outcome.failures?.records ?? [],
          },
        }
      : {}),
  });
  if (error) throw new Error(`finish_ingestion_run に失敗しました: ${error.message}`);
  if (data !== true) {
    console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、結果（${status}）を記録しませんでした`);
  }
}
