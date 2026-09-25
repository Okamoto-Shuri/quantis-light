import { describe, expect, it } from "vitest";

import { datesBetween, EDINET_LOOKBACK_DAYS, edinetWindow, planListDates } from "./edinet-period";

describe("書類一覧を取る日", () => {
  it("期間は実行日の 450 日前〜実行日（土日を含む）", () => {
    expect(edinetWindow("2026-09-25")).toEqual({ start: "2025-07-02", end: "2026-09-25" });
    expect(datesBetween("2026-09-19", "2026-09-21")).toEqual(["2026-09-21", "2026-09-20", "2026-09-19"]);
    expect(planListDates({ runDate: "2026-09-25", fetched: new Set() }).inWindow).toHaveLength(EDINET_LOOKBACK_DAYS + 1);
  });

  it("直近7日は取得済みでも毎回取り直し（古い順）、そのほかは未取得の日だけを新しい順に取る", () => {
    const fetched = new Set(["2026-09-25", "2026-09-19", "2026-09-18", "2026-09-16"]);
    const { queue, recent } = planListDates({ runDate: "2026-09-25", fetched });
    expect(recent).toEqual(["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
    expect(queue.slice(0, 9)).toEqual([...recent, "2026-09-17", "2026-09-15"]);
    expect(queue).not.toContain("2026-09-18");
    expect(queue.at(-1)).toBe("2025-07-02");
  });
});
