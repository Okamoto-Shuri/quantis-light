import { z } from "zod";

/** 取り込みの対象・起動・結果（DB の値）と、画面の表示名。 */
export const RUN_TARGET_LABELS = {
  stock_master: "銘柄マスタ",
  daily_quotes: "株価",
  financials: "財務",
  edinet_reports: "EDINET",
} as const;

/**
 * 手動の対象・定期実行の表示の長い名前（Sprint 9 で有報の大株主・役員に、有報・届出書の主要な経営指標等を加えた）。
 * 実行履歴・ダッシュボード・実行中の表示は RUN_TARGET_LABELS の短い名前。どちらもこのファイルの1か所から出す。
 */
export const RUN_TARGET_LONG_LABELS = {
  stock_master: "銘柄マスタ",
  daily_quotes: "株価（初出日）",
  financials: "財務（決算短信）",
  edinet_reports: "EDINET（有報・届出書）",
} as const;

export const RUN_TRIGGER_LABELS = {
  cron: "定期実行",
  manual: "手動",
} as const;

export const RUN_STATUS_LABELS = {
  running: "実行中",
  succeeded: "成功",
  partial: "一部失敗",
  failed: "失敗",
} as const;

export const runTargetSchema = z.enum(["stock_master", "daily_quotes", "financials", "edinet_reports"]);
export const runTriggerSchema = z.enum(["cron", "manual"]);
export const runStatusSchema = z.enum(["running", "succeeded", "partial", "failed"]);

export type RunTarget = z.infer<typeof runTargetSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;

export const ingestionRunSchema = z.object({
  id: z.number(),
  target: runTargetSchema,
  trigger: runTriggerSchema,
  status: runStatusSchema,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  processed_count: z.number(),
  error_message: z.string().nullable(),
  /** 取り込みの補足（件数の内訳など）。API（toApiRun）には含めない。 */
  details: z.unknown().optional(),
});

export type IngestionRun = z.infer<typeof ingestionRunSchema>;

/** 取り込み状況画面に表示する件数の上限。 */
export const RUN_HISTORY_LIMIT = 50;

/**
 * 開始からこの時間以上たった「実行中」は、応答が無くなったものとみなす（次の開始時に「失敗」にする）。
 * DB 関数 public.start_ingestion_run の interval '15 minutes' と一致させる。
 */
export const STALE_RUN_MINUTES = 15;

/** 応答が無くなった（開始から STALE_RUN_MINUTES 以上たった）「実行中」の実行かどうか。 */
export function isStaleRun(run: { status: RunStatus; started_at: string }, now: Date): boolean {
  if (run.status !== "running") return false;
  const started = new Date(run.started_at).getTime();
  return now.getTime() - started >= STALE_RUN_MINUTES * 60_000;
}

/** API（GET /api/ingestion など）で返す実行の形。 */
export const apiRunSchema = z.object({
  id: z.number(),
  target: runTargetSchema,
  trigger: runTriggerSchema,
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  processedCount: z.number(),
  errorMessage: z.string().nullable(),
});

export type ApiRun = z.infer<typeof apiRunSchema>;

export function toApiRun(run: IngestionRun): ApiRun {
  return {
    id: run.id,
    target: run.target,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    processedCount: run.processed_count,
    errorMessage: run.error_message,
  };
}

/** 画面（取り込み状況）で使う実行の形。API の形に details を加える。 */
export type RunView = ApiRun & { details: unknown };

export function toRunView(run: IngestionRun): RunView {
  return { ...toApiRun(run), details: run.details ?? null };
}
