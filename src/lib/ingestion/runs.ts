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

/** 打ち切りの理由（ingestion_runs.stopped_reason。契約 sprint-12 の第2章の1）。 */
export const stoppedReasonSchema = z.enum([
  "time_budget",
  "stale",
  "rate_limited",
  "unauthorized",
  "redirect",
  "consecutive_failures",
  "save_failed",
  "delisting_held",
]);
export type StoppedReason = z.infer<typeof stoppedReasonSchema>;

/** 残りの単位（ingestion_runs.remaining_unit）。 */
export const remainingUnitSchema = z.enum(["stocks", "disclosure_dates", "list_dates", "documents"]);
export type RemainingUnit = z.infer<typeof remainingUnitSchema>;

/** 「残り N 銘柄」などの表示。 */
export function formatRemaining(count: number, unit: RemainingUnit): string {
  const n = count.toLocaleString("ja-JP");
  switch (unit) {
    case "stocks":
      return `残り ${n} 銘柄`;
    case "disclosure_dates":
      return `残り ${n} 日分`;
    case "list_dates":
      return `残り ${n} 日分の書類一覧`;
    case "documents":
      return `残り ${n} 件の書類`;
  }
}

/**
 * 残りを数えられない実行か（Sprint 13。Sprint 12 評価の改善提案）: 応答が無くなって中断した一部完了（partial・stale）で、
 * 残りの件数が記録されていないもの。実行履歴・実行の詳細に「残り 不明」と出す。
 */
export function isRemainingUnknown(run: { status: string; stopped_reason?: string | null; remaining_count?: number | null }): boolean {
  return run.status === "partial" && run.stopped_reason === "stale" && (run.remaining_count ?? null) === null;
}

/** 未取得の残りの注記の1項目（「財務 20 日分」など）。 */
export function formatRemainingShort(target: RunTarget, count: number, unit: RemainingUnit): string {
  const n = count.toLocaleString("ja-JP");
  const label = target === "edinet_reports" ? "EDINET" : RUN_TARGET_LABELS[target];
  switch (unit) {
    case "stocks":
      return `${label} ${n} 銘柄`;
    case "disclosure_dates":
      return `${label} ${n} 日分`;
    case "list_dates":
      return `${label} ${n} 日分の書類一覧`;
    case "documents":
      return `${label} ${n} 件の書類`;
  }
}

/** 中断の理由の説明（実行の詳細）。 */
export const STOPPED_REASON_LABELS: Record<StoppedReason, string> = {
  time_budget: "時間の上限（210 秒）に達したため",
  stale: "応答が無くなったため（15 分以上）",
  rate_limited: "呼び出し回数の制限が解消しなかったため",
  unauthorized: "API キーが無効か、契約プランでは利用できないため",
  redirect: "予期しないリダイレクトがあったため",
  consecutive_failures: "取得の失敗が続いたため",
  save_failed: "保存に失敗したため",
  delisting_held: "上場廃止の反映を保留したため",
};

export type PartialKind = "incomplete" | "failed";

/**
 * 「一部完了」（incomplete）と「一部失敗」（failed）の区別。partial で、失敗が0件で、時間切れか応答なしで止まった実行は一部完了。
 * 新しい列の無い、過去の partial の行は一部失敗のまま。
 */
export function partialKindOf(run: {
  status: RunStatus;
  stoppedReason?: StoppedReason | null;
  failedCount?: number | null;
}): PartialKind | null {
  if (run.status !== "partial") return null;
  const incomplete =
    (run.failedCount ?? 0) === 0 && (run.stoppedReason === "time_budget" || run.stoppedReason === "stale");
  return incomplete ? "incomplete" : "failed";
}

export const PARTIAL_KIND_LABELS: Record<PartialKind, string> = { incomplete: "一部完了", failed: "一部失敗" };

/** 結果の表示名（一部完了を含む）。 */
export function runStatusLabel(status: RunStatus, partialKind: PartialKind | null): string {
  return status === "partial" && partialKind ? PARTIAL_KIND_LABELS[partialKind] : RUN_STATUS_LABELS[status];
}

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
  stopped_reason: stoppedReasonSchema.nullable().optional(),
  remaining_count: z.number().nullable().optional(),
  remaining_unit: remainingUnitSchema.nullable().optional(),
  failed_count: z.number().nullable().optional(),
});

/** 実行履歴の select の列。 */
export const RUN_COLUMNS =
  "id, target, trigger, status, started_at, finished_at, processed_count, error_message, details, stopped_reason, remaining_count, remaining_unit, failed_count";

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

/** 実行の開始の関数（start_ingestion_run）が返す、実行中の実行の形。 */
export const startedRunSchema = z.object({
  id: z.number(),
  target: runTargetSchema,
  trigger: runTriggerSchema,
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  processedCount: z.number(),
  errorMessage: z.string().nullable(),
});

export type StartedRun = z.infer<typeof startedRunSchema>;

/** API（GET /api/ingestion など）で返す実行の形（Sprint 12 で打ち切りの理由・残り・失敗の件数を加えた）。 */
export const apiRunSchema = startedRunSchema.extend({
  stoppedReason: stoppedReasonSchema.nullable(),
  remainingCount: z.number().nullable(),
  remainingUnit: remainingUnitSchema.nullable(),
  failedCount: z.number(),
  partialKind: z.enum(["incomplete", "failed"]).nullable(),
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
    stoppedReason: run.stopped_reason ?? null,
    remainingCount: run.remaining_count ?? null,
    remainingUnit: run.remaining_count === null || run.remaining_count === undefined ? null : (run.remaining_unit ?? null),
    failedCount: run.failed_count ?? 0,
    partialKind: partialKindOf({ status: run.status, stoppedReason: run.stopped_reason, failedCount: run.failed_count }),
  };
}

/** 画面（取り込み状況）で使う実行の形。API の形に details を加える。 */
export type RunView = ApiRun & { details: unknown };

export function toRunView(run: IngestionRun): RunView {
  return { ...toApiRun(run), details: run.details ?? null };
}

/**
 * 比較の基準の記録（Sprint 14）の結果。定期実行の銘柄マスタの開始で、details.snapshot に "captured" か "failed" が入る
 * （実行の終了でも残る）。それ以外の実行は null。
 */
export function runSnapshotStatus(details: unknown): "captured" | "failed" | null {
  if (typeof details !== "object" || details === null) return null;
  const value = (details as { snapshot?: unknown }).snapshot;
  return value === "captured" || value === "failed" ? value : null;
}

export const SNAPSHOT_FAILED_MESSAGE = "比較の基準（前回の取り込み時点）を記録できませんでした。前回の記録で比較します";
