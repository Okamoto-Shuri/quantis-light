import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  failureMessage,
  FAILURE_ITEM_TYPES,
  FAILURE_REASONS,
  FAILURE_ROWS_LIMIT,
  type FailureItemType,
  type FailureReason,
  type NetworkErrorKind,
} from "./failures";
import { emptyRateLimitStats, type RateLimitStats } from "./pacer";
import { ingestionRunSchema, RUN_COLUMNS, toApiRun, type ApiRun, type IngestionRun } from "./runs";

/**
 * 実行の詳細（/imports/runs/[id] と GET /api/ingestion/runs/[id]）。ユーザーのセッション（RLS の経路）で読む。
 */

/** URL の実行の id（正の整数。先頭の 0 や小数・符号は不正）。 */
export function parseRunId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export type RunFailureView = {
  itemType: FailureItemType;
  itemKey: string;
  code: string | null;
  /** 銘柄マスタにあれば社名（無ければ null。リンクも付けない） */
  companyName: string | null;
  /** 書類の失敗の書類種別コード（edinet_documents にあれば） */
  docTypeCode: string | null;
  reason: FailureReason;
  httpStatus: number | null;
  networkError: NetworkErrorKind | null;
  message: string;
};

export type RunDetail = {
  run: IngestionRun;
  apiCalls: number | null;
  rateLimit: RateLimitStats | null;
  failures: RunFailureView[];
  /** 保存の上限（1,000 行）を超えて一覧に無い失敗の数 */
  failuresOmitted: number;
};

const failureRowSchema = z.object({
  item_type: z.enum(FAILURE_ITEM_TYPES),
  item_key: z.string(),
  code: z.string().nullable(),
  reason: z.enum(FAILURE_REASONS),
  http_status: z.number().nullable(),
  network_error: z.enum(["timeout", "network"]).nullable(),
});

const countersSchema = z.object({
  apiCalls: z.number().optional(),
  rateLimit: z
    .object({ hits: z.number(), retries: z.number(), waitedMs: z.number(), exhausted: z.boolean() })
    .optional(),
});

export type RunDetailResult = { ok: true; value: RunDetail | null } | { ok: false };

type Reader = Pick<SupabaseClient, "from">;

export async function fetchRunDetail(supabase: Reader, id: number): Promise<RunDetailResult> {
  const [runResult, failuresResult] = await Promise.all([
    supabase.from("ingestion_runs").select(RUN_COLUMNS).eq("id", id).limit(1),
    supabase
      .from("ingestion_run_failures")
      .select("item_type, item_key, code, reason, http_status, network_error")
      .eq("run_id", id)
      .order("id", { ascending: true })
      .limit(FAILURE_ROWS_LIMIT),
  ]);
  if (runResult.error || failuresResult.error) {
    console.error("[imports] 実行の詳細の取得に失敗しました", (runResult.error ?? failuresResult.error)?.message);
    return { ok: false };
  }
  const runs = z.array(ingestionRunSchema).safeParse(runResult.data);
  const failures = z.array(failureRowSchema).safeParse(failuresResult.data);
  if (!runs.success || !failures.success) {
    console.error("[imports] 実行の詳細の形式が想定と異なります");
    return { ok: false };
  }
  const run = runs.data[0];
  if (!run) return { ok: true, value: null };

  // 銘柄名と書類種別（表示のための補助。取得できなくても一覧は出す）
  const codes = [...new Set(failures.data.map((f) => f.code).filter((code): code is string => code !== null))];
  const docIds = failures.data.filter((f) => f.item_type === "document").map((f) => f.item_key);
  const [stocks, documents] = await Promise.all([
    codes.length > 0 ? supabase.from("stocks").select("code, company_name").in("code", codes) : null,
    docIds.length > 0 ? supabase.from("edinet_documents").select("doc_id, doc_type_code").in("doc_id", docIds) : null,
  ]);
  const names = new Map<string, string>(
    ((stocks?.data ?? []) as { code: string; company_name: string }[]).map((row) => [row.code, row.company_name]),
  );
  const docTypes = new Map<string, string>(
    ((documents?.data ?? []) as { doc_id: string; doc_type_code: string }[]).map((row) => [row.doc_id, row.doc_type_code]),
  );

  const counters = countersSchema.safeParse(run.details ?? {});
  const apiCalls = counters.success ? (counters.data.apiCalls ?? null) : null;
  const rateLimit = counters.success ? (counters.data.rateLimit ?? (apiCalls === null ? null : emptyRateLimitStats())) : null;

  const views: RunFailureView[] = failures.data.map((f) => ({
    itemType: f.item_type,
    itemKey: f.item_key,
    code: f.code,
    companyName: f.code === null ? null : (names.get(f.code) ?? null),
    docTypeCode: f.item_type === "document" ? (docTypes.get(f.item_key) ?? null) : null,
    reason: f.reason,
    httpStatus: f.http_status,
    networkError: f.network_error,
    message: failureMessage({ itemType: f.item_type, reason: f.reason, httpStatus: f.http_status, networkError: f.network_error }),
  }));

  return {
    ok: true,
    value: {
      run,
      apiCalls,
      rateLimit,
      failures: views,
      failuresOmitted: Math.max((run.failed_count ?? 0) - views.length, 0),
    },
  };
}

/** API の形（GET /api/ingestion/runs/[id]）。 */
export function toApiRunDetail(detail: RunDetail): {
  run: ApiRun & { apiCalls: number | null; rateLimit: RateLimitStats | null };
  failures: { itemType: FailureItemType; itemKey: string; code: string | null; companyName: string | null; reason: FailureReason; httpStatus: number | null; message: string }[];
  failuresOmitted: number;
} {
  return {
    run: { ...toApiRun(detail.run), apiCalls: detail.apiCalls, rateLimit: detail.rateLimit },
    failures: detail.failures.map((f) => ({
      itemType: f.itemType,
      itemKey: f.itemKey,
      code: f.code,
      companyName: f.companyName,
      reason: f.reason,
      httpStatus: f.httpStatus,
      message: f.message,
    })),
    failuresOmitted: detail.failuresOmitted,
  };
}
