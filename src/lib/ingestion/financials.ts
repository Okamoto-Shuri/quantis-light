import "server-only";

import { z } from "zod";

import { REQUEST_BUDGET_MS, systemClock } from "./clock";
import { getJQuantsApiKey } from "./config";
import { INGESTION_MESSAGES } from "./errors";
import { FailureLog, networkErrorKind, type FailureRecord } from "./failures";
import { finishRun } from "./finish";
import { createPacer, emptyRateLimitStats, RATE_LIMIT_MAX_RETRIES, type RateLimitStats } from "./pacer";
import { financialsWindow, planDisclosureDates, weekdaysBetween } from "./financials-period";
import { requestCalendarPage, type CalendarPage } from "./jquants/calendar";
import { requestFinsSummaryPage, type AnnualStatementRow, type FinsSummaryPage } from "./jquants/fins-summary";
import { failureStatus, type JQuantsFailure } from "./jquants/http";
import { jstDate } from "./listing-period";
import type { RunDeps, RunOutcome } from "./runner";
import type { RunStatus } from "./runs";

/**
 * 財務の取り込み（target = financials）。決算短信の通期の開示を、開示日（date=）ごとに全銘柄分取得する。
 *
 * 1. 取引カレンダー（/v2/markets/calendar）で、取得範囲（実行日の6年前〜実行日）の東証の営業日を求める。
 *    取得できなければ平日で代用する（キーの無効・欠如、401、429 は打ち切る）。
 * 2. 直近7日の営業日（取得済みでも取り直す）→ 未取得の営業日（新しい順）の順に、/v2/fins/summary?date= を全ページ取得する。
 * 3. 開示日ごとに、通期の開示の保存と「取得済み」の記録を1つのトランザクションで行う（DB 関数）。
 *    指標は DB のトリガーが計算し直す（アプリでは計算しない）。
 * 4. 要求の間隔は、前の要求の開始から 1,100 ミリ秒以上（/fins/summary は 60 回/分の専用枠）。
 *    期限（開始から 210 秒）を過ぎたら新しい要求を始めない。取得済みにならなかった開示日は、次の実行で処理する。
 * 5. 開示日ごとの取得の失敗が5回続いたら打ち切る。
 */

/** 要求の間隔（前の要求の開始から次の要求の開始まで）。 */
export const FINANCIALS_REQUEST_INTERVAL_MS = 1_100;
/** この回数だけ開示日の取得が続けて失敗したら打ち切る。 */
export const MAX_CONSECUTIVE_FAILURES = 5;

type StoppedReason = "time_budget" | "rate_limited" | "unauthorized" | "consecutive_failures" | "save_failed";

export type FinancialsDetails = {
  windowStart: string;
  windowEnd: string;
  calendar: "jquants" | "weekdays_fallback" | null;
  datesInWindow: number;
  datesFetchedBefore: number;
  datesFetched: number;
  datesFailed: number;
  datesRemaining: number;
  recentDates: number;
  rowsReceived: number;
  annualRows: number;
  savedStatements: number;
  skippedUnknownCode: number;
  invalidRows: number;
  apiCalls: number;
  rateLimit: RateLimitStats;
  stoppedReason: StoppedReason | null;
  lastFailedStatus: number | null;
};

const stateSchema = z.object({ stockCount: z.number(), fetchedDates: z.array(z.string()) });
const saveResultSchema = z.union([
  z.object({ saved: z.literal(true), savedCount: z.number(), unknownCodeCount: z.number() }),
  z.object({ saved: z.literal(false) }),
]);

type Exhausted = { kind: "rate_limit_exhausted"; cause: "retries" | "deadline" };
type DatePages =
  | { kind: "rows"; annual: AnnualStatementRow[]; received: number; invalid: number }
  | JQuantsFailure
  | { kind: "deadline" }
  | Exhausted;
type CalendarResult = { kind: "rows"; businessDays: string[] } | JQuantsFailure | { kind: "deadline" } | Exhausted;

function isAbortingFailure(result: { kind: string }): boolean {
  return (
    result.kind === "key_rejected" ||
    result.kind === "unauthorized" ||
    result.kind === "rate_limited" ||
    result.kind === "rate_limit_exhausted"
  );
}

function rateLimitedMessage(result: { kind: string; cause?: "retries" | "deadline" }): string {
  return result.kind === "rate_limit_exhausted" && result.cause === "deadline"
    ? INGESTION_MESSAGES.jquantsRateLimitedDeadline
    : INGESTION_MESSAGES.jquantsRateLimitedRetriesExhausted(RATE_LIMIT_MAX_RETRIES);
}

/** 開示日ごとの失敗の記録。 */
function dateFailure(date: string, result: JQuantsFailure): FailureRecord {
  const base = { itemType: "disclosure_date" as const, itemKey: date, code: null, httpStatus: null, networkError: null };
  if (result.kind === "unreachable") return { ...base, reason: "unreachable", networkError: networkErrorKind(result.reason) };
  if (result.kind === "invalid_format") return { ...base, reason: "invalid_format" };
  return { ...base, reason: "http_error", httpStatus: failureStatus(result) };
}

export async function ingestFinancials(runId: number, deps: RunDeps): Promise<RunOutcome> {
  const clock = deps.clock ?? systemClock;
  const deadline = deps.requestDeadline ?? clock.now() + REQUEST_BUDGET_MS;
  const outcome = (status: RunStatus, processedCount: number): RunOutcome => ({
    runId,
    target: "financials",
    status,
    processedCount,
  });

  const apiKey = getJQuantsApiKey(deps.env);
  if (!apiKey) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.jquantsKeyMissing);
    return outcome("failed", 0);
  }

  const runDate = jstDate(clock.now());
  const window = financialsWindow(runDate);
  const stateResult = await deps.admin.rpc("financials_ingestion_state", { p_from: window.start, p_to: window.end });
  if (stateResult.error) throw new Error(`financials_ingestion_state に失敗しました: ${stateResult.error.message}`);
  const state = stateSchema.parse(stateResult.data);
  if (state.stockCount === 0) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.financialsStockMasterEmpty);
    return outcome("failed", 0);
  }
  const fetched = new Set(state.fetchedDates);

  const details: FinancialsDetails = {
    windowStart: window.start,
    windowEnd: window.end,
    calendar: null,
    datesInWindow: 0,
    datesFetchedBefore: 0,
    datesFetched: 0,
    datesFailed: 0,
    datesRemaining: 0,
    recentDates: 0,
    rowsReceived: 0,
    annualRows: 0,
    savedStatements: 0,
    skippedUnknownCode: 0,
    invalidRows: 0,
    apiCalls: 0,
    rateLimit: emptyRateLimitStats(),
    stoppedReason: null,
    lastFailedStatus: null,
  };
  const failures = new FailureLog();

  // --- J-Quants への要求（前の要求の開始から間隔をあける。期限を過ぎたら始めない。制限の応答は待って再試行） ---
  const pacer = createPacer({ clock, deadline, intervalMs: FINANCIALS_REQUEST_INTERVAL_MS, counters: details });
  async function paced<T extends { kind: string; retryAfterSeconds?: number | null }>(
    send: () => Promise<T>,
  ): Promise<T | { kind: "deadline" } | Exhausted> {
    const result = await pacer.send(send);
    if (result.kind === "rate_limit_exhausted") return { kind: "rate_limit_exhausted", cause: (result as Exhausted).cause };
    return result as T | { kind: "deadline" };
  }

  async function fetchCalendar(): Promise<CalendarResult> {
    const days: string[] = [];
    let paginationKey: string | null = null;
    do {
      const key: string | null = paginationKey;
      const page: CalendarPage | { kind: "deadline" } | Exhausted = await paced(() =>
        requestCalendarPage({ apiKey: apiKey!, from: window.start, to: window.end, paginationKey: key, fetchImpl: deps.fetchImpl }),
      );
      if (page.kind !== "rows") return page;
      days.push(...page.businessDays);
      paginationKey = page.paginationKey;
    } while (paginationKey);
    return { kind: "rows", businessDays: days };
  }

  async function fetchDate(date: string): Promise<DatePages> {
    const annual: AnnualStatementRow[] = [];
    let received = 0;
    let invalid = 0;
    let paginationKey: string | null = null;
    do {
      const key: string | null = paginationKey;
      const page: FinsSummaryPage | { kind: "deadline" } | Exhausted = await paced(() => requestFinsSummaryPage({ apiKey: apiKey!, date, paginationKey: key, fetchImpl: deps.fetchImpl }));
      if (page.kind !== "rows") return page;
      annual.push(...page.annual);
      received += page.received;
      invalid += page.invalid;
      paginationKey = page.paginationKey;
    } while (paginationKey);
    return { kind: "rows", annual, received, invalid };
  }

  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join("。") || null;
  let processed = 0;

  let datesRemaining: number | null = null;
  async function finish(status: Exclude<RunStatus, "running">, message: string | null): Promise<RunOutcome> {
    await finishRun(deps.admin, runId, status, processed, message, details, {
      stoppedReason: details.stoppedReason,
      remainingCount: datesRemaining,
      remainingUnit: "disclosure_dates",
      failures,
    });
    return outcome(status, processed);
  }

  // --- 1. 取引カレンダー ---
  const calendar = await fetchCalendar();
  let businessDays: string[];
  if (calendar.kind === "rows") {
    details.calendar = "jquants";
    businessDays = calendar.businessDays.filter((date) => date >= window.start && date <= window.end);
  } else if (calendar.kind === "deadline") {
    details.stoppedReason = "time_budget";
    return finish("failed", INGESTION_MESSAGES.financialsTimeBudgetExceeded(0));
  } else if (isAbortingFailure(calendar)) {
    // 打ち切りの原因の HTTP ステータスも、開示日の失敗と同じく記録する（Sprint 5 評価の Q1）
    const limited = calendar.kind === "rate_limited" || calendar.kind === "rate_limit_exhausted";
    details.lastFailedStatus = limited ? 429 : failureStatus(calendar as JQuantsFailure);
    details.stoppedReason = limited ? "rate_limited" : "unauthorized";
    return finish(
      "failed",
      limited ? rateLimitedMessage(calendar) : INGESTION_MESSAGES.jquantsUnauthorized((calendar as { status: number }).status),
    );
  } else {
    // 500・形式の違いなど: 平日で代用する（この実行に限る）
    console.warn(`[ingestion] 取引カレンダーを取得できなかったため、平日で代用します（${calendar.kind}）`);
    details.calendar = "weekdays_fallback";
    businessDays = weekdaysBetween(window.start, window.end);
  }

  const { queue, recent } = planDisclosureDates({ businessDays, fetched, runDate });
  const inWindow = new Set(businessDays);
  details.datesInWindow = inWindow.size;
  details.datesFetchedBefore = [...inWindow].filter((date) => fetched.has(date)).length;
  details.recentDates = recent.length;

  // --- 2. 開示日ごとの取得と保存 ---
  let consecutiveFailures = 0;
  let stopMessage: string | null = null;
  let aborted = false;
  for (const date of queue) {
    const result = await fetchDate(date);
    if (result.kind === "deadline") {
      details.stoppedReason = "time_budget";
      break;
    }
    if (result.kind === "rows") {
      consecutiveFailures = 0;
      const { data, error } = await deps.admin.rpc("save_financial_statements", {
        p_run_id: runId,
        p_disclosure_date: date,
        p_rows: result.annual,
        p_received_count: result.received,
      });
      if (error) {
        console.error("[ingestion] 財務情報の保存に失敗しました", error.message);
        details.stoppedReason = "save_failed";
        stopMessage = INGESTION_MESSAGES.financialsSaveFailed;
        break;
      }
      const saved = saveResultSchema.parse(data);
      if (!saved.saved) {
        console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、財務情報を保存しませんでした`);
        aborted = true;
        break;
      }
      processed += saved.savedCount;
      fetched.add(date);
      details.datesFetched += 1;
      details.rowsReceived += result.received;
      details.annualRows += result.annual.length;
      details.savedStatements += saved.savedCount;
      details.skippedUnknownCode += saved.unknownCodeCount;
      details.invalidRows += result.invalid;
      continue;
    }

    if (result.kind === "rate_limit_exhausted" || result.kind === "rate_limited") {
      details.lastFailedStatus = 429;
      details.stoppedReason = "rate_limited";
      stopMessage = rateLimitedMessage(result);
      break;
    }
    details.lastFailedStatus = failureStatus(result);
    if (result.kind === "key_rejected" || result.kind === "unauthorized") {
      details.stoppedReason = "unauthorized";
      stopMessage = INGESTION_MESSAGES.jquantsUnauthorized(result.status);
      break;
    }
    // 400、キー以外の 403、210、500 など、接続できない、形式の違い: その開示日だけ失敗
    failures.add(dateFailure(date, result));
    details.datesFailed += 1;
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      details.stoppedReason = "consecutive_failures";
      const last = details.lastFailedStatus === null ? "接続または形式の失敗" : `HTTP ${details.lastFailedStatus}`;
      stopMessage = INGESTION_MESSAGES.financialsConsecutiveFailures(MAX_CONSECUTIVE_FAILURES, last);
      break;
    }
  }

  details.datesRemaining = [...inWindow].filter((date) => !fetched.has(date)).length;
  datesRemaining = details.datesRemaining;
  if (aborted) return outcome("failed", processed);

  // --- 3. 結果 ---
  const failedNote =
    details.datesFailed > 0 && details.stoppedReason !== "consecutive_failures"
      ? INGESTION_MESSAGES.financialsDatesFailed(details.datesFailed)
      : null;
  const invalidNote = details.invalidRows > 0 ? INGESTION_MESSAGES.financialsInvalidRows(details.invalidRows) : null;
  const progressed = details.datesFetched > 0;

  switch (details.stoppedReason) {
    case null: {
      if (details.datesFailed > 0 && !progressed) return finish("failed", failedNote);
      const status = details.datesFailed > 0 || details.invalidRows > 0 ? "partial" : "succeeded";
      return finish(status, join(failedNote, invalidNote));
    }
    case "time_budget":
      // 取得できた開示日が0なら「失敗」（ほかの打ち切りの理由とそろえる。Sprint 5 評価の Q2）
      return finish(progressed ? "partial" : "failed", join(INGESTION_MESSAGES.financialsTimeBudgetExceeded(details.datesRemaining), failedNote, invalidNote));
    case "consecutive_failures":
      return finish(progressed ? "partial" : "failed", join(stopMessage, invalidNote));
    case "rate_limited":
    case "unauthorized":
    case "save_failed": {
      if (!progressed) return finish("failed", stopMessage);
      return finish(
        "partial",
        join(stopMessage, INGESTION_MESSAGES.financialsRemainingNext(details.datesRemaining), failedNote, invalidNote),
      );
    }
  }
}

