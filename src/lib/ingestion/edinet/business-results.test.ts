import { describe, expect, it } from "vitest";

import { amount, context, ixbrlDocument, nonFraction, nonNumeric, readBusinessResultsFixture, yearContext } from "./__fixtures__/synthetic";
import { extractBusinessResults, OPERATING_PROFIT_ELEMENTS, REVENUE_ELEMENTS } from "./business-results";
import { readInlineXbrl } from "./xbrl";

function extract(html: string) {
  return extractBusinessResults(readInlineXbrl([{ name: "doc", html }]));
}

const pick = (result: ReturnType<typeof extract>, end: string, consolidated: boolean) =>
  result.periods.find((p) => p.fiscal_year_end === end && p.consolidated === consolidated);

/** 「主要な経営指標等の推移」の表の形の文書（行 = 項目、列 = 期）。 */
function doc(contexts: string[], cells: string[], { dei }: { dei?: string } = {}) {
  return ixbrlDocument({
    contexts: [...contexts, context("FilingDateInstant", { instant: "2025-06-27" })],
    body: `${dei ? `<div style="display:none">${nonNumeric("jpdei_cor:WhetherConsolidatedFinancialStatementsArePreparedDEI", "FilingDateInstant", dei)}</div>` : ""}
<h3>１【主要な経営指標等の推移】</h3><table><tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr></table>`,
  });
}

describe("実データの抜粋（EDINET の公開の書類。AC15.13）", () => {
  it("S100X683（届出書・新規公開時）: 連結と提出会社の両方がある。千円の記載を円にする。進行中の期を CurrentYear とするので5期は Prior1〜Prior5", () => {
    const result = extract(readBusinessResultsFixture("S100X683"));
    expect(result.status).toBe("ok");
    expect(result.discardedFacts).toBe(0);
    // 連結は2期、提出会社は5期
    expect(result.periods.filter((p) => p.consolidated).map((p) => p.fiscal_year_end)).toEqual(["2024-03-31", "2025-03-31"]);
    expect(result.periods.filter((p) => !p.consolidated).map((p) => p.fiscal_year_end)).toEqual([
      "2021-03-31",
      "2022-03-31",
      "2023-03-31",
      "2024-03-31",
      "2025-03-31",
    ]);
    // 表示 3,912,786 千円 → 3912786000 円（number を経由しない十進の文字列）
    expect(pick(result, "2024-03-31", true)).toEqual({
      fiscal_year_start: "2023-04-01",
      fiscal_year_end: "2024-03-31",
      consolidated: true,
      accounting_standard: "JP",
      net_sales: "3912786000",
      operating_profit: null,
      revenue_element: "NetSalesSummaryOfBusinessResults",
      operating_profit_element: null,
    });
    expect(pick(result, "2024-03-31", false)?.net_sales).toBe("3551916000");
    expect(pick(result, "2021-03-31", false)?.net_sales).toBe("2932294000");
    // 経常利益（OrdinaryIncomeLoss…）は売上高として読まない
    expect(result.periods.every((p) => p.revenue_element === "NetSalesSummaryOfBusinessResults")).toBe(true);
  });

  it("S100UOKQ（届出書・IFRS）: 連結は売上収益（IFRS）、提出会社は営業収益（日本基準）。百万円", () => {
    const result = extract(readBusinessResultsFixture("S100UOKQ"));
    expect(result.status).toBe("ok");
    expect(pick(result, "2024-03-31", true)).toMatchObject({
      accounting_standard: "IFRS",
      net_sales: "1076584000000",
      revenue_element: "RevenueIFRSSummaryOfBusinessResults",
      operating_profit: null,
    });
    expect(pick(result, "2020-03-31", false)).toMatchObject({
      fiscal_year_start: "2019-04-01",
      accounting_standard: "JP",
      net_sales: "7638000000",
      revenue_element: "OperatingRevenue1SummaryOfBusinessResults",
    });
    expect(pick(result, "2020-03-31", true)).toBeUndefined();
  });

  it("S100VTA5（届出書・連結財務諸表なし）: 提出会社の売上高5期（NonConsolidatedMember）。8月決算", () => {
    const result = extract(readBusinessResultsFixture("S100VTA5"));
    expect(result.status).toBe("ok");
    expect(result.periods).toHaveLength(5);
    expect(result.periods.every((p) => !p.consolidated)).toBe(true);
    expect(result.periods[0]).toMatchObject({ fiscal_year_start: "2019-09-01", fiscal_year_end: "2020-08-31", net_sales: "1587314000" });
  });

  it("S100W7OT（有報）: 期の終了日は末日（決算短信の CurPerEn と同じ表し方）。営業利益の行が無い書類は ok で営業利益が NULL", () => {
    const result = extract(readBusinessResultsFixture("S100W7OT"));
    expect(result.status).toBe("ok");
    expect(result.periods).toHaveLength(10);
    const fy0 = pick(result, "2025-03-31", true);
    expect(fy0).toMatchObject({ fiscal_year_start: "2024-04-01", fiscal_year_end: "2025-03-31", net_sales: "410878000000", operating_profit: null });
    expect(result.periods.every((p) => p.operating_profit === null && p.operating_profit_element === null)).toBe(true);
  });

  it("S100DA8H（銀行持株会社）: 売上高は経常収益（OrdinaryIncome…）から読み、経常利益（OrdinaryIncomeLoss…）は読まない（R4）", () => {
    const result = extract(readBusinessResultsFixture("S100DA8H"));
    expect(result.status).toBe("ok");
    const consolidated = result.periods.filter((p) => p.consolidated);
    expect(consolidated.map((p) => p.revenue_element)).toEqual(Array(5).fill("OrdinaryIncomeSummaryOfBusinessResults"));
    // 連結経常収益 50,731 百万円（連結経常利益 10,165 百万円ではない）
    expect(pick(result, "2014-03-31", true)?.net_sales).toBe("50731000000");
    expect(pick(result, "2014-03-31", false)?.net_sales).toBe("2628000000");
  });
});

describe("組み立てたフィクスチャ（資料に沿った形）", () => {
  const cur = yearContext("CurrentYearDuration", "2024-04-01", "2025-03-31");
  const prior1 = yearContext("Prior1YearDuration", "2023-04-01", "2024-03-31");

  it("要素の定数: 経常利益・当期純利益などは売上高・営業利益の要素に無い", () => {
    const locals = [...REVENUE_ELEMENTS.map((e) => e.local), ...OPERATING_PROFIT_ELEMENTS.map((e) => e.local)];
    expect(locals).not.toContain("OrdinaryIncomeLossSummaryOfBusinessResults");
    expect(locals).not.toContain("NetIncomeLossSummaryOfBusinessResults");
    expect(locals).not.toContain("NetPremiumsWrittenSummaryOfBusinessResultsINS");
  });

  it("経常利益の要素だけの書類は、売上高として読まない（section_not_found）", () => {
    const result = extract(doc([cur], [amount("OrdinaryIncomeLossSummaryOfBusinessResults", "CurrentYearDuration", "1,000")]));
    expect(result).toMatchObject({ status: "section_not_found", periods: [] });
  });

  it("銀行の形（経常収益と経常利益の両方）: 売上高は経常収益", () => {
    const result = extract(
      doc(
        [cur],
        [
          amount("OrdinaryIncomeSummaryOfBusinessResults", "CurrentYearDuration", "50,000"),
          amount("OrdinaryIncomeLossSummaryOfBusinessResults", "CurrentYearDuration", "9,000"),
        ],
      ),
    );
    expect(result.periods).toEqual([
      expect.objectContaining({ net_sales: "50000000000", revenue_element: "OrdinaryIncomeSummaryOfBusinessResults" }),
    ]);
  });

  it("売上高と営業収益の両方がある書類は売上高を読む。IFRS と日本基準の要素が同じ期にあれば IFRS", () => {
    const both = extract(
      doc(
        [cur],
        [
          amount("OperatingRevenue1SummaryOfBusinessResults", "CurrentYearDuration", "200"),
          amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "150"),
        ],
      ),
    );
    expect(both.periods[0]).toMatchObject({ net_sales: "150000000", revenue_element: "NetSalesSummaryOfBusinessResults" });
    const ifrs = extract(
      doc(
        [cur],
        [
          amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "150"),
          amount("RevenueIFRSSummaryOfBusinessResults", "CurrentYearDuration", "160"),
        ],
      ),
    );
    expect(ifrs.periods[0]).toMatchObject({ net_sales: "160000000", accounting_standard: "IFRS" });
  });

  it("米国基準: 売上高と営業利益（OperatingIncomeLossUSGAAP…）を読む。損失は負の十進の文字列", () => {
    const result = extract(
      doc(
        [cur, prior1],
        [
          amount("RevenuesUSGAAPSummaryOfBusinessResults", "CurrentYearDuration", "1,200"),
          amount("OperatingIncomeLossUSGAAPSummaryOfBusinessResults", "CurrentYearDuration", "150"),
          amount("RevenuesUSGAAPSummaryOfBusinessResults", "Prior1YearDuration", "1,000"),
          amount("OperatingIncomeLossUSGAAPSummaryOfBusinessResults", "Prior1YearDuration", "20", { sign: "-" }),
        ],
      ),
    );
    expect(pick(result, "2025-03-31", true)).toMatchObject({
      accounting_standard: "US",
      net_sales: "1200000000",
      operating_profit: "150000000",
      operating_profit_element: "OperatingIncomeLossUSGAAPSummaryOfBusinessResults",
    });
    expect(pick(result, "2024-03-31", true)?.operating_profit).toBe("-20000000");
  });

  it("訂正届出書: 経営指標の記載があれば読む。記載が無ければ section_not_found", () => {
    const withTable = extract(doc([prior1], [amount("NetSalesSummaryOfBusinessResults", "Prior1YearDuration", "100")]));
    expect(withTable.status).toBe("ok");
    const withoutTable = extract(
      ixbrlDocument({ contexts: [context("FilingDateInstant", { instant: "2025-02-25" })], body: "<p>【訂正事項】発行価格の決定に伴う訂正</p>" }),
    );
    expect(withoutTable).toMatchObject({ status: "section_not_found", detail: null, periods: [] });
  });

  it("決算期の変更で9か月の期: 期間のまま保存する（変則決算の判定は DB が出典を問わず行う）", () => {
    const result = extract(
      doc(
        [yearContext("Prior1YearDuration", "2022-04-01", "2022-12-31"), yearContext("CurrentYearDuration", "2023-01-01", "2023-12-31")],
        [
          amount("NetSalesSummaryOfBusinessResults", "Prior1YearDuration", "160"),
          amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "250"),
        ],
      ),
    );
    expect(result.periods.map((p) => [p.fiscal_year_start, p.fiscal_year_end])).toEqual([
      ["2022-04-01", "2022-12-31"],
      ["2023-01-01", "2023-12-31"],
    ]);
  });

  it("中間期・時点・セグメントのコンテキストの事実は読まない（discardedFacts に数える）", () => {
    const result = extract(
      doc(
        [
          cur,
          context("InterimDuration", { start: "2025-04-01", end: "2025-09-30" }),
          context("CurrentYearInstant", { instant: "2025-03-31" }),
          context("CurrentYearDuration_ReportableSegmentsMember", {
            start: "2024-04-01",
            end: "2025-03-31",
            members: [["jpcrp_cor:OperatingSegmentsAxis", "jpcrp_cor:ReportableSegmentsMember"]],
          }),
        ],
        [
          amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "100"),
          amount("NetSalesSummaryOfBusinessResults", "InterimDuration", "60"),
          amount("NetSalesSummaryOfBusinessResults", "CurrentYearInstant", "1"),
          amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration_ReportableSegmentsMember", "80"),
        ],
      ),
    );
    expect(result.status).toBe("ok");
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0].net_sales).toBe("100000000");
    expect(result.discardedFacts).toBe(3);
  });

  it("DEI で連結財務諸表を作らない書類の、軸の無い事実は単体", () => {
    const result = extract(doc([cur], [amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "100")], { dei: "false" }));
    expect(result.periods[0].consolidated).toBe(false);
  });

  it("同じ事実の繰り返しは、値が等しければ1つにまとめる", () => {
    const result = extract(
      doc(
        [cur],
        [amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "100"), amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "100,000", { scale: "3" })],
      ),
    );
    expect(result.status).toBe("ok");
    expect(result.periods[0].net_sales).toBe("100000000");
  });

  it("失敗: 円以外の単位・同じ事実の値の食い違い・数値として読めない値 → invalid_values（一部の期だけを返さない）", () => {
    const usd = extract(doc([cur, prior1], [amount("NetSalesSummaryOfBusinessResults", "Prior1YearDuration", "90"), amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "100", { unitRef: "USD" })]));
    expect(usd).toMatchObject({ status: "invalid_values", detail: "non_jpy_unit", periods: [] });
    const conflict = extract(
      doc([cur], [amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "100"), amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "101")]),
    );
    expect(conflict).toMatchObject({ status: "invalid_values", detail: "conflicting_facts", periods: [] });
    const text = extract(
      doc(
        [cur, prior1],
        [
          amount("NetSalesSummaryOfBusinessResults", "Prior1YearDuration", "90"),
          nonFraction("jpcrp_cor:NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "約百", { unitRef: "JPY", decimals: "-6", scale: "6" }),
        ],
      ),
    );
    expect(text).toMatchObject({ status: "invalid_values", detail: "not_numeric", periods: [] });
    const badPeriod = extract(doc([yearContext("CurrentYearDuration", "2025-03-31", "2025-03-31")], [amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "1")]));
    expect(badPeriod).toMatchObject({ status: "invalid_values", detail: "invalid_period" });
  });

  it("xsi:nil の売上高は記載なし（NULL）。売上高も営業利益も無い期は行にしない", () => {
    const result = extract(
      doc(
        [cur, prior1],
        [amount("NetSalesSummaryOfBusinessResults", "CurrentYearDuration", "", { nil: true }), amount("NetSalesSummaryOfBusinessResults", "Prior1YearDuration", "100")],
      ),
    );
    expect(result.status).toBe("ok");
    expect(result.periods.map((p) => p.fiscal_year_end)).toEqual(["2024-03-31"]);
  });

  it("提出者の独自の要素だけで記載した売上高は読まない（section_not_found、revenue_element_unknown）", () => {
    const result = extract(
      doc(
        [cur],
        [nonFraction("jpcrp030000-asr_E99999-000:NetSalesOfServicesSummaryOfBusinessResults", "CurrentYearDuration", "100", { unitRef: "JPY", decimals: "-6", scale: "6" })],
      ),
    );
    expect(result).toMatchObject({ status: "section_not_found", detail: "revenue_element_unknown" });
  });
});
