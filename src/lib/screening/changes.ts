import { z } from "zod";

import { formatDateTimeJst } from "@/lib/format";
import { RUN_TARGET_LABELS, runStatusSchema, runTargetSchema, type RunTarget } from "@/lib/ingestion/runs";
import { toJstIso } from "@/lib/stocks/annual-report";

import type { ConditionKey } from "./params";
import { CONDITION_KEY_VALUES, CONDITION_STATUSES, type ConditionStatus } from "./result";

/**
 * 新たに該当・外れた（Sprint 14。F13）の値の形と表示の文言。比較・理由の決定は DB（screening_changes。判定は screening_evaluate の1か所）で、
 * ここは形の確認と文言だけ（TypeScript に判定・比較の式を持たない）。画面（ダッシュボード・スクリーニング・ウォッチリスト）と API が共有する。
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(CONDITION_STATUSES);

export const COMPARISON_STATUSES = ["ok", "no_snapshot", "empty_snapshot"] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

export const changeReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new_stock") }),
  z.object({ kind: z.literal("relisted") }),
  z.object({ kind: z.literal("delisted") }),
  z.object({ kind: z.literal("missing") }),
  z.object({ kind: z.literal("filters") }),
  z.object({ kind: z.literal("condition"), condition: z.enum(CONDITION_KEY_VALUES), from: status, to: status }),
]);
export type ChangeReason = z.infer<typeof changeReasonSchema>;

export const stockChangeSchema = z.object({
  code: z.string(),
  company_name: z.string(),
  market_code: z.string().nullable(),
  market_name: z.string().nullable(),
  reasons: z.array(changeReasonSchema).min(1),
});
export type StockChange = z.infer<typeof stockChangeSchema>;

/** DB 関数 screening_changes の戻り値 */
export const screeningChangesSchema = z.object({
  status: z.enum(COMPARISON_STATUSES),
  snapshotId: z.number().int().nullable(),
  capturedAt: z.string().nullable(),
  cycleDate: dateString.nullable(),
  referenceDate: dateString.nullable(),
  previousReferenceDate: dateString.nullable(),
  added: z.array(stockChangeSchema),
  removed: z.array(stockChangeSchema),
});
export type ScreeningChanges = z.infer<typeof screeningChangesSchema>;

/** 比較の見出し（API の comparison） */
export type Comparison = Omit<ScreeningChanges, "added" | "removed">;

/** API の comparison（日時は日本時間の ISO） */
export function toApiComparison(changes: ScreeningChanges) {
  return {
    status: changes.status,
    snapshotId: changes.snapshotId,
    capturedAt: toJstIso(changes.capturedAt),
    cycleDate: changes.cycleDate,
    referenceDate: changes.referenceDate,
    previousReferenceDate: changes.previousReferenceDate,
  };
}

// ---------------------------------------------------------------------------
// 文言
// ---------------------------------------------------------------------------

export const CHANGE_CONDITION_NAMES: Record<ConditionKey, string> = {
  cagr: "① 売上CAGR",
  margin: "② 営業利益率",
  years: "③ 上場年数",
  owner: "④ オーナー企業／社長が筆頭株主",
};

function statusName(condition: ConditionKey, value: ConditionStatus): string {
  if (value === "met") return "満たす";
  if (value === "unmet") return "満たさない";
  if (value === "unavailable") return condition === "owner" ? "判定不能" : "算出不可";
  return "オフ";
}

/** 理由の表示（例「① 売上CAGR: 満たさない → 満たす」） */
export function changeReasonText(reason: ChangeReason): string {
  switch (reason.kind) {
    case "new_stock":
      return "新規の銘柄（前回は銘柄データなし）";
    case "relisted":
      return "上場廃止から戻った";
    case "delisted":
      return "上場廃止";
    case "missing":
      return "銘柄データなし";
    case "filters":
      return "市場区分・業種の変更";
    case "condition":
      return `${CHANGE_CONDITION_NAMES[reason.condition]}: ${statusName(reason.condition, reason.from)} → ${statusName(reason.condition, reason.to)}`;
  }
}

/** data-reason の値（例 cagr:unmet>met、delisted） */
export function changeReasonKey(reason: ChangeReason): string {
  return reason.kind === "condition" ? `${reason.condition}:${reason.from}>${reason.to}` : reason.kind;
}

/** 記録の日時の表示（日本時間の YYYY-MM-DD HH:mm） */
export function capturedAtText(capturedAt: string | null): string {
  return formatDateTimeJst(capturedAt) ?? "—";
}

/** 「直近の取り込み: 2026-09-26（20:02 開始）」 */
export function cycleCaption(changes: Pick<ScreeningChanges, "cycleDate" | "capturedAt">): string {
  const time = formatDateTimeJst(changes.capturedAt)?.slice(11) ?? "—";
  return `直近の取り込み: ${changes.cycleDate ?? "—"}（${time} 開始）`;
}

/** スクリーニングの NEW の説明 */
export function newBadgeTitle(changes: Pick<ScreeningChanges, "capturedAt">, reasons: ChangeReason[]): string {
  return `前回の取り込み（${capturedAtText(changes.capturedAt)} の開始時点）から新たに該当: ${reasons.map(changeReasonText).join("、")}`;
}

// ---------------------------------------------------------------------------
// 今回の取り込みの状況（注記）
// ---------------------------------------------------------------------------

export const cycleRunSchema = z.object({
  target: runTargetSchema,
  status: runStatusSchema,
  started_at: z.string(),
});
export type CycleRun = z.infer<typeof cycleRunSchema>;

/**
 * 記録の後に始まった実行のうち、完了していない対象（failed・partial で終わり、その後に同じ対象の succeeded が無い）。
 * runs は開始の古い順。表示の順は RUN_TARGET_LABELS の順。
 */
export function incompleteTargets(runs: readonly CycleRun[]): RunTarget[] {
  const last = new Map<RunTarget, CycleRun["status"]>();
  for (const run of runs) {
    if (run.status === "running") continue;
    last.set(run.target, run.status);
  }
  return (Object.keys(RUN_TARGET_LABELS) as RunTarget[]).filter((target) => {
    const value = last.get(target);
    return value === "failed" || value === "partial";
  });
}

export function incompleteTargetsText(targets: readonly RunTarget[]): string {
  return targets.map((target) => RUN_TARGET_LABELS[target]).join("・");
}
