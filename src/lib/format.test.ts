import { describe, expect, it } from "vitest";

import { formatDateTimeJst } from "./format";

describe("formatDateTimeJst", () => {
  it("日本時間の YYYY-MM-DD HH:mm にする", () => {
    expect(formatDateTimeJst("2026-09-23T15:05:00Z")).toBe("2026-09-24 00:05");
  });
  it("空や不正な値は null", () => {
    expect(formatDateTimeJst(null)).toBeNull();
    expect(formatDateTimeJst("not-a-date")).toBeNull();
  });
});
