import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getJQuantsApiKey } from "./config";
import { INGESTION_MESSAGES, IngestionFailure } from "./errors";
import { REQUEST_BUDGET_MS as BUDGET_MS, systemClock as defaultClock, type Clock } from "./clock";
import { finishRun } from "./finish";
import { EQUITIES_MASTER_URL, parseEquitiesMaster, type FetchLike } from "./jquants/equities-master";
import { requestJQuants } from "./jquants/http";
import { createPacer, emptyRateLimitStats, RATE_LIMIT_MAX_RETRIES } from "./pacer";
import { ingestEdinetReports } from "./edinet-reports";
import { ingestFinancials } from "./financials";
import { ingestDailyQuotes } from "./listing-dates";
import { startedRunSchema, type RunStatus, type RunTarget, type StartedRun } from "./runs";

/**
 * 取り込みの実行（開始・本体・終了）。手動（POST /api/ingestion/runs）と定期実行（GET /api/cron/daily・/api/cron/financials）の
 * 両方がここを呼ぶ。実行履歴と市場データへの書き込みはサービスロールのクライアントで行う。
 */

/** 手動と定期実行で取り込める対象（取り込み処理があるもの）。 */
export const SUPPORTED_TARGETS = ["stock_master", "daily_quotes", "financials", "edinet_reports"] as const satisfies readonly RunTarget[];
export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

export function isSupportedTarget(value: unknown): value is SupportedTarget {
  return typeof value === "string" && (SUPPORTED_TARGETS as readonly string[]).includes(value);
}

export { REQUEST_BUDGET_MS, systemClock, type Clock } from "./clock";

export type StartResult = { started: true; runId: number } | { started: false; activeRun: StartedRun | null };

const startResultSchema = z.union([
  z.object({ started: z.literal(true), runId: z.number() }),
  z.object({ started: z.literal(false), activeRun: startedRunSchema.nullable() }),
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
  clock?: Clock;
  /** この時刻（ミリ秒）を過ぎたら、外部 API への新しい要求を始めない。省略時は実行の開始から REQUEST_BUDGET_MS。 */
  requestDeadline?: number;
  /** 株価の初出日を保存するまとまりの大きさ（テスト用。既定 50）。 */
  saveBatchSize?: number;
};

/** 銘柄マスタの要求の間隔（株価と同じ枠）。1回の要求なので、制限の応答の再試行の間隔にだけ効く。 */
const STOCK_MASTER_INTERVAL_MS = 600;

async function ingestStockMaster(runId: number, deps: RunDeps): Promise<RunOutcome> {
  const result = (status: RunStatus, processedCount = 0): RunOutcome => ({ runId, target: "stock_master", status, processedCount });
  const failed = (processedCount = 0) => result("failed", processedCount);

  const apiKey = getJQuantsApiKey(deps.env);
  if (!apiKey) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.jquantsKeyMissing);
    return failed();
  }

  // 1回の要求。呼び出しの制限（429）は待って再試行する（Sprint 12）
  const clock = deps.clock ?? defaultClock;
  const deadline = deps.requestDeadline ?? clock.now() + BUDGET_MS;
  const counters = { apiCalls: 0, rateLimit: emptyRateLimitStats() };
  const pacer = createPacer({ clock, deadline, intervalMs: STOCK_MASTER_INTERVAL_MS, counters });
  const response = await pacer.send(() => requestJQuants({ url: EQUITIES_MASTER_URL, apiKey, fetchImpl: deps.fetchImpl }));

  let failure: { message: string; stoppedReason?: "rate_limited" | "unauthorized" | "time_budget" } | null = null;
  switch (response.kind) {
    case "ok":
      break;
    case "deadline":
      failure = { message: INGESTION_MESSAGES.stockMasterTimeBudget, stoppedReason: "time_budget" };
      break;
    case "rate_limit_exhausted":
      failure = {
        message:
          response.cause === "deadline"
            ? INGESTION_MESSAGES.jquantsRateLimitedDeadline
            : INGESTION_MESSAGES.jquantsRateLimitedRetriesExhausted(RATE_LIMIT_MAX_RETRIES),
        stoppedReason: "rate_limited",
      };
      break;
    case "rate_limited":
      failure = { message: INGESTION_MESSAGES.jquantsRateLimitedRetriesExhausted(RATE_LIMIT_MAX_RETRIES), stoppedReason: "rate_limited" };
      break;
    case "key_rejected":
    case "unauthorized":
      failure = { message: INGESTION_MESSAGES.jquantsUnauthorized(response.status), stoppedReason: "unauthorized" };
      break;
    case "http_error":
      // 銘柄マスタは、キー以外の 403 も「キーが無効か、契約プランでは利用できない」とする（Sprint 3 のまま）
      failure = {
        message:
          response.status === 403
            ? INGESTION_MESSAGES.jquantsUnauthorized(403)
            : INGESTION_MESSAGES.jquantsUnexpectedStatus(response.status),
      };
      break;
    case "no_content":
      failure = { message: INGESTION_MESSAGES.jquantsUnexpectedStatus(210) };
      break;
    case "unreachable":
      failure = { message: INGESTION_MESSAGES.jquantsUnreachable(response.reason) };
      break;
    case "invalid_format":
      failure = { message: INGESTION_MESSAGES.jquantsInvalidFormat };
      break;
  }
  if (failure || response.kind !== "ok") {
    const f = failure ?? { message: INGESTION_MESSAGES.unexpected };
    await finishRun(deps.admin, runId, "failed", 0, f.message, counters, { stoppedReason: f.stoppedReason ?? null });
    return failed();
  }

  let parsed;
  try {
    parsed = parseEquitiesMaster(response.json);
  } catch (error) {
    const message = error instanceof IngestionFailure ? error.message : INGESTION_MESSAGES.unexpected;
    if (!(error instanceof IngestionFailure)) console.error("[ingestion] 銘柄マスタの解析で予期しないエラー", error);
    await finishRun(deps.admin, runId, "failed", 0, message, counters);
    return failed();
  }

  const details = { ...parsed.details, ...counters };
  const { data, error } = await deps.admin.rpc("complete_stock_master_run", {
    p_run_id: runId,
    p_rows: parsed.rows,
    p_details: details,
  });
  if (error) {
    console.error("[ingestion] 銘柄マスタの保存に失敗しました", error.message);
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.saveFailed, details);
    return failed();
  }

  const saved = z
    .union([
      z.object({ completed: z.literal(true), processedCount: z.number(), delistingHeld: z.boolean().optional() }),
      z.object({ completed: z.literal(false) }),
    ])
    .parse(data);
  if (!saved.completed) {
    console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、銘柄マスタを保存しませんでした`);
    return failed();
  }
  return result(saved.delistingHeld ? "partial" : "succeeded", saved.processedCount);
}

const RUNNERS: Record<SupportedTarget, (runId: number, deps: RunDeps) => Promise<RunOutcome>> = {
  stock_master: ingestStockMaster,
  daily_quotes: ingestDailyQuotes,
  financials: ingestFinancials,
  edinet_reports: ingestEdinetReports,
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
      // 処理件数は変えない（株価の取り込みは、保存したまとまりの件数をすでに記録している）
      await finishRun(deps.admin, runId, "failed", null, INGESTION_MESSAGES.unexpected);
    } catch (finishError) {
      console.error(`[ingestion] 実行 ${runId} を失敗として記録できませんでした`, finishError);
    }
    return { runId, target, status: "failed", processedCount: 0 };
  }
}
