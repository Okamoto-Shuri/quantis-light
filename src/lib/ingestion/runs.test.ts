import { describe, expect, it } from "vitest";

import { formatRemaining, formatRemainingShort, partialKindOf, runStatusLabel, toApiRun } from "./runs";

describe("一部完了と一部失敗（契約 sprint-12 の第2章の1）", () => {
  it("partial・失敗0件・時間切れか応答なしは一部完了", () => {
    expect(partialKindOf({ status: "partial", stoppedReason: "time_budget", failedCount: 0 })).toBe("incomplete");
    expect(partialKindOf({ status: "partial", stoppedReason: "stale", failedCount: 0 })).toBe("incomplete");
  });
  it("失敗がある・ほかの打ち切り・列の無い過去の行は一部失敗", () => {
    expect(partialKindOf({ status: "partial", stoppedReason: "time_budget", failedCount: 2 })).toBe("failed");
    expect(partialKindOf({ status: "partial", stoppedReason: "rate_limited", failedCount: 0 })).toBe("failed");
    expect(partialKindOf({ status: "partial", stoppedReason: "delisting_held", failedCount: 0 })).toBe("failed");
    expect(partialKindOf({ status: "partial" })).toBe("failed");
    expect(partialKindOf({ status: "succeeded", stoppedReason: null, failedCount: 0 })).toBeNull();
  });
  it("表示名", () => {
    expect(runStatusLabel("partial", "incomplete")).toBe("一部完了");
    expect(runStatusLabel("partial", "failed")).toBe("一部失敗");
    expect(runStatusLabel("succeeded", null)).toBe("成功");
  });
  it("残りの表示", () => {
    expect(formatRemaining(3512, "stocks")).toBe("残り 3,512 銘柄");
    expect(formatRemaining(20, "disclosure_dates")).toBe("残り 20 日分");
    expect(formatRemaining(15, "documents")).toBe("残り 15 件の書類");
    expect(formatRemaining(3, "list_dates")).toBe("残り 3 日分の書類一覧");
    expect(formatRemainingShort("financials", 20, "disclosure_dates")).toBe("財務 20 日分");
    expect(formatRemainingShort("edinet_reports", 15, "documents")).toBe("EDINET 15 件の書類");
    expect(formatRemainingShort("daily_quotes", 3000, "stocks")).toBe("株価 3,000 銘柄");
  });
  it("API の形に打ち切りの理由・残り・失敗の件数・partialKind を加える", () => {
    expect(
      toApiRun({
        id: 1,
        target: "daily_quotes",
        trigger: "cron",
        status: "partial",
        started_at: "s",
        finished_at: "f",
        processed_count: 350,
        error_message: "m",
        stopped_reason: "time_budget",
        remaining_count: 3512,
        remaining_unit: "stocks",
        failed_count: 0,
      }),
    ).toMatchObject({ stoppedReason: "time_budget", remainingCount: 3512, remainingUnit: "stocks", failedCount: 0, partialKind: "incomplete" });
  });
});
