import { describe, expect, it } from "vitest";

import { addDays, dataStartProbeFrom, jstDate, subtractYears } from "./listing-period";

describe("日付の計算", () => {
  it("jstDate は日本時間の日付を返す（UTC の日付とずれる時刻を含む）", () => {
    expect(jstDate(Date.parse("2026-09-24T14:30:00Z"))).toBe("2026-09-24");
    expect(jstDate(Date.parse("2026-09-24T15:00:00Z"))).toBe("2026-09-25");
    expect(jstDate(Date.parse("2026-09-23T23:00:00Z"))).toBe("2026-09-24");
  });

  it("addDays は月・年をまたぐ", () => {
    expect(addDays("2016-12-31", 1)).toBe("2017-01-01");
    expect(addDays("2016-02-28", 1)).toBe("2016-02-29");
    expect(addDays("2017-02-28", 1)).toBe("2017-03-01");
    expect(addDays("2026-09-24", 13)).toBe("2026-10-07");
  });

  it("subtractYears は2月29日を、2月29日の無い年では2月28日にする", () => {
    expect(subtractYears("2026-09-24", 10)).toBe("2016-09-24");
    expect(subtractYears("2028-02-29", 10)).toBe("2018-02-28");
    expect(subtractYears("2028-02-29", 4)).toBe("2024-02-29");
  });

  it("探索の開始日は、実行日の10年前の翌日", () => {
    expect(dataStartProbeFrom("2026-09-24")).toBe("2016-09-25");
    expect(dataStartProbeFrom("2026-12-31")).toBe("2017-01-01");
    expect(dataStartProbeFrom("2028-02-29")).toBe("2018-03-01");
  });
});
