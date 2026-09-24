import { describe, expect, it } from "vitest";

import {
  basisLabel,
  cagrPeriodText,
  describeOperatingMargin,
  describeRevenueCagr,
  fiscalPeriodLabel,
  formatMillionYen,
  formatPercent,
  periodRows,
  type FinancialPeriod,
} from "./display";

describe("財務指標の表示", () => {
  it("DB で切り捨て済みの百分率を小数点以下1桁で表示する", () => {
    expect(formatPercent(41.4)).toBe("41.4%");
    expect(formatPercent(12)).toBe("12.0%");
    expect(formatPercent(-1.1)).toBe("-1.1%");
    expect(formatPercent(-100)).toBe("-100.0%");
  });

  it("金額は百万円の3桁区切りの整数（四捨五入）", () => {
    expect(formatMillionYen(14_641_000_000)).toBe("14,641");
    expect(formatMillionYen(40_000_000_000)).toBe("40,000");
    expect(formatMillionYen(1_500_000)).toBe("2");
    expect(formatMillionYen(-1_500_000)).toBe("-2");
    expect(formatMillionYen(-123_000_000)).toBe("-123");
    expect(formatMillionYen(400_000)).toBe("0");
    expect(formatMillionYen(-400_000)).toBe("0");
  });

  it("期と CAGR の期間", () => {
    expect(fiscalPeriodLabel("2025-03-31")).toBe("2025/03期");
    expect(cagrPeriodText("2021-03-31", "2025-03-31")).toBe("2021/03期 → 2025/03期（4年）");
  });

  it("連結・単体と会計基準", () => {
    expect(basisLabel(true, "JP")).toBe("連結・日本基準");
    expect(basisLabel(false, "IFRS")).toBe("単体・IFRS");
    expect(basisLabel(true, "US")).toBe("連結・米国基準");
  });

  it("算出不可の理由の表示", () => {
    expect(describeRevenueCagr({ revenue_cagr_display_pct: null, revenue_cagr_unavailable_reason: "insufficient_periods" })).toEqual({
      kind: "unavailable",
      text: "算出不可（通期実績が5期未満）",
    });
    expect(describeRevenueCagr({ revenue_cagr_display_pct: null, revenue_cagr_unavailable_reason: "non_consecutive_periods" }).text).toBe(
      "算出不可（直近5期の通期実績が連続していない）",
    );
    expect(describeRevenueCagr({ revenue_cagr_display_pct: 41.4, revenue_cagr_unavailable_reason: null })).toEqual({
      kind: "value",
      text: "41.4%",
    });
    expect(
      describeOperatingMargin({ operating_margin_display_pct: null, operating_margin_unavailable_reason: "operating_profit_not_disclosed" })
        .text,
    ).toBe("算出不可（営業利益の開示なし）");
  });

  it("通期実績の表は新しい6期までを古い順に並べ、FY0 から連続する期に位置を付ける", () => {
    const period = (end: string): FinancialPeriod =>
      ({ fiscal_year_end: end }) as FinancialPeriod;
    const periods = ["2019", "2020", "2021", "2022", "2023", "2024", "2025"].map((y) => period(`${y}-03-31`));
    const rows = periodRows(periods, { revenue_cagr_period_count: 5 });
    expect(rows.map((row) => [row.period.fiscal_year_end.slice(0, 4), row.position])).toEqual([
      ["2020", null],
      ["2021", "FY-4"],
      ["2022", "FY-3"],
      ["2023", "FY-2"],
      ["2024", "FY-1"],
      ["2025", "FY0"],
    ]);
    expect(periodRows(periods.slice(-2), { revenue_cagr_period_count: 1 }).map((row) => row.position)).toEqual([null, "FY0"]);
  });
});
