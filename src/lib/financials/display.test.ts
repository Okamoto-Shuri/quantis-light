import { describe, expect, it } from "vitest";

import {
  basisLabel,
  cagrPeriodText,
  describeOperatingMargin,
  describeRevenueCagr,
  fiscalPeriodLabel,
  formatMillionYen,
  formatPercent,
  mixedBasisNotes,
  periodRows,
  revenueElementLabel,
  sourceLabel,
  supplementedPeriodsText,
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

describe("出典の表示（Sprint 9。AC15.2・AC15.3・AC15.8）", () => {
  it("出典のラベルは3種。未知の値は内部の文字列を出さない", () => {
    expect(sourceLabel("tdnet_summary")).toBe("決算短信");
    expect(sourceLabel("edinet_annual_report")).toBe("有価証券報告書");
    expect(sourceLabel("edinet_registration_statement")).toBe("有価証券届出書");
    expect(sourceLabel("edinet_other")).toBe("その他の出典");
  });

  it("補った期の文言は、出典ごとに古い順にまとめる（決算短信の期は並べない）", () => {
    const entry = (fiscal_year_end: string, source: string) => ({ fiscal_year_end, source });
    expect(
      supplementedPeriodsText([
        entry("2025-03-31", "tdnet_summary"),
        entry("2024-03-31", "tdnet_summary"),
        entry("2023-03-31", "edinet_annual_report"),
        entry("2022-03-31", "edinet_annual_report"),
        entry("2021-03-31", "edinet_registration_statement"),
      ]),
    ).toBe("2021/03期（有価証券届出書）、2022/03期・2023/03期（有価証券報告書）");
  });

  it("混在の注記は2つに分ける（連結・単体／会計基準）", () => {
    expect(mixedBasisNotes({ revenue_cagr_mixed_consolidation: true, revenue_cagr_mixed_standard: false })).toEqual([
      { key: "consolidation", text: "連結・単体が混在" },
    ]);
    expect(mixedBasisNotes({ revenue_cagr_mixed_consolidation: false, revenue_cagr_mixed_standard: true })).toEqual([
      { key: "standard", text: "会計基準が混在" },
    ]);
    expect(mixedBasisNotes({ revenue_cagr_mixed_consolidation: null, revenue_cagr_mixed_standard: null })).toEqual([]);
  });

  it("営業利益率の理由: 直近通期の出典が EDINET なら「営業利益の記載なし」、決算短信なら「営業利益の開示なし」（理由のコードは同じ）", () => {
    const base = { operating_margin_display_pct: null, operating_margin_unavailable_reason: "operating_profit_not_disclosed" as const };
    expect(describeOperatingMargin({ ...base, latest_period_source: "edinet_registration_statement" }).text).toBe("算出不可（営業利益の記載なし）");
    expect(describeOperatingMargin({ ...base, latest_period_source: "tdnet_summary" }).text).toBe("算出不可（営業利益の開示なし）");
  });

  it("売上高の記載の名前は「売上高」以外のときだけ", () => {
    expect(revenueElementLabel("RevenueIFRSSummaryOfBusinessResults")).toBe("売上収益");
    expect(revenueElementLabel("OrdinaryIncomeSummaryOfBusinessResults")).toBe("経常収益");
    expect(revenueElementLabel("NetSalesSummaryOfBusinessResults")).toBeNull();
    expect(revenueElementLabel(null)).toBeNull();
  });
});
