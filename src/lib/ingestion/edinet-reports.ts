import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { REQUEST_BUDGET_MS, systemClock } from "./clock";
import { getEdinetApiKey } from "./config";
import { extractAnnualReport, noXbrlExtraction, type AnnualReportExtraction } from "./edinet/annual-report";
import {
  extractBusinessDescription,
  isBusinessDescriptionConcept,
  noXbrlBusinessDescription,
  type BusinessDescriptionExtraction,
} from "./edinet/business-description";
import { extractBusinessResults, noXbrlBusinessResults, type BusinessResultsExtraction } from "./edinet/business-results";
import { readDocumentArchive, type ArchiveResult } from "./edinet/document-archive";
import { fetchDocumentList } from "./edinet/documents-list";
import { failureStatus, isAbortingFailure, requestEdinetZip, type EdinetFailure } from "./edinet/http";
import { readInlineXbrl } from "./edinet/xbrl";
import { edinetWindow, planListDates } from "./edinet-period";
import { INGESTION_MESSAGES } from "./errors";
import { FailureLog, networkErrorKind, type FailureRecord } from "./failures";
import { finishRun } from "./finish";
import { createPacer, emptyRateLimitStats, RATE_LIMIT_MAX_RETRIES, type RateLimitStats } from "./pacer";
import { jstDate } from "./listing-period";
import type { RunDeps, RunOutcome, SupportedTarget } from "./runner";
import type { RunStatus } from "./runs";

/**
 * EDINET の取り込みの骨組み（書類一覧 → 対象の書類の選択 → 本文の処理）と、有報の大株主・役員の取り込み（target = edinet_reports）。
 *
 * 1. 書類一覧: 直近7日（毎回）→ 期間（実行日の 450 日前〜実行日）の未取得の日（新しい順）。日付ごとに、書類のメタデータの保存と
 *    「取得済み」の記録を1トランザクションで行う。期限・打ち切りで一覧を取り終えていなければ、本文の取得に進まない。
 * 2. 本文: DB（区画ごとの書類の選び方のビュー）が返す「本文を取得する書類」を、提出日時の新しい順に取得して処理する。
 *    訂正報告書にその区画が無いと分かると、元の書類が新たに対象になるので、対象が無くなるまで繰り返す。
 * 3. 要求の間隔は、前の要求の開始から 1,000 ミリ秒以上。期限（ルートの開始から 210 秒）を過ぎたら新しい要求を始めない。
 *    取得の失敗が5回続いたら打ち切る。キーの無効・呼び出しの制限・リダイレクトはすぐに打ち切る。
 *    本文は EDINET_DOCUMENT_CONCURRENCY 通まで同時に取得する（開始の間隔は同じ）。抽出と保存は1書類ずつ順に行う。
 *
 * Sprint 9（上場前の期の補完）: 同じ target・同じ本文の取得で、書類ごとに2つの処理を行う（有報の大株主・役員と、有報・届出書の
 * 「主要な経営指標等の推移」）。本文を取得するのは、どちらかの処理が未処理の書類だけ。取得したら未処理の処理だけを行い、
 * 1つのトランザクションで保存する（処理件数は書類ごとに1）。
 *
 * Sprint 16（事業の内容）: 有報・訂正有報の「事業の内容」の最初の段落を、3つ目の処理として同じ本文から読む。
 * 事業の内容だけが未処理の有報（導入前に大株主・役員などを処理済みのもの）も1回だけ取得し、事業の内容だけを保存する。
 */

export const EDINET_REQUEST_INTERVAL_MS = 1_000;
/**
 * 本文（書類取得 API の ZIP）を同時に取得する数。ZIP の取得は1通 約 2〜7 秒（実測）で、要求の間隔（1 秒）より長いので、
 * 順に取得すると間隔ではなく応答の待ちで遅くなる。開始の間隔は変えずに、応答を待つ間に次の要求を始める。
 * 書類一覧は順に取得する（取下書より前に元の書類を保存するため）。
 */
export const EDINET_DOCUMENT_CONCURRENCY = 4;
export const EDINET_MAX_CONSECUTIVE_FAILURES = 5;
/**
 * 書類の保存（save_edinet_extractions）が文のタイムアウト（SQLSTATE 57014。API 経由の文は 8 秒まで）で失敗したとき、
 * 待ってから保存し直す回数と待ち時間。保存は再計算のトリガーを含めて1トランザクションなので、打ち切られた保存は何も残さず、
 * やり直しても二重に書かない。本番（2026-10-07）では、ほかの重い問い合わせと重なった1回だけが 8 秒を超えて実行が止まった。
 */
export const EDINET_SAVE_TIMEOUT_RETRIES = 1;
export const EDINET_SAVE_RETRY_DELAY_MS = 2_000;

/** 保存の関数（RPC）の失敗。PostgreSQL の SQLSTATE（PostgREST の error.code）を持つ。 */
export class EdinetSaveError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "EdinetSaveError";
  }
}

const isStatementTimeout = (error: unknown) => error instanceof EdinetSaveError && error.code === "57014";

type StoppedReason = "time_budget" | "rate_limited" | "unauthorized" | "redirect" | "consecutive_failures" | "save_failed";

export type EdinetDetails = {
  windowStart: string;
  windowEnd: string;
  listDatesInWindow: number;
  listDatesFetchedBefore: number;
  listDatesFetched: number;
  listDatesFailed: number;
  listDatesRemaining: number;
  documentsListed: Record<string, number>;
  listRowsSkipped: number;
  listRowsInvalid: number;
  withdrawnUpdated: number;
  withheldUpdated: number;
  documentsTargeted: number;
  documentsProcessed: number;
  extraction: {
    shareholders: Record<string, number>;
    officers: Record<string, number>;
  };
  /** 大株主・役員とも抽出できた書類の数と、どちらかを抽出できなかった書類の数 */
  documentsBothExtracted: number;
  documentsNotExtracted: number;
  /** Sprint 9: 主要な経営指標等の抽出の結果ごとの書類の数、保存した期の数、読まなかった事実の数 */
  businessResults: Record<string, number>;
  businessResultsPeriods: number;
  businessResultsDiscardedFacts: number;
  /** Sprint 16: 事業の内容の抽出の結果ごとの書類の数と、読まなかった事実の数 */
  businessDescription: Record<string, number>;
  businessDescriptionDiscardedFacts: number;
  /** Sprint 9・16: 最初の対象のうち、処理ごとの未処理の書類の数 */
  documentsTargetedByKind: { annualReport: number; businessResults: number; businessDescription: number };
  /** Sprint 9: 一覧から更新した提出者と証券コードの対応の数 */
  filersUpdated: number;
  fallbackDocuments: number;
  documentsFailed: number;
  documentsRemaining: number;
  discardedFacts: number;
  apiCalls: number;
  rateLimit: RateLimitStats;
  /** 書類の保存を文のタイムアウトのために保存し直した回数 */
  saveRetries: number;
  stoppedReason: StoppedReason | null;
  lastFailedStatus: number | null;
};

export type DocumentTask = {
  docId: string;
  code: string | null;
  xbrlAvailable: boolean;
  /** 大株主・役員の抽出が未処理（有報・訂正有報だけ） */
  needsAnnualReport: boolean;
  /** 主要な経営指標等の抽出が未処理 */
  needsBusinessResults: boolean;
  /** 事業の内容の抽出が未処理（有報・訂正有報だけ。Sprint 16） */
  needsBusinessDescription: boolean;
};

/** 取り込みの対象の選び方と書類ごとの処理。 */
export type EdinetPipeline<Payload> = {
  target: SupportedTarget;
  loadState(admin: SupabaseClient, window: { start: string; end: string }): Promise<{
    stockCount: number;
    fetchedDates: string[];
    targets: DocumentTask[];
  }>;
  /** 本文（ZIP を読んだ結果）から保存する内容を作る。XBRL が無い書類（xbrlFlag = 0）は archive が null。 */
  process(archive: ArchiveResult | null, task: DocumentTask): Payload;
  /** 1書類の結果を保存する（実行の処理件数を1足す）。実行が終わっていたら false。 */
  save(admin: SupabaseClient, runId: number, task: DocumentTask, payload: Payload): Promise<boolean>;
  /** 保存した内容を details に数える。 */
  count(details: EdinetDetails, payload: Payload): void;
};

const stateSchema = z.object({
  stockCount: z.number(),
  fetchedDates: z.array(z.string()),
  targets: z.array(
    z.object({
      docId: z.string(),
      code: z.string().nullable(),
      xbrlAvailable: z.boolean(),
      needsAnnualReport: z.boolean(),
      needsBusinessResults: z.boolean(),
      needsBusinessDescription: z.boolean(),
    }),
  ),
});

const listSaveSchema = z.union([
  z.object({
    saved: z.literal(true),
    upserted: z.number(),
    withdrawnUpdated: z.number(),
    disclosureUpdated: z.number(),
    filersUpdated: z.number(),
  }),
  z.object({ saved: z.literal(false) }),
]);

/** 失敗の記録（書類一覧の日・書類）。応答の本文・URL は含めない。 */
function edinetFailure(itemType: "list_date" | "document", itemKey: string, code: string | null, failure: EdinetFailure): FailureRecord {
  const base = { itemType, itemKey, code, httpStatus: null, networkError: null };
  switch (failure.kind) {
    case "unreachable":
      return { ...base, reason: "unreachable", networkError: networkErrorKind(failure.reason) };
    case "pdf_returned":
      return { ...base, reason: "pdf_returned" };
    case "invalid_format": {
      const status = failureStatus(failure);
      return status === null ? { ...base, reason: "invalid_format" } : { ...base, reason: "http_error", httpStatus: status };
    }
    case "not_found":
      return { ...base, reason: "not_found", httpStatus: 404 };
    default:
      return { ...base, reason: "http_error", httpStatus: failureStatus(failure) };
  }
}

type Exhausted = { kind: "rate_limit_exhausted"; cause: "retries" | "deadline"; last: EdinetFailure };

function stopMessageFor(failure: EdinetFailure | Exhausted): { reason: StoppedReason; message: string } {
  if (failure.kind === "rate_limit_exhausted") {
    const status = failure.last.kind === "rate_limited" ? failure.last.status : 429;
    return {
      reason: "rate_limited",
      message:
        failure.cause === "deadline"
          ? INGESTION_MESSAGES.edinetRateLimitedDeadline(status)
          : INGESTION_MESSAGES.edinetRateLimitedRetriesExhausted(status, RATE_LIMIT_MAX_RETRIES),
    };
  }
  if (failure.kind === "unauthorized") return { reason: "unauthorized", message: INGESTION_MESSAGES.edinetUnauthorized };
  if (failure.kind === "rate_limited") {
    return { reason: "rate_limited", message: INGESTION_MESSAGES.edinetRateLimitedRetriesExhausted(failure.status, RATE_LIMIT_MAX_RETRIES) };
  }
  return { reason: "redirect", message: INGESTION_MESSAGES.edinetRedirect };
}

/** EDINET の取り込みの骨組み。 */
export async function runEdinetPipeline<Payload>(
  runId: number,
  deps: RunDeps,
  pipeline: EdinetPipeline<Payload>,
): Promise<RunOutcome> {
  const clock = deps.clock ?? systemClock;
  const deadline = deps.requestDeadline ?? clock.now() + REQUEST_BUDGET_MS;
  const outcome = (status: RunStatus, processedCount: number): RunOutcome => ({
    runId,
    target: pipeline.target,
    status,
    processedCount,
  });

  const apiKey = getEdinetApiKey(deps.env);
  if (!apiKey) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.edinetKeyMissing);
    return outcome("failed", 0);
  }

  const runDate = jstDate(clock.now());
  const window = edinetWindow(runDate);
  let state = await pipeline.loadState(deps.admin, window);
  if (state.stockCount === 0) {
    await finishRun(deps.admin, runId, "failed", 0, INGESTION_MESSAGES.edinetStockMasterEmpty);
    return outcome("failed", 0);
  }
  const fetched = new Set(state.fetchedDates);
  const { queue, inWindow } = planListDates({ runDate, fetched });

  const details: EdinetDetails = {
    windowStart: window.start,
    windowEnd: window.end,
    listDatesInWindow: inWindow.length,
    listDatesFetchedBefore: inWindow.filter((date) => fetched.has(date)).length,
    listDatesFetched: 0,
    listDatesFailed: 0,
    listDatesRemaining: 0,
    documentsListed: {},
    listRowsSkipped: 0,
    listRowsInvalid: 0,
    withdrawnUpdated: 0,
    withheldUpdated: 0,
    documentsTargeted: 0,
    documentsProcessed: 0,
    extraction: { shareholders: {}, officers: {} },
    documentsBothExtracted: 0,
    documentsNotExtracted: 0,
    businessResults: {},
    businessResultsPeriods: 0,
    businessResultsDiscardedFacts: 0,
    businessDescription: {},
    businessDescriptionDiscardedFacts: 0,
    documentsTargetedByKind: { annualReport: 0, businessResults: 0, businessDescription: 0 },
    filersUpdated: 0,
    fallbackDocuments: 0,
    documentsFailed: 0,
    saveRetries: 0,
    documentsRemaining: 0,
    discardedFacts: 0,
    apiCalls: 0,
    rateLimit: emptyRateLimitStats(),
    stoppedReason: null,
    lastFailedStatus: null,
  };

  const failures = new FailureLog();

  // --- 要求の間隔（前の要求の開始から）と期限。呼び出しの制限（429・503）は待って再試行する ---
  const pacer = createPacer({ clock, deadline, intervalMs: EDINET_REQUEST_INTERVAL_MS, counters: details });
  async function paced<T extends { kind: string; retryAfterSeconds?: number | null }>(
    send: () => Promise<T>,
    cancelled?: () => boolean,
  ): Promise<T | { kind: "deadline" } | Exhausted> {
    const result = await pacer.send(send, { cancelled });
    if (result.kind === "rate_limit_exhausted") {
      const exhausted = result as { cause: "retries" | "deadline"; last: unknown };
      return { kind: "rate_limit_exhausted", cause: exhausted.cause, last: exhausted.last as EdinetFailure };
    }
    return result as T | { kind: "deadline" };
  }

  let processed = 0;
  let consecutiveFailures = 0;
  let stopMessage: string | null = null;
  let aborted = false;
  let listInvalidFormat = false;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join("。") || null;
  const lastResponse = () => (details.lastFailedStatus === null ? "接続または形式の失敗" : `HTTP ${details.lastFailedStatus}`);

  // --- 1. 書類一覧 ---
  for (const date of queue) {
    const result = await paced(() => fetchDocumentList({ date, apiKey, fetchImpl: deps.fetchImpl }));
    if (result.kind === "deadline") {
      details.stoppedReason = "time_budget";
      break;
    }
    if (result.kind === "ok") {
      consecutiveFailures = 0;
      const { data, error } = await deps.admin.rpc("save_edinet_document_list", {
        p_run_id: runId,
        p_list_date: date,
        p_documents: result.documents,
        p_withdrawn: result.withdrawn,
        p_disclosure: result.disclosure,
        p_filers: result.filers,
        p_received_count: result.received,
      });
      if (error) {
        console.error("[ingestion] 書類一覧の保存に失敗しました", error.message);
        details.stoppedReason = "save_failed";
        stopMessage = INGESTION_MESSAGES.edinetSaveFailed;
        break;
      }
      const saved = listSaveSchema.parse(data);
      if (!saved.saved) {
        console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、書類一覧を保存しませんでした`);
        aborted = true;
        break;
      }
      fetched.add(date);
      details.listDatesFetched += 1;
      for (const doc of result.documents) {
        details.documentsListed[doc.doc_type_code] = (details.documentsListed[doc.doc_type_code] ?? 0) + 1;
      }
      details.listRowsSkipped += result.skipped;
      details.listRowsInvalid += result.invalidRows;
      details.withdrawnUpdated += saved.withdrawnUpdated;
      details.withheldUpdated += saved.disclosureUpdated;
      details.filersUpdated += saved.filersUpdated;
      continue;
    }

    if (result.kind === "rate_limit_exhausted") {
      details.lastFailedStatus = failureStatus(result.last);
      const stop = stopMessageFor(result);
      details.stoppedReason = stop.reason;
      stopMessage = stop.message;
      break;
    }
    details.lastFailedStatus = failureStatus(result);
    if (isAbortingFailure(result)) {
      const stop = stopMessageFor(result);
      details.stoppedReason = stop.reason;
      stopMessage = stop.message;
      break;
    }
    if (result.kind === "invalid_format") listInvalidFormat = true;
    failures.add(edinetFailure("list_date", date, null, result));
    details.listDatesFailed += 1;
    consecutiveFailures += 1;
    if (consecutiveFailures >= EDINET_MAX_CONSECUTIVE_FAILURES) {
      details.stoppedReason = "consecutive_failures";
      stopMessage = INGESTION_MESSAGES.edinetConsecutiveFailures(EDINET_MAX_CONSECUTIVE_FAILURES, lastResponse());
      break;
    }
  }
  details.listDatesRemaining = inWindow.filter((date) => !fetched.has(date)).length;
  if (aborted) return outcome("failed", processed);

  // --- 2. 本文（一覧を取り終えたときだけ） ---
  const failedThisRun = new Set<string>();
  if (details.stoppedReason === null) {
    consecutiveFailures = 0;
    const attempted = new Set<string>();

    /** 打ち切る。期限より後に分かった打ち切りの理由（キーの無効など）は、期限の理由を置き換える。 */
    const stopWith = (reason: StoppedReason, message: string | null) => {
      if (details.stoppedReason !== null && details.stoppedReason !== "time_budget") return;
      details.stoppedReason = reason;
      stopMessage = message;
    };
    const halted = () => details.stoppedReason !== null || aborted;

    /** 失敗を記録する。続けての失敗が上限に達したら打ち切る。 */
    const recordFailure = (task: DocumentTask, failure: FailureRecord, lastLabel: () => string) => {
      failedThisRun.add(task.docId);
      details.documentsFailed += 1;
      failures.add(failure);
      consecutiveFailures += 1;
      if (consecutiveFailures >= EDINET_MAX_CONSECUTIVE_FAILURES) {
        stopWith("consecutive_failures", INGESTION_MESSAGES.edinetConsecutiveFailures(EDINET_MAX_CONSECUTIVE_FAILURES, lastLabel()));
      }
    };

    /** 本文を取得する。取得できなければ undefined（失敗・打ち切りは記録済み）。XBRL の無い書類は要求せずに null。 */
    const fetchArchive = async (task: DocumentTask): Promise<ArchiveResult | null | undefined> => {
      if (!task.xbrlAvailable) return null;
      const response = await paced(
        () => requestEdinetZip({ path: `/documents/${encodeURIComponent(task.docId)}`, params: { type: "1" }, apiKey, fetchImpl: deps.fetchImpl }),
        halted,
      );
      if (response.kind === "deadline") {
        // ほかの取得の打ち切りで始めなかったときは、その理由のまま
        if (!halted()) stopWith("time_budget", null);
        return undefined;
      }
      if (response.kind === "rate_limit_exhausted") {
        details.lastFailedStatus = failureStatus(response.last);
        const stop = stopMessageFor(response);
        stopWith(stop.reason, stop.message);
        return undefined;
      }
      if (response.kind !== "ok") {
        details.lastFailedStatus = failureStatus(response);
        if (isAbortingFailure(response)) {
          const stop = stopMessageFor(response);
          stopWith(stop.reason, stop.message);
          return undefined;
        }
        recordFailure(task, edinetFailure("document", task.docId, task.code, response), lastResponse);
        return undefined;
      }
      const archive = readDocumentArchive(response.bytes);
      if (archive.kind === "invalid_archive") {
        // ZIP のシグネチャはあるが読めない: 取得の失敗として扱う（次の実行で再試行）
        const failure: FailureRecord = { itemType: "document", itemKey: task.docId, code: task.code, reason: "invalid_archive", httpStatus: null, networkError: null };
        recordFailure(task, failure, () => "形式の違い");
        return undefined;
      }
      return archive;
    };

    /** 文のタイムアウトなら待って保存し直す（ほかの失敗はそのまま投げる）。 */
    const saveWithRetry = async (task: DocumentTask, payload: Payload): Promise<boolean> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await pipeline.save(deps.admin, runId, task, payload);
        } catch (error) {
          if (!isStatementTimeout(error) || attempt >= EDINET_SAVE_TIMEOUT_RETRIES) throw error;
          console.warn(`[ingestion] 書類 ${task.docId} の保存が文のタイムアウトで失敗したため、保存し直します`);
          details.saveRetries += 1;
          await clock.sleep(EDINET_SAVE_RETRY_DELAY_MS);
        }
      }
    };

    /** 抽出して保存する（1書類ずつ順に。再計算のトリガーが同じ銘柄で同時に動かないように）。 */
    let saveQueue: Promise<void> = Promise.resolve();
    const processAndSave = (task: DocumentTask, archive: ArchiveResult | null): Promise<void> => {
      const next = saveQueue.then(async () => {
        // 保存の失敗・実行の終了の後は保存しない（ほかの打ち切りでは、取得できた書類は保存する）
        if (aborted || details.stoppedReason === "save_failed") return;
        const payload = pipeline.process(archive, task);
        let saved: boolean;
        try {
          saved = await saveWithRetry(task, payload);
        } catch (error) {
          console.error("[ingestion] 書類の抽出の結果の保存に失敗しました", error instanceof Error ? error.message : "不明");
          details.stoppedReason = "save_failed";
          stopMessage = INGESTION_MESSAGES.edinetSaveFailed;
          return;
        }
        if (!saved) {
          console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、書類の抽出の結果を保存しませんでした`);
          aborted = true;
          return;
        }
        processed += 1;
        details.documentsProcessed += 1;
        pipeline.count(details, payload);
      });
      saveQueue = next;
      return next;
    };

    /**
     * 対象の書類を EDINET_DOCUMENT_CONCURRENCY 通まで同時に取得する。要求の開始は対象の順で、間隔は pacer が保つ。
     * 打ち切ったら新しい書類を始めず、取得中の書類は待つ（取得できたものは保存する）。
     */
    const fetchDocumentsConcurrently = async (targets: DocumentTask[]) => {
      // 同じ実行で同じ書類を二度取得しない（訂正の区画の補いで対象を読み直すとき）。打ち切ったら繰り返さないので、始めなかった書類も含めてよい
      for (const task of targets) attempted.add(task.docId);
      let next = 0;
      const worker = async () => {
        while (!halted() && next < targets.length) {
          const task = targets[next++];
          const archive = await fetchArchive(task);
          if (archive === undefined) continue;
          consecutiveFailures = 0;
          await processAndSave(task, archive);
        }
      };
      await Promise.all(Array.from({ length: Math.min(EDINET_DOCUMENT_CONCURRENCY, targets.length) }, () => worker()));
    };

    let firstRound = true;
    while (true) {
      state = await pipeline.loadState(deps.admin, window);
      const targets = state.targets.filter((task) => !attempted.has(task.docId));
      if (firstRound) {
        details.documentsTargeted = targets.length;
        details.documentsTargetedByKind = {
          annualReport: targets.filter((task) => task.needsAnnualReport).length,
          businessResults: targets.filter((task) => task.needsBusinessResults).length,
          businessDescription: targets.filter((task) => task.needsBusinessDescription).length,
        };
        firstRound = false;
      } else {
        details.fallbackDocuments += targets.length;
      }
      if (targets.length === 0) break;

      await fetchDocumentsConcurrently(targets);
      if (details.stoppedReason !== null || aborted) break;
    }
    if (aborted) return outcome("failed", processed);
  }

  // 残りの書類（未処理の対象。一覧を取り終えていないときは、今分かっている分だけ）
  try {
    state = await pipeline.loadState(deps.admin, window);
    details.documentsRemaining = state.targets.length;
  } catch (error) {
    console.error("[ingestion] 残りの書類を数えられませんでした", error instanceof Error ? error.message : "不明");
  }

  // --- 3. 結果 ---
  const progressed = details.listDatesFetched > 0 || processed > 0;
  const listFailedNote =
    details.listDatesFailed > 0 && details.stoppedReason !== "consecutive_failures"
      ? join(listInvalidFormat ? INGESTION_MESSAGES.edinetInvalidFormat : null, INGESTION_MESSAGES.edinetListDatesFailed(details.listDatesFailed))
      : null;
  const docsFailedNote =
    details.documentsFailed > 0 && details.stoppedReason !== "consecutive_failures"
      ? INGESTION_MESSAGES.edinetDocumentsFailed(details.documentsFailed)
      : null;
  const remainingNote =
    details.listDatesRemaining > 0
      ? INGESTION_MESSAGES.edinetListRemainingNext(details.listDatesRemaining)
      : details.documentsRemaining > 0
        ? INGESTION_MESSAGES.edinetDocumentsRemainingNext(details.documentsRemaining)
        : null;

  const listRemaining = details.listDatesRemaining > 0;
  const finish = async (status: Exclude<RunStatus, "running">, message: string | null) => {
    await finishRun(deps.admin, runId, status, processed, message, details, {
      stoppedReason: details.stoppedReason,
      remainingCount: listRemaining ? details.listDatesRemaining : details.documentsRemaining,
      remainingUnit: listRemaining ? "list_dates" : "documents",
      failures,
    });
    return outcome(status, processed);
  };

  switch (details.stoppedReason) {
    case null: {
      const failures = details.listDatesFailed > 0 || details.documentsFailed > 0;
      if (failures && !progressed) return finish("failed", join(listFailedNote, docsFailedNote));
      return finish(failures ? "partial" : "succeeded", join(listFailedNote, docsFailedNote));
    }
    case "time_budget": {
      const message =
        details.listDatesRemaining > 0
          ? INGESTION_MESSAGES.edinetListTimeBudgetExceeded(details.listDatesRemaining)
          : INGESTION_MESSAGES.edinetDocumentsTimeBudgetExceeded(details.documentsRemaining);
      return finish(progressed ? "partial" : "failed", join(message, listFailedNote, docsFailedNote));
    }
    default: {
      if (!progressed) return finish("failed", join(stopMessage, listInvalidFormat ? INGESTION_MESSAGES.edinetInvalidFormat : null));
      return finish("partial", join(stopMessage, remainingNote, listFailedNote, docsFailedNote));
    }
  }
}

// ---------------------------------------------------------------------------
// EDINET（target = edinet_reports）: 有報の大株主・役員（Sprint 8）と、有報・届出書の主要な経営指標等（Sprint 9）
// ---------------------------------------------------------------------------

export type EdinetDocumentPayload = {
  annualReport: AnnualReportExtraction | null;
  businessResults: BusinessResultsExtraction | null;
  businessDescription: BusinessDescriptionExtraction | null;
};

function extractFromArchive(archive: ArchiveResult | null, task: DocumentTask): EdinetDocumentPayload {
  if (archive === null) {
    return {
      annualReport: task.needsAnnualReport ? noXbrlExtraction("xbrl_flag_off") : null,
      businessResults: task.needsBusinessResults ? noXbrlBusinessResults("xbrl_flag_off") : null,
      businessDescription: task.needsBusinessDescription ? noXbrlBusinessDescription("xbrl_flag_off") : null,
    };
  }
  if (archive.kind !== "ok") {
    const detail = archive.kind === "no_xbrl" ? archive.detail : "invalid_archive";
    return {
      annualReport: task.needsAnnualReport ? noXbrlExtraction(detail) : null,
      businessResults: task.needsBusinessResults ? noXbrlBusinessResults(detail) : null,
      businessDescription: task.needsBusinessDescription ? noXbrlBusinessDescription(detail) : null,
    };
  }
  // 1つの ZIP の XBRL は1回だけ解析し、3つの抽出に使う（事業の内容のテキストブロックだけ本文の構造も読む）
  const xbrl = readInlineXbrl(archive.documents, task.needsBusinessDescription ? { textBlocks: isBusinessDescriptionConcept } : {});
  return {
    annualReport: task.needsAnnualReport ? extractAnnualReport(xbrl) : null,
    businessResults: task.needsBusinessResults ? extractBusinessResults(xbrl) : null,
    businessDescription: task.needsBusinessDescription ? extractBusinessDescription(xbrl) : null,
  };
}

const extractionSaveSchema = z.object({ saved: z.boolean(), reason: z.string().optional() });

export const edinetDocumentsPipeline: EdinetPipeline<EdinetDocumentPayload> = {
  target: "edinet_reports",
  async loadState(admin, window) {
    const { data, error } = await admin.rpc("edinet_ingestion_state", { p_from: window.start, p_to: window.end });
    if (error) throw new Error(`edinet_ingestion_state に失敗しました: ${error.message}`);
    return stateSchema.parse(data);
  },
  process: extractFromArchive,
  async save(admin, runId, task, payload) {
    let annualReport: Omit<AnnualReportExtraction, "discardedFacts"> | null = null;
    if (payload.annualReport) {
      const { discardedFacts: _discarded, ...rest } = payload.annualReport;
      void _discarded;
      annualReport = rest;
    }
    let businessResults: Omit<BusinessResultsExtraction, "discardedFacts"> | null = null;
    if (payload.businessResults) {
      const { discardedFacts: _discarded, ...rest } = payload.businessResults;
      void _discarded;
      businessResults = rest;
    }
    let businessDescription: Omit<BusinessDescriptionExtraction, "discardedFacts"> | null = null;
    if (payload.businessDescription) {
      const { discardedFacts: _discarded, ...rest } = payload.businessDescription;
      void _discarded;
      businessDescription = rest;
    }
    const { data, error } = await admin.rpc("save_edinet_extractions", {
      p_run_id: runId,
      p_doc_id: task.docId,
      p_annual_report: annualReport,
      p_business_results: businessResults,
      p_business_description: businessDescription,
    });
    if (error) throw new EdinetSaveError(error.message, error.code ?? null);
    const parsed = extractionSaveSchema.parse(data);
    if (!parsed.saved && parsed.reason === "unknown_document") throw new Error("書類のメタデータがありません");
    return parsed.saved;
  },
  count(details, payload) {
    const bump = (record: Record<string, number>, key: string) => (record[key] = (record[key] ?? 0) + 1);
    const annual = payload.annualReport;
    if (annual) {
      bump(details.extraction.shareholders, annual.shareholdersStatus);
      bump(details.extraction.officers, annual.officersStatus);
      if (annual.shareholdersStatus === "ok" && annual.officersStatus === "ok") details.documentsBothExtracted += 1;
      else details.documentsNotExtracted += 1;
      details.discardedFacts += annual.discardedFacts;
    }
    const business = payload.businessResults;
    if (business) {
      bump(details.businessResults, business.status);
      details.businessResultsPeriods += business.periods.length;
      details.businessResultsDiscardedFacts += business.discardedFacts;
    }
    const description = payload.businessDescription;
    if (description) {
      bump(details.businessDescription, description.status);
      details.businessDescriptionDiscardedFacts += description.discardedFacts;
    }
  },
};

export function ingestEdinetReports(runId: number, deps: RunDeps): Promise<RunOutcome> {
  return runEdinetPipeline(runId, deps, edinetDocumentsPipeline);
}
