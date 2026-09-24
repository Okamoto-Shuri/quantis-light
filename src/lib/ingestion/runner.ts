import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getJQuantsApiKey } from "./config";
import { INGESTION_MESSAGES, IngestionFailure } from "./errors";
import { fetchEquitiesMaster, parseEquitiesMaster, type FetchLike } from "./jquants/equities-master";
import { apiRunSchema, type ApiRun, type RunStatus, type RunTarget } from "./runs";

/**
 * 取り込みの実行（開始・本体・終了）。手動（POST /api/ingestion/runs）と定期実行（GET /api/cron/daily）の
 * 両方がここを呼ぶ。実行履歴と市場データへの書き込みはサービスロールのクライアントで行う。
 */

/** 手動と定期実行で取り込める対象（取り込み処理があるもの）。 */
export const SUPPORTED_TARGETS = ["stock_master"] as const satisfies readonly RunTarget[];
export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

export function isSupportedTarget(value: unknown): value is SupportedTarget {
  return typeof value === "string" && (SUPPORTED_TARGETS as readonly string[]).includes(value);
}

export type StartResult = { started: true; runId: number } | { started: false; activeRun: ApiRun | null };

const startResultSchema = z.union([
  z.object({ started: z.literal(true), runId: z.number() }),
  z.object({ started: z.literal(false), activeRun: apiRunSchema.nullable() }),
]);

/**
 * 実行を「実行中」として記録する。応答の無くなった実行は「失敗」にしてから判定する。
 * ほかに実行中があれば記録しない（DB の一意制約で、同時の要求でも1つだけが記録される）。
 */
export async function startIngestionRun(
  admin: SupabaseClient,
  target: SupportedTarget,
  trigger: "manual" | "cron",
): Promise<StartResult> {
  const { data, error } = await admin.rpc("start_ingestion_run", { p_target: target, p_trigger: trigger });
  if (error) throw new Error(`start_ingestion_run に失敗しました: ${error.message}`);
  return startResultSchema.parse(data);
}

export type RunOutcome = { runId: number; target: SupportedTarget; status: RunStatus; processedCount: number };

export type RunDeps = {
  admin: SupabaseClient;
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
};

/** 失敗などで実行を終える。「実行中」の行だけを更新し、後片付け済みの行は上書きしない。 */
async function finishRun(
  admin: SupabaseClient,
  runId: number,
  status: Exclude<RunStatus, "running">,
  processedCount: number,
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

async function ingestStockMaster(runId: number, deps: RunDeps): Promise<RunOutcome> {
  const failed = (processedCount = 0): RunOutcome => ({ runId, target: "stock_master", status: "failed", processedCount });

  const apiKey = getJQuantsApiKey(deps.env);
  if (!apiKey) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.jquantsKeyMissing);
    return failed();
  }

  let parsed;
  try {
    parsed = parseEquitiesMaster(await fetchEquitiesMaster({ apiKey, fetchImpl: deps.fetchImpl }));
  } catch (error) {
    const message = error instanceof IngestionFailure ? error.message : INGESTION_MESSAGES.unexpected;
    if (!(error instanceof IngestionFailure)) console.error("[ingestion] 銘柄マスタの取得で予期しないエラー", error);
    await finishRun(deps.admin, runId, "failed", 0, message);
    return failed();
  }

  const { data, error } = await deps.admin.rpc("complete_stock_master_run", {
    p_run_id: runId,
    p_rows: parsed.rows,
    p_details: parsed.details,
  });
  if (error) {
    console.error("[ingestion] 銘柄マスタの保存に失敗しました", error.message);
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.saveFailed, parsed.details);
    return failed();
  }

  const result = z
    .union([
      z.object({ completed: z.literal(true), processedCount: z.number() }),
      z.object({ completed: z.literal(false) }),
    ])
    .parse(data);
  if (!result.completed) {
    console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、銘柄マスタを保存しませんでした`);
    return failed();
  }
  return { runId, target: "stock_master", status: "succeeded", processedCount: result.processedCount };
}

const RUNNERS: Record<SupportedTarget, (runId: number, deps: RunDeps) => Promise<RunOutcome>> = {
  stock_master: ingestStockMaster,
};

/**
 * 記録済みの実行の本体を動かす。どんな失敗でも、実行を「実行中」のまま残さない。
 */
export async function executeIngestionRun(runId: number, target: SupportedTarget, deps: RunDeps): Promise<RunOutcome> {
  try {
    return await RUNNERS[target](runId, deps);
  } catch (error) {
    console.error(`[ingestion] 実行 ${runId}（${target}）で予期しないエラー`, error);
    try {
      await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.unexpected);
    } catch (finishError) {
      console.error(`[ingestion] 実行 ${runId} を失敗として記録できませんでした`, finishError);
    }
    return { runId, target, status: "failed", processedCount: 0 };
  }
}
