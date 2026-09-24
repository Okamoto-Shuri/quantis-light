import { z } from "zod";

/** 取り込みの対象・起動・結果（DB の値）と、画面の表示名。 */
export const RUN_TARGET_LABELS = {
  stock_master: "銘柄マスタ",
  daily_quotes: "株価",
  financials: "財務",
  edinet_reports: "有報",
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
});

export type IngestionRun = z.infer<typeof ingestionRunSchema>;

/** 取り込み状況画面に表示する件数の上限。 */
export const RUN_HISTORY_LIMIT = 50;
