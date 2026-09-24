import { describe, expect, it } from "vitest";

import { formatCount, formatDateTimeJst, formatRelativeTime, formatShare } from "./format";

describe("formatDateTimeJst", () => {
  it("日本時間の YYYY-MM-DD HH:mm にする", () => {
    expect(formatDateTimeJst("2026-09-23T15:05:00Z")).toBe("2026-09-24 00:05");
  });
  it("空や不正な値は null", () => {
    expect(formatDateTimeJst(null)).toBeNull();
    expect(formatDateTimeJst("not-a-date")).toBeNull();
  });
});

describe("formatRelativeTime（経過時間は切り捨て）", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;

  it.each([
    ["未来（時計のずれ）", -5 * M, "たった今"],
    ["ちょうど同時刻", 0, "たった今"],
    ["59秒前", 59 * S, "たった今"],
    ["60秒前", 60 * S, "1分前"],
    ["59分59秒前", 59 * M + 59 * S, "59分前"],
    ["60分前", 60 * M, "1時間前"],
    ["4時間59分前", 4 * H + 59 * M, "4時間前"],
    ["23時間59分前", 23 * H + 59 * M, "23時間前"],
    ["24時間前", 24 * H, "1日前"],
    ["2日2時間55分前", 50 * H + 55 * M, "2日前"],
  ])("%s → %s", (_label, elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), now)).toBe(expected);
  });

  it("ISO 文字列も受け付け、空や不正な値は null", () => {
    expect(formatRelativeTime("2026-09-24T09:00:00+00:00", now)).toBe("3時間前");
    expect(formatRelativeTime(null, now)).toBeNull();
    expect(formatRelativeTime("not-a-date", now)).toBeNull();
  });
});

describe("formatCount", () => {
  it("3桁区切りにする", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(3812)).toBe("3,812");
  });
});

describe("formatShare", () => {
  it("小数点以下1桁の % にする", () => {
    expect(formatShare(2, 3)).toBe("66.7%");
    expect(formatShare(1, 3)).toBe("33.3%");
    expect(formatShare(0, 3)).toBe("0.0%");
    expect(formatShare(3, 3)).toBe("100.0%");
  });
  it("分母が 0 のときは null", () => {
    expect(formatShare(0, 0)).toBeNull();
  });
});
