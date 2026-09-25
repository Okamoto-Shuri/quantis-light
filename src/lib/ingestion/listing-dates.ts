import "server-only";

import { z } from "zod";

import { REQUEST_BUDGET_MS, systemClock } from "./clock";
import { getJQuantsApiKey } from "./config";
import { INGESTION_MESSAGES } from "./errors";
import { FailureLog, networkErrorKind, type FailureRecord } from "./failures";
import { finishRun } from "./finish";
import { requestBarsPage, type BarRow, type BarsPage, type BarsQuery } from "./jquants/bars-daily";
import { addDays, DATA_START_PROBE_DAYS, dataStartProbeFrom, jstDate } from "./listing-period";
import { createPacer, emptyRateLimitStats, RATE_LIMIT_MAX_RETRIES, type RateLimitStats } from "./pacer";
import type { RunDeps, RunOutcome } from "./runner";
import type { RunStatus } from "./runs";

/**
 * 株価の初出日の取り込み（target = daily_quotes）。
 *
 * 1. 銘柄マスタにあって初出日の行が無い銘柄（未確定）だけを対象にする。確定済みの銘柄には API を呼ばない（AC4.4）。
 * 2. データ期間の開始日 W を探す: 実行日の10年前の翌日から1日ずつ `date=` で最大 14 日分を試し、最初に行のある日を W にする。
 *    W の日に現れた銘柄は「データ期間開始以前から上場」（初出日 = データ期間の開始日 = W）として保存する。
 * 3. 残りの銘柄は `code=<コード>&from=W` をページ送りも含めて取得し、最も古い日付を初出日にする。
 * 4. 要求の間隔は 600 ミリ秒以上。期限（ルートの開始から 210 秒）を過ぎたら新しい要求を始めず、一部失敗で終える。
 *    行の無い銘柄だけを処理するので、次の実行で自然に続きから再開する。
 */

/** J-Quants への要求の最小の間隔（Standard は 120 回/分。100 回/分以下にする）。 */
export const REQUEST_INTERVAL_MS = 600;
/** 保存のまとまりの大きさ。 */
export const SAVE_BATCH_SIZE = 50;
/** この数だけ銘柄の取得が続けて失敗したら打ち切る（Sprint 12。J-Quants 側の全面的な障害のとき）。 */
export const PRICES_MAX_CONSECUTIVE_FAILURES = 5;

type StoppedReason = "time_budget" | "rate_limited" | "unauthorized" | "save_failed" | "consecutive_failures";

type ProbeRecord = { date: string; status: number | null; rows: number };

export type DailyQuotesDetails = {
  pending: number;
  dataStartDate: string | null;
  savedBeforeDataStart: number;
  savedWithinDataPeriod: number;
  noPriceData: number;
  failed: number;
  remaining: number;
  apiCalls: number;
  rateLimit: RateLimitStats;
  stoppedReason: StoppedReason | null;
  dataStartProbe: ProbeRecord[];
};

type ListingRow = { code: string; first_price_date: string; data_start_date: string };

const pendingSchema = z.object({ stockCount: z.number(), pending: z.array(z.string()) });
const saveResultSchema = z.union([
  z.object({ saved: z.literal(true), insertedCount: z.number() }),
  z.object({ saved: z.literal(false) }),
]);

/** ページ送りも含めた取得の結果。 */
type FetchAllResult =
  | { kind: "rows"; rows: BarRow[] }
  | Exclude<BarsPage, { kind: "rows" }>
  | { kind: "deadline" }
  | { kind: "rate_limit_exhausted"; cause: "retries" | "deadline" };

/** 銘柄ごとの失敗の記録（応答の本文は含めない）。 */
function stockFailure(code: string, result: FetchAllResult): FailureRecord {
  const base = { itemType: "stock" as const, itemKey: code, code, httpStatus: null, networkError: null };
  switch (result.kind) {
    case "http_error":
    case "key_rejected":
    case "unauthorized":
      return { ...base, reason: "http_error", httpStatus: result.status };
    case "unreachable":
      return { ...base, reason: "unreachable", networkError: networkErrorKind(result.reason) };
    default:
      return { ...base, reason: "invalid_format" };
  }
}

function describeLast(result: FetchAllResult): string {
  switch (result.kind) {
    case "http_error":
      return `HTTP ${result.status}`;
    case "unreachable":
      return "接続の失敗";
    default:
      return "形式の違い";
  }
}

function pageStatus(page: FetchAllResult): number | null {
  switch (page.kind) {
    case "rows":
      return 200;
    case "no_content":
      return 210;
    case "key_rejected":
    case "unauthorized":
    case "http_error":
      return page.status;
    case "rate_limited":
      return 429;
    default:
      return null;
  }
}

export async function ingestDailyQuotes(runId: number, deps: RunDeps): Promise<RunOutcome> {
  const clock = deps.clock ?? systemClock;
  const deadline = deps.requestDeadline ?? clock.now() + REQUEST_BUDGET_MS;
  const batchSize = deps.saveBatchSize ?? SAVE_BATCH_SIZE;
  const outcome = (status: RunStatus, processedCount: number): RunOutcome => ({
    runId,
    target: "daily_quotes",
    status,
    processedCount,
  });

  const apiKey = getJQuantsApiKey(deps.env);
  if (!apiKey) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.jquantsKeyMissing);
    return outcome("failed", 0);
  }

  const pendingResult = await deps.admin.rpc("listing_dates_pending");
  if (pendingResult.error) throw new Error(`listing_dates_pending に失敗しました: ${pendingResult.error.message}`);
  const { stockCount, pending } = pendingSchema.parse(pendingResult.data);
  if (stockCount === 0) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.stockMasterEmpty);
    return outcome("failed", 0);
  }

  const details: DailyQuotesDetails = {
    pending: pending.length,
    dataStartDate: null,
    savedBeforeDataStart: 0,
    savedWithinDataPeriod: 0,
    noPriceData: 0,
    failed: 0,
    remaining: pending.length,
    apiCalls: 0,
    rateLimit: emptyRateLimitStats(),
    stoppedReason: null,
    dataStartProbe: [],
  };
  const failures = new FailureLog();
  if (pending.length === 0) {
    await finishRun(deps.admin, runId, "succeeded", 0, null, details, { remainingCount: 0, remainingUnit: "stocks" });
    return outcome("succeeded", 0);
  }

  // --- J-Quants への要求（間隔・期限・呼び出しの制限での再試行） ---
  const pacer = createPacer({ clock, deadline, intervalMs: REQUEST_INTERVAL_MS, counters: details, deadlineCheck: "before_wait" });
  async function fetchAll(query: BarsQuery): Promise<FetchAllResult> {
    const rows: BarRow[] = [];
    let paginationKey: string | null = null;
    do {
      const key: string | null = paginationKey;
      const page: BarsPage | { kind: "deadline" } | { kind: "rate_limit_exhausted"; cause: "retries" | "deadline" } = await pacer.send(() => requestBarsPage({ apiKey: apiKey!, query, paginationKey: key, fetchImpl: deps.fetchImpl }));
      if (page.kind === "rate_limit_exhausted") return { kind: "rate_limit_exhausted", cause: page.cause };
      if (page.kind !== "rows") return page;
      rows.push(...page.rows);
      paginationKey = page.paginationKey;
    } while (paginationKey);
    return { kind: "rows", rows };
  }

  // --- 保存（まとまりごと） ---
  let processed = 0;
  let aborted = false;
  async function save(rows: ListingRow[], kind: "before" | "within"): Promise<boolean> {
    if (rows.length === 0) return true;
    const { data, error } = await deps.admin.rpc("save_stock_listing_dates", { p_run_id: runId, p_rows: rows });
    if (error) {
      console.error("[ingestion] 株価の初出日の保存に失敗しました", error.message);
      details.stoppedReason = "save_failed";
      return false;
    }
    const result = saveResultSchema.parse(data);
    if (!result.saved) {
      console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、株価の初出日を保存しませんでした`);
      aborted = true;
      return false;
    }
    processed += result.insertedCount;
    if (kind === "before") details.savedBeforeDataStart += rows.length;
    else details.savedWithinDataPeriod += rows.length;
    return true;
  }

  const settle = () => {
    details.remaining =
      details.pending -
      details.savedBeforeDataStart -
      details.savedWithinDataPeriod -
      details.noPriceData -
      details.failed;
  };

  const record = () => ({
    stoppedReason: details.stoppedReason,
    remainingCount: details.remaining,
    remainingUnit: "stocks" as const,
    failures,
  });

  async function fail(message: string, reason: StoppedReason | null = null): Promise<RunOutcome> {
    details.stoppedReason = reason;
    settle();
    await finishRun(deps.admin, runId, "failed", processed, message, details, record());
    return outcome("failed", processed);
  }

  const rateLimitedMessage = (cause: "retries" | "deadline") =>
    cause === "retries"
      ? INGESTION_MESSAGES.jquantsRateLimitedRetriesExhausted(RATE_LIMIT_MAX_RETRIES)
      : INGESTION_MESSAGES.jquantsRateLimitedDeadline;

  // --- データ期間の開始日 W ---
  const probeFrom = dataStartProbeFrom(jstDate(clock.now()));
  let dataStart: string | null = null;
  let snapshot: Set<string> | null = null;
  for (let i = 0; i < DATA_START_PROBE_DAYS; i += 1) {
    const date = addDays(probeFrom, i);
    const result = await fetchAll({ date });
    if (result.kind === "deadline") break;
    details.dataStartProbe.push({ date, status: pageStatus(result), rows: result.kind === "rows" ? result.rows.length : 0 });

    switch (result.kind) {
      case "rows":
        if (result.rows.length > 0) {
          dataStart = date;
          snapshot = new Set(result.rows.map((row) => row.code));
        }
        break;
      case "no_content":
        break;
      case "http_error":
        // 400 と、キー以外の 403 は、期間外の日付への応答とみなして次の日へ
        if (result.status === 400 || result.status === 403) break;
        return fail(INGESTION_MESSAGES.jquantsUnexpectedStatus(result.status));
      case "key_rejected":
      case "unauthorized":
        return fail(INGESTION_MESSAGES.jquantsUnauthorized(result.status), "unauthorized");
      case "rate_limit_exhausted":
        return fail(rateLimitedMessage(result.cause), "rate_limited");
      case "rate_limited":
        return fail(rateLimitedMessage("retries"), "rate_limited");
      case "unreachable":
        return fail(INGESTION_MESSAGES.jquantsUnreachable(result.reason));
      case "invalid_format":
        return fail(INGESTION_MESSAGES.jquantsInvalidFormat);
    }
    if (dataStart) break;
  }

  if (!dataStart || !snapshot) {
    if (details.dataStartProbe.length < DATA_START_PROBE_DAYS) {
      // 探索の途中で期限を過ぎた
      details.stoppedReason = "time_budget";
      settle();
      await finishRun(
        deps.admin,
        runId,
        "partial",
        processed,
        INGESTION_MESSAGES.timeBudgetExceeded(details.remaining),
        details,
        record(),
      );
      return outcome("partial", processed);
    }
    const last = details.dataStartProbe.at(-1)!;
    const lastResponse = last.status === 200 ? "HTTP 200（0件）" : `HTTP ${last.status}`;
    return fail(INGESTION_MESSAGES.dataStartNotFound(DATA_START_PROBE_DAYS, lastResponse));
  }
  details.dataStartDate = dataStart;
  const W = dataStart;
  const inSnapshot = snapshot;

  // --- W の日に上場していた銘柄（データ期間開始以前から上場） ---
  const before = pending.filter((code) => inSnapshot.has(code));
  for (let i = 0; i < before.length && !details.stoppedReason && !aborted; i += batchSize) {
    await save(
      before.slice(i, i + batchSize).map((code) => ({ code, first_price_date: W, data_start_date: W })),
      "before",
    );
  }

  // --- W より後に上場した銘柄（コード別に最も古い日付） ---
  let queue: ListingRow[] = [];
  let stopMessage: string | null = null;
  let consecutiveFailures = 0;
  const failStock = (code: string, result: FetchAllResult, failure?: FailureRecord) => {
    details.failed += 1;
    failures.add(failure ?? stockFailure(code, result));
    consecutiveFailures += 1;
    if (consecutiveFailures >= PRICES_MAX_CONSECUTIVE_FAILURES) {
      details.stoppedReason = "consecutive_failures";
      stopMessage = INGESTION_MESSAGES.pricesConsecutiveFailures(PRICES_MAX_CONSECUTIVE_FAILURES, describeLast(result));
    }
  };
  const rest = pending.filter((code) => !inSnapshot.has(code));
  for (const code of rest) {
    if (details.stoppedReason || aborted) break;
    const result = await fetchAll({ code, from: W });
    if (result.kind === "deadline") {
      details.stoppedReason = "time_budget";
      break;
    }
    if (result.kind === "rows") {
      if (result.rows.length === 0) {
        details.noPriceData += 1;
        consecutiveFailures = 0;
      } else if (result.rows.some((row) => row.code !== code)) {
        // 別の銘柄の行が混ざっている（形式の違い）
        failStock(code, result, { itemType: "stock", itemKey: code, code, reason: "row_mismatch", httpStatus: null, networkError: null });
      } else {
        const first = result.rows.reduce((min, row) => (row.date < min ? row.date : min), result.rows[0].date);
        if (first < W) {
          failStock(code, { kind: "invalid_format" }); // from=W より前の行（形式の違い）
        } else {
          queue.push({ code, first_price_date: first, data_start_date: W });
          consecutiveFailures = 0;
        }
      }
    } else if (result.kind === "no_content") {
      details.noPriceData += 1;
      consecutiveFailures = 0;
    } else if (result.kind === "key_rejected" || result.kind === "unauthorized") {
      details.stoppedReason = "unauthorized";
      stopMessage = INGESTION_MESSAGES.jquantsUnauthorized(result.status);
    } else if (result.kind === "rate_limit_exhausted" || result.kind === "rate_limited") {
      details.stoppedReason = "rate_limited";
      stopMessage = rateLimitedMessage(result.kind === "rate_limit_exhausted" ? result.cause : "retries");
    } else {
      failStock(code, result); // 400、キー以外の 403、500 など、接続できない、形式の違い
    }

    if (queue.length >= batchSize) {
      const batch = queue;
      queue = [];
      if (!(await save(batch, "within"))) break;
    }
  }
  if (!aborted && details.stoppedReason !== "save_failed") {
    await save(queue, "within");
  }

  if (aborted) return outcome("failed", processed);

  // --- 結果 ---
  settle();
  const failedNote = details.failed > 0 ? INGESTION_MESSAGES.pricesFailed(details.failed) : null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join("。");
  let status: Exclude<RunStatus, "running">;
  let message: string | null;
  switch (details.stoppedReason) {
    case null:
      status = details.failed > 0 ? "partial" : "succeeded";
      message = failedNote;
      break;
    case "time_budget":
      status = "partial";
      message = join(INGESTION_MESSAGES.timeBudgetExceeded(details.remaining), failedNote);
      break;
    case "consecutive_failures":
      status = processed > 0 ? "partial" : "failed";
      message = status === "partial" ? join(stopMessage, INGESTION_MESSAGES.remainingNext(details.remaining)) : stopMessage;
      break;
    case "rate_limited":
    case "unauthorized":
    case "save_failed": {
      const base = details.stoppedReason === "save_failed" ? INGESTION_MESSAGES.listingDatesSaveFailed : stopMessage!;
      status = processed > 0 ? "partial" : "failed";
      message =
        status === "partial" ? join(base, INGESTION_MESSAGES.remainingNext(details.remaining), failedNote) : base;
      break;
    }
  }
  await finishRun(deps.admin, runId, status, processed, message, details, record());
  return outcome(status, processed);
}
