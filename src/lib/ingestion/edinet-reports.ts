import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { REQUEST_BUDGET_MS, systemClock } from "./clock";
import { getEdinetApiKey } from "./config";
import { extractAnnualReport, noXbrlExtraction, type AnnualReportExtraction } from "./edinet/annual-report";
import { readDocumentArchive, type ArchiveResult } from "./edinet/document-archive";
import { fetchDocumentList } from "./edinet/documents-list";
import { failureStatus, isAbortingFailure, requestEdinetZip, type EdinetFailure } from "./edinet/http";
import { readInlineXbrl } from "./edinet/xbrl";
import { edinetWindow, planListDates } from "./edinet-period";
import { INGESTION_MESSAGES } from "./errors";
import { finishRun } from "./finish";
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
 *
 * Sprint 9（上場前の期の補完）は、runEdinetPipeline に別の「対象の選び方」と「書類ごとの処理」を渡して使う。
 */

export const EDINET_REQUEST_INTERVAL_MS = 1_000;
export const EDINET_MAX_CONSECUTIVE_FAILURES = 5;
/** details.failedDocuments に残す書類の上限 */
export const FAILED_DOCUMENTS_LIMIT = 50;

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
  fallbackDocuments: number;
  documentsFailed: number;
  failedDocuments: { docId: string; reason: string }[];
  documentsRemaining: number;
  discardedFacts: number;
  apiCalls: number;
  stoppedReason: StoppedReason | null;
  lastFailedStatus: number | null;
};

export type DocumentTask = { docId: string; code: string | null; xbrlAvailable: boolean };

/** 取り込みの対象の選び方と書類ごとの処理（Sprint 8 は大株主・役員、Sprint 9 は主要な経営指標等の推移）。 */
export type EdinetPipeline<Payload> = {
  target: SupportedTarget;
  loadState(admin: SupabaseClient, window: { start: string; end: string }): Promise<{
    stockCount: number;
    fetchedDates: string[];
    targets: DocumentTask[];
  }>;
  /** 本文（ZIP を読んだ結果）から保存する内容を作る。XBRL が無い書類（xbrlFlag = 0）は archive が null。 */
  process(archive: ArchiveResult | null): Payload;
  /** 1書類の結果を保存する（実行の処理件数を1足す）。実行が終わっていたら false。 */
  save(admin: SupabaseClient, runId: number, docId: string, payload: Payload): Promise<boolean>;
  /** 保存した内容を details に数える。 */
  count(details: EdinetDetails, payload: Payload): void;
};

const stateSchema = z.object({
  stockCount: z.number(),
  fetchedDates: z.array(z.string()),
  targets: z.array(z.object({ docId: z.string(), code: z.string().nullable(), xbrlAvailable: z.boolean() })),
});

const listSaveSchema = z.union([
  z.object({ saved: z.literal(true), upserted: z.number(), withdrawnUpdated: z.number(), disclosureUpdated: z.number() }),
  z.object({ saved: z.literal(false) }),
]);

function describeFailure(failure: EdinetFailure): string {
  const status = failureStatus(failure);
  if (status !== null) return `HTTP ${status}`;
  if (failure.kind === "unreachable") return failure.reason;
  if (failure.kind === "pdf_returned") return "PDF の応答（不開示の書類など）";
  return "形式の違い（ZIP でない応答）";
}

function stopMessageFor(failure: EdinetFailure): { reason: StoppedReason; message: string } {
  if (failure.kind === "unauthorized") return { reason: "unauthorized", message: INGESTION_MESSAGES.edinetUnauthorized };
  if (failure.kind === "rate_limited") return { reason: "rate_limited", message: INGESTION_MESSAGES.edinetRateLimited(failure.status) };
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
    fallbackDocuments: 0,
    documentsFailed: 0,
    failedDocuments: [],
    documentsRemaining: 0,
    discardedFacts: 0,
    apiCalls: 0,
    stoppedReason: null,
    lastFailedStatus: null,
  };

  // --- 要求の間隔（前の要求の開始から）と期限 ---
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  async function paced<T>(send: () => Promise<T>): Promise<T | { kind: "deadline" }> {
    const wait = lastRequestAt + EDINET_REQUEST_INTERVAL_MS - clock.now();
    if (wait > 0) await clock.sleep(wait);
    if (clock.now() >= deadline) return { kind: "deadline" };
    lastRequestAt = clock.now();
    details.apiCalls += 1;
    return send();
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
      continue;
    }

    details.lastFailedStatus = failureStatus(result);
    if (isAbortingFailure(result)) {
      const stop = stopMessageFor(result);
      details.stoppedReason = stop.reason;
      stopMessage = stop.message;
      break;
    }
    if (result.kind === "invalid_format") listInvalidFormat = true;
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
    let firstRound = true;
    documents: while (true) {
      state = await pipeline.loadState(deps.admin, window);
      const targets = state.targets.filter((task) => !attempted.has(task.docId));
      if (firstRound) {
        details.documentsTargeted = targets.length;
        firstRound = false;
      } else {
        details.fallbackDocuments += targets.length;
      }
      if (targets.length === 0) break;

      for (const task of targets) {
        attempted.add(task.docId);
        let archive: ArchiveResult | null = null;
        if (task.xbrlAvailable) {
          const response = await paced(() =>
            requestEdinetZip({ path: `/documents/${encodeURIComponent(task.docId)}`, params: { type: "1" }, apiKey, fetchImpl: deps.fetchImpl }),
          );
          if (response.kind === "deadline") {
            details.stoppedReason = "time_budget";
            break documents;
          }
          if (response.kind !== "ok") {
            details.lastFailedStatus = failureStatus(response);
            if (isAbortingFailure(response)) {
              const stop = stopMessageFor(response);
              details.stoppedReason = stop.reason;
              stopMessage = stop.message;
              break documents;
            }
            failedThisRun.add(task.docId);
            details.documentsFailed += 1;
            if (details.failedDocuments.length < FAILED_DOCUMENTS_LIMIT) {
              details.failedDocuments.push({ docId: task.docId, reason: describeFailure(response) });
            }
            consecutiveFailures += 1;
            if (consecutiveFailures >= EDINET_MAX_CONSECUTIVE_FAILURES) {
              details.stoppedReason = "consecutive_failures";
              stopMessage = INGESTION_MESSAGES.edinetConsecutiveFailures(EDINET_MAX_CONSECUTIVE_FAILURES, lastResponse());
              break documents;
            }
            continue;
          }
          archive = readDocumentArchive(response.bytes);
          if (archive.kind === "invalid_archive") {
            // ZIP のシグネチャはあるが読めない: 取得の失敗として扱う（次の実行で再試行）
            failedThisRun.add(task.docId);
            details.documentsFailed += 1;
            if (details.failedDocuments.length < FAILED_DOCUMENTS_LIMIT) {
              details.failedDocuments.push({ docId: task.docId, reason: "ZIP を読めない" });
            }
            consecutiveFailures += 1;
            if (consecutiveFailures >= EDINET_MAX_CONSECUTIVE_FAILURES) {
              details.stoppedReason = "consecutive_failures";
              stopMessage = INGESTION_MESSAGES.edinetConsecutiveFailures(EDINET_MAX_CONSECUTIVE_FAILURES, "形式の違い");
              break documents;
            }
            continue;
          }
        }
        consecutiveFailures = 0;

        const payload = pipeline.process(archive);
        let saved: boolean;
        try {
          saved = await pipeline.save(deps.admin, runId, task.docId, payload);
        } catch (error) {
          console.error("[ingestion] 有報の保存に失敗しました", error instanceof Error ? error.message : "不明");
          details.stoppedReason = "save_failed";
          stopMessage = INGESTION_MESSAGES.edinetSaveFailed;
          break documents;
        }
        if (!saved) {
          console.warn(`[ingestion] 実行 ${runId} はすでに終了しているため、有報を保存しませんでした`);
          aborted = true;
          break documents;
        }
        processed += 1;
        details.documentsProcessed += 1;
        pipeline.count(details, payload);
      }
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

  const finish = async (status: Exclude<RunStatus, "running">, message: string | null) => {
    await finishRun(deps.admin, runId, status, processed, message, details);
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
// 有報の大株主・役員（target = edinet_reports）
// ---------------------------------------------------------------------------

function extractFromArchive(archive: ArchiveResult | null): AnnualReportExtraction {
  if (archive === null) return noXbrlExtraction("xbrl_flag_off");
  if (archive.kind === "no_xbrl") return noXbrlExtraction(archive.detail);
  if (archive.kind === "invalid_archive") return noXbrlExtraction("invalid_archive");
  return extractAnnualReport(readInlineXbrl(archive.documents));
}

const extractionSaveSchema = z.object({ saved: z.boolean(), reason: z.string().optional() });

export const annualReportsPipeline: EdinetPipeline<AnnualReportExtraction> = {
  target: "edinet_reports",
  async loadState(admin, window) {
    const { data, error } = await admin.rpc("edinet_ingestion_state", { p_from: window.start, p_to: window.end });
    if (error) throw new Error(`edinet_ingestion_state に失敗しました: ${error.message}`);
    return stateSchema.parse(data);
  },
  process: extractFromArchive,
  async save(admin, runId, docId, payload) {
    const { discardedFacts: _discarded, ...result } = payload;
    void _discarded;
    const { data, error } = await admin.rpc("save_annual_report_extraction", {
      p_run_id: runId,
      p_doc_id: docId,
      p_result: result,
    });
    if (error) throw new Error(error.message);
    const parsed = extractionSaveSchema.parse(data);
    if (!parsed.saved && parsed.reason === "unknown_document") throw new Error("書類のメタデータがありません");
    return parsed.saved;
  },
  count(details, payload) {
    const bump = (record: Record<string, number>, key: string) => (record[key] = (record[key] ?? 0) + 1);
    bump(details.extraction.shareholders, payload.shareholdersStatus);
    bump(details.extraction.officers, payload.officersStatus);
    if (payload.shareholdersStatus === "ok" && payload.officersStatus === "ok") details.documentsBothExtracted += 1;
    else details.documentsNotExtracted += 1;
    details.discardedFacts += payload.discardedFacts;
  },
};

export function ingestEdinetReports(runId: number, deps: RunDeps): Promise<RunOutcome> {
  return runEdinetPipeline(runId, deps, annualReportsPipeline);
}
