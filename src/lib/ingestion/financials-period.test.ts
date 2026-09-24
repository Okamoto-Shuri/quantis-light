import { describe, expect, it } from "vitest";

import { financialsWindow, planDisclosureDates, weekdaysBetween } from "./financials-period";

describe("財務の取り込みの日付", () => {
  it("取得範囲は実行日の6年前の日から実行日まで（2月29日は2月28日に）", () => {
    expect(financialsWindow("2026-09-24")).toEqual({ start: "2020-09-24", end: "2026-09-24" });
    expect(financialsWindow("2028-02-29")).toEqual({ start: "2022-02-28", end: "2028-02-29" });
  });

  it("平日の代用は土日を除き、新しい順", () => {
    expect(weekdaysBetween("2026-09-17", "2026-09-22")).toEqual(["2026-09-22", "2026-09-21", "2026-09-18", "2026-09-17"]);
  });

  it("直近7日の営業日（取得済みでも）→ 未取得の営業日（新しい順）", () => {
    const businessDays = ["2026-09-24", "2026-09-22", "2026-09-18", "2026-09-17", "2026-09-16", "2026-09-15", "2026-09-14"];
    const fetched = new Set(["2026-09-24", "2026-09-18", "2026-09-16"]);
    expect(planDisclosureDates({ businessDays, fetched, runDate: "2026-09-24" })).toEqual({
      recent: ["2026-09-24", "2026-09-22", "2026-09-18"],
      queue: ["2026-09-24", "2026-09-22", "2026-09-18", "2026-09-17", "2026-09-15", "2026-09-14"],
    });
  });
});
