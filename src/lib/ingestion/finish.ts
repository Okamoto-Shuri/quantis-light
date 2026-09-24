import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RunStatus } from "./runs";

/**
 * 実行を終える。「実行中」の行だけを更新し、後片付け済みの行は上書きしない。
 * processedCount が null なら処理件数を変えない（保存のたびに件数を足している実行を、例外で終えるとき）。
 */
export async function finishRun(
  admin: SupabaseClient,
  runId: number,
  status: Exclude<RunStatus, "running">,
  processedCount: number | null,
  errorMessage: string | null,
  details: unknown = null,
): Promise<void> {
  const { data, error } = await admin.rpc("finish_ingestion_run", {
    p_run_id: runId,
    p_status: status,
    p_processed_count: processedCount,
    p_error_message: errorMessage,
    p_details: details,
  });
  if (error) throw new Error(`finish_ingestion_run に失敗しました: ${error.message}`);
  if (data !== true) {
    console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、結果（${status}）を記録しませんでした`);
  }
}
