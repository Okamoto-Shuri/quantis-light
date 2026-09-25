import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fetchDashboardSummary, isEmptyDashboard } = await import("./summary");

const SUMMARY = {
  stockCount: 3,
  // Sprint 12: 上場廃止の数（契約 C10-1 の種類5）
  delistedCount: 0,
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

const FRESHNESS = {
  stale: true,
  lastUpdatedAt: "2026-09-22T12:00:00+00:00",
  targets: [
    { target: "stock_master", lastUpdatedAt: null, stale: false, remainingCount: null, remainingUnit: null },
    { target: "daily_quotes", lastUpdatedAt: "2026-09-22T12:00:00+00:00", stale: true, remainingCount: 3, remainingUnit: "stocks" },
    { target: "financials", lastUpdatedAt: null, stale: false, remainingCount: null, remainingUnit: null },
    { target: "edinet_reports", lastUpdatedAt: null, stale: false, remainingCount: null, remainingUnit: null },
  ],
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
    // Sprint 12: 鮮度（data_freshness）を並べて読む。ここでは同じ値が返るので形が違い、freshness は null（契約 C10-1 の種類5）
    expect(result).toEqual({ ok: true, summary: { ...SUMMARY, freshness: null } });
  });

  it("鮮度（data_freshness）を summary.freshness に入れる（Sprint 12）", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "dashboard_summary" ? SUMMARY : FRESHNESS, error: null }));
    const result = await fetchDashboardSummary(client);
    expect(rpc).toHaveBeenCalledWith("data_freshness");
    expect(result).toEqual({ ok: true, summary: { ...SUMMARY, freshness: FRESHNESS } });
  });

  it("鮮度の取得に失敗しても集計は返し、freshness は null（契約 C4-11）", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "dashboard_summary" ? { data: SUMMARY, error: null } : { data: null, error: { message: "function data_freshness() does not exist" } },
    );
    expect(await fetchDashboardSummary(client)).toEqual({ ok: true, summary: { ...SUMMARY, freshness: null } });
    rpc.mockImplementation(async (name: string) => {
      if (name === "dashboard_summary") return { data: SUMMARY, error: null };
      throw new TypeError("fetch failed");
    });
    expect(await fetchDashboardSummary(client)).toEqual({ ok: true, summary: { ...SUMMARY, freshness: null } });
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
