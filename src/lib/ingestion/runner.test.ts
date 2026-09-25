import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { executeIngestionRun, isSupportedTarget, SUPPORTED_TARGETS } = await import("./runner");
const { CRON_JOBS } = await import("./schedule");
const { EQUITIES_MASTER_RESPONSE } = await import("./jquants/__fixtures__/equities-master");

const rpc = vi.fn();
const admin = { rpc } as unknown as SupabaseClient;

function rpcCalls(name: string) {
  return rpc.mock.calls.filter(([fn]) => fn === name).map(([, args]) => args);
}

describe("executeIngestionRun（銘柄マスタ）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rpc.mockImplementation(async (fn: string) =>
      fn === "complete_stock_master_run"
        ? { data: { completed: true, processedCount: 4 }, error: null }
        : { data: true, error: null },
    );
  });

  it("J-Quants のキーが未設定なら、外部 API を呼ばずに「失敗」で記録する", async () => {
    const fetchImpl = vi.fn();
    const outcome = await executeIngestionRun(1, "stock_master", { admin, fetchImpl, env: {} });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome).toEqual({ runId: 1, target: "stock_master", status: "failed", processedCount: 0 });
    expect(rpcCalls("finish_ingestion_run")).toEqual([
      {
        p_run_id: 1,
        p_status: "failed",
        p_processed_count: 0,
        p_error_message: "J-Quants の API キーが設定されていません",
        p_details: null,
      },
    ]);
    expect(rpcCalls("complete_stock_master_run")).toEqual([]);
  });

  it("取得に成功したら、保存と成功の記録を1回の DB 関数で行う", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(EQUITIES_MASTER_RESPONSE), { status: 200 }));
    const outcome = await executeIngestionRun(2, "stock_master", { admin, fetchImpl, env: { JQUANTS_API_KEY: "k" } });
    expect(outcome).toEqual({ runId: 2, target: "stock_master", status: "succeeded", processedCount: 4 });
    const [args] = rpcCalls("complete_stock_master_run") as [{ p_run_id: number; p_rows: unknown[]; p_details: unknown }];
    expect(args.p_run_id).toBe(2);
    expect(args.p_rows).toHaveLength(4);
    expect(args.p_details).toMatchObject({ fetched: 10, skipped: 6 });
    expect(rpcCalls("finish_ingestion_run")).toEqual([]);
  });

  it("取得に失敗したら、決まったメッセージで「失敗」にし、保存しない", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 403 }));
    const outcome = await executeIngestionRun(3, "stock_master", { admin, fetchImpl, env: { JQUANTS_API_KEY: "k" } });
    expect(outcome.status).toBe("failed");
    expect(rpcCalls("finish_ingestion_run")[0]).toMatchObject({
      p_status: "failed",
      p_error_message: "J-Quants の API キーが無効か、契約プランでは利用できません（HTTP 403）",
    });
    expect(rpcCalls("complete_stock_master_run")).toEqual([]);
  });

  it("保存に失敗したら「銘柄マスタの保存に失敗しました」", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "complete_stock_master_run"
        ? { data: null, error: { message: "violates check constraint" } }
        : { data: true, error: null },
    );
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(EQUITIES_MASTER_RESPONSE), { status: 200 }));
    const outcome = await executeIngestionRun(4, "stock_master", { admin, fetchImpl, env: { JQUANTS_API_KEY: "k" } });
    expect(outcome.status).toBe("failed");
    expect(rpcCalls("finish_ingestion_run")[0]).toMatchObject({
      p_status: "failed",
      p_error_message: "銘柄マスタの保存に失敗しました",
    });
  });

  it("予期しない例外でも「実行中」のまま残さない", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(EQUITIES_MASTER_RESPONSE), { status: 200 }));
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "complete_stock_master_run") throw new Error("connection reset");
      return { data: true, error: null };
    });
    const outcome = await executeIngestionRun(5, "stock_master", { admin, fetchImpl, env: { JQUANTS_API_KEY: "k" } });
    expect(outcome.status).toBe("failed");
    expect(rpcCalls("finish_ingestion_run")[0]).toMatchObject({
      p_status: "failed",
      p_error_message: "予期しないエラーで取り込みを完了できませんでした",
    });
  });
});

describe("isSupportedTarget", () => {
  it("取り込み処理がある対象だけを受け付ける", () => {
    expect(isSupportedTarget("stock_master")).toBe(true);
    expect(isSupportedTarget("daily_quotes")).toBe(true);
    expect(isSupportedTarget("financials")).toBe(true);
    expect(isSupportedTarget("edinet_reports")).toBe(true);
    for (const value of ["zzz", "", null, 1]) {
      expect(isSupportedTarget(value)).toBe(false);
    }
  });
});

describe("定期実行の対象の表示", () => {
  it("画面の対象の表示が、実行する対象と順序に一致し、定期実行はすべての対象を1回ずつ含む", () => {
    const labels = { stock_master: "銘柄マスタ", daily_quotes: "株価（初出日）", financials: "財務（決算短信）", edinet_reports: "EDINET（有報・届出書）" } as const;
    for (const job of CRON_JOBS) {
      expect(job.targetsLabel).toBe(job.targets.map((target) => labels[target]).join("、"));
    }
    expect(CRON_JOBS.flatMap((job) => job.targets).sort()).toEqual([...SUPPORTED_TARGETS].sort());
  });
});

describe("executeIngestionRun（有報・EDINET）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockImplementation(async () => ({ data: true, error: null }));
  });

  it("EDINET のキーが未設定なら、外部 API を呼ばずに「失敗」で記録する（J-Quants のキーがあっても）", async () => {
    const fetchImpl = vi.fn();
    const outcome = await executeIngestionRun(9, "edinet_reports", { admin, fetchImpl, env: { JQUANTS_API_KEY: "k" } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome).toEqual({ runId: 9, target: "edinet_reports", status: "failed", processedCount: 0 });
    expect(rpcCalls("finish_ingestion_run")).toEqual([
      {
        p_run_id: 9,
        p_status: "failed",
        p_processed_count: 0,
        p_error_message: "EDINET の API キーが設定されていません",
        p_details: null,
      },
    ]);
    expect(rpcCalls("edinet_ingestion_state")).toEqual([]);
  });
});
