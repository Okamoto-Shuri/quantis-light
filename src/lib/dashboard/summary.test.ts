import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchDashboardSummary, isEmptyDashboard } = await import("./summary");

const SUMMARY = {
  stockCount: 3,
  financialMetrics: { anyCount: 2, revenueCagrCount: 1, operatingMarginCount: 2 },
  ownershipDeterminedCount: 1,
  lastCompletedRun: { target: "stock_master", status: "succeeded", finishedAt: "2026-09-22T09:05:00+00:00" },
  latestRun: {
    target: "stock_master",
    status: "failed",
    startedAt: "2026-09-24T07:00:00+00:00",
    finishedAt: "2026-09-24T07:01:00+00:00",
    errorMessage: "J-Quants の API キーが設定されていません",
  },
};

const rpc = vi.fn();
const client = { rpc } as unknown as Parameters<typeof fetchDashboardSummary>[0];

describe("fetchDashboardSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("DB 関数の結果をそのまま返す", async () => {
    rpc.mockResolvedValue({ data: SUMMARY, error: null });
    const result = await fetchDashboardSummary(client);
    expect(rpc).toHaveBeenCalledWith("dashboard_summary");
    expect(result).toEqual({ ok: true, summary: SUMMARY });
  });

  it("実行履歴が無いときは null を受け付ける", async () => {
    rpc.mockResolvedValue({ data: { ...SUMMARY, lastCompletedRun: null, latestRun: null }, error: null });
    const result = await fetchDashboardSummary(client);
    expect(result.ok).toBe(true);
  });

  it("DB 関数がエラーを返したら失敗にし、0 件としては扱わない", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function dashboard_summary" } });
    expect(await fetchDashboardSummary(client)).toEqual({ ok: false });
  });

  it("例外が出ても失敗として返す", async () => {
    rpc.mockRejectedValue(new TypeError("fetch failed"));
    expect(await fetchDashboardSummary(client)).toEqual({ ok: false });
  });

  it("想定外の形（件数が欠けている、負の値）なら失敗にする", async () => {
    rpc.mockResolvedValue({ data: { ...SUMMARY, stockCount: undefined }, error: null });
    expect(await fetchDashboardSummary(client)).toEqual({ ok: false });
    rpc.mockResolvedValue({ data: { ...SUMMARY, stockCount: -1 }, error: null });
    expect(await fetchDashboardSummary(client)).toEqual({ ok: false });
  });
});

describe("isEmptyDashboard", () => {
  it("銘柄が0件のときだけ空状態", () => {
    expect(isEmptyDashboard({ ...SUMMARY, stockCount: 0 } as never)).toBe(true);
    expect(isEmptyDashboard(SUMMARY as never)).toBe(false);
  });
});
