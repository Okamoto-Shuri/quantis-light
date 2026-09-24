import { describe, expect, it } from "vitest";

import { buildFiscalSlots, consecutiveSlotCount, dayBefore, previousFiscalYearEnd } from "./slots";

const p = (start: string, end: string) => ({ fiscal_year_start: start, fiscal_year_end: end });
const march = (endYear: number) => p(`${endYear - 1}-04-01`, `${endYear}-03-31`);
const summary = (slots: ReturnType<typeof buildFiscalSlots>) =>
  slots.map((slot) => `${slot.position} ${slot.fiscalYearEnd} ${slot.period ? "有" : "無"}`);

describe("日付の規則", () => {
  it("前日", () => {
    expect(dayBefore("2022-04-01")).toBe("2022-03-31");
    expect(dayBefore("2024-03-01")).toBe("2024-02-29");
    expect(dayBefore("2023-03-01")).toBe("2023-02-28");
    expect(dayBefore("2024-01-01")).toBe("2023-12-31");
  });

  it("月末なら前年の同じ月の末日、月末以外は前年の同じ日", () => {
    expect(previousFiscalYearEnd("2025-02-28")).toBe("2024-02-29");
    expect(previousFiscalYearEnd("2024-02-29")).toBe("2023-02-28");
    expect(previousFiscalYearEnd("2025-03-31")).toBe("2024-03-31");
    expect(previousFiscalYearEnd("2024-08-20")).toBe("2023-08-20");
    // うるう年の 2月28日は月末ではない
    expect(previousFiscalYearEnd("2024-02-28")).toBe("2023-02-28");
    expect(previousFiscalYearEnd("2024-12-31")).toBe("2023-12-31");
  });
});

describe("5期の枠（契約の第2章の3・C10-3）", () => {
  it("通期実績0件は空", () => {
    expect(buildFiscalSlots([])).toEqual([]);
  });

  it("5期ちょうど", () => {
    const slots = buildFiscalSlots([2021, 2022, 2023, 2024, 2025].map(march));
    expect(summary(slots)).toEqual([
      "FY-4 2021-03-31 有",
      "FY-3 2022-03-31 有",
      "FY-2 2023-03-31 有",
      "FY-1 2024-03-31 有",
      "FY0 2025-03-31 有",
    ]);
    expect(consecutiveSlotCount(slots)).toBe(5);
  });

  it("6期以上は直近の5期（順不同の入力でも）", () => {
    const slots = buildFiscalSlots([2025, 2020, 2022, 2021, 2024, 2023, 2019].map(march));
    expect(slots.map((s) => s.fiscalYearEnd)).toEqual(["2021-03-31", "2022-03-31", "2023-03-31", "2024-03-31", "2025-03-31"]);
  });

  it("3期（99996 と同じ形）: FY-4・FY-3 は想定の決算期でデータなし", () => {
    const slots = buildFiscalSlots([2021, 2022, 2023].map(march));
    expect(summary(slots)).toEqual([
      "FY-4 2019-03-31 無",
      "FY-3 2020-03-31 無",
      "FY-2 2021-03-31 有",
      "FY-1 2022-03-31 有",
      "FY0 2023-03-31 有",
    ]);
    expect(consecutiveSlotCount(slots)).toBe(3);
  });

  it("途中の欠け（9Y002 と同じ形）: FY-3 = 2022-03-31 はデータなし、FY-4 = 2021-03-31 は表示", () => {
    const slots = buildFiscalSlots([2019, 2020, 2021, 2023, 2024, 2025].map(march));
    expect(summary(slots)).toEqual([
      "FY-4 2021-03-31 有",
      "FY-3 2022-03-31 無",
      "FY-2 2023-03-31 有",
      "FY-1 2024-03-31 有",
      "FY0 2025-03-31 有",
    ]);
    expect(consecutiveSlotCount(slots)).toBe(3);
  });

  it("変則決算（9Y003 と同じ形）: 9か月の期を挟んで連続する", () => {
    const slots = buildFiscalSlots([
      march(2020),
      march(2021),
      march(2022),
      p("2022-04-01", "2022-12-31"),
      p("2023-01-01", "2023-12-31"),
      p("2024-01-01", "2024-12-31"),
    ]);
    expect(slots.map((s) => s.fiscalYearEnd)).toEqual(["2021-03-31", "2022-03-31", "2022-12-31", "2023-12-31", "2024-12-31"]);
    expect(consecutiveSlotCount(slots)).toBe(5);
  });

  it("決算期変更の直後に欠け: 12月決算の FY0 の前の 9か月の期が無い", () => {
    const slots = buildFiscalSlots([march(2021), march(2022), p("2023-01-01", "2023-12-31"), p("2024-01-01", "2024-12-31")]);
    // FY-2 の想定は 2022-12-31（データなし）→ FY-3 は前年の同じ月末 2021-12-31（3月決算の期とは一致しない）
    expect(summary(slots)).toEqual([
      "FY-4 2020-12-31 無",
      "FY-3 2021-12-31 無",
      "FY-2 2022-12-31 無",
      "FY-1 2023-12-31 有",
      "FY0 2024-12-31 有",
    ]);
  });

  it("2月決算・うるう年: 2024-02-29 の期が FY-2 に入る", () => {
    const slots = buildFiscalSlots([p("2023-03-01", "2024-02-29"), p("2025-03-01", "2026-02-28")]);
    expect(summary(slots)).toEqual([
      "FY-4 2022-02-28 無",
      "FY-3 2023-02-28 無",
      "FY-2 2024-02-29 有",
      "FY-1 2025-02-28 無",
      "FY0 2026-02-28 有",
    ]);
  });

  it("20日締め: 月末でない締め日は前年の同じ日", () => {
    const slots = buildFiscalSlots([p("2022-08-21", "2023-08-20"), p("2024-08-21", "2025-08-20")]);
    expect(summary(slots)).toEqual([
      "FY-4 2021-08-20 無",
      "FY-3 2022-08-20 無",
      "FY-2 2023-08-20 有",
      "FY-1 2024-08-20 無",
      "FY0 2025-08-20 有",
    ]);
  });
});
