import { describe, expect, it } from "vitest";

import { conditionSource, describeInclusion, detailConditionsFromParams, stockDetailHref } from "./detail";

const evaluation = (status: Record<"cagr" | "margin" | "years", string>, matchesFilters = true, included = false) =>
  ({ status, matchesFilters, included }) as Parameters<typeof describeInclusion>[0];

describe("結果に含まれるかの1行（契約の第2章の2）", () => {
  it("含まれる", () => {
    expect(describeInclusion(evaluation({ cagr: "met", margin: "met", years: "met" }, true, true))).toEqual({
      kind: "included",
      text: "現在の条件でスクリーニング結果に含まれます",
    });
  });

  it("優先順位: 絞り込みの外 → unmet → 算出不可", () => {
    expect(describeInclusion(evaluation({ cagr: "unmet", margin: "unavailable", years: "met" }, false)).kind).toBe("filters");
    expect(describeInclusion(evaluation({ cagr: "unavailable", margin: "met", years: "unmet" })).text).toBe(
      "条件③を満たさないため、スクリーニング結果に含まれません",
    );
    expect(describeInclusion(evaluation({ cagr: "unmet", margin: "met", years: "unmet" })).text).toBe(
      "条件①・条件③を満たさないため、スクリーニング結果に含まれません",
    );
    expect(describeInclusion(evaluation({ cagr: "unavailable", margin: "unavailable", years: "met" })).text).toBe(
      "条件①・条件②が算出不可のため、スクリーニング結果から除外されています（『算出不可を含める』をオンにすると表示されます）",
    );
  });
});

describe("判定の条件と戻り先（第2章の1）", () => {
  it("クエリが無ければ既定の条件で、戻り先は /screening", () => {
    const dc = detailConditionsFromParams({});
    expect(dc).toMatchObject({ source: "default", invalidFields: [], screeningHref: "/screening" });
    expect(dc.conditions).toMatchObject({ cagr: "20", margin: "10", years: "5" });
    expect(conditionSource({ foo: "1" })).toBe("default");
  });

  it("スクリーニングの条件は正規形で戻り先に付ける。不正な項目は既定値にして報告する", () => {
    const dc = detailConditionsFromParams({ cagr: "15", off: "margin", page: "2", foo: "1" });
    expect(dc.source).toBe("screening");
    expect(dc.screeningHref).toBe("/screening?cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin&sort=cagr&order=desc&page=2");
    const bad = detailConditionsFromParams({ cagr: "abc", years: "0" });
    expect(bad.invalidFields).toEqual(["cagr", "years"]);
    expect(bad.conditions).toMatchObject({ cagr: "20", years: "5" });
    expect(bad.screeningHref).toBe("/screening?cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
  });

  it("行のリンク", () => {
    expect(stockDetailHref("99991", "cagr=20&margin=10&years=5&sort=cagr&order=desc")).toBe(
      "/stocks/99991?cagr=20&margin=10&years=5&sort=cagr&order=desc",
    );
    expect(stockDetailHref("99991", "")).toBe("/stocks/99991");
  });
});
