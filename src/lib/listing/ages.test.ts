import { describe, expect, it } from "vitest";

import { describeListingAge, listingAgeSchema, normalizeStockCode } from "./ages";

const base = {
  first_price_date: "2023-09-24",
  reference_date: "2026-09-24",
  listed_before_data_start: false,
  estimated_listing_years: 3,
  listing_years_lower_bound: null,
};

describe("describeListingAge", () => {
  it("DB の値（小数1桁に切り上げ済み）を、小数点以下1桁の表示にする", () => {
    expect(describeListingAge(base)).toEqual({ kind: "years", text: "3.0年" });
    expect(describeListingAge({ ...base, estimated_listing_years: 5.1 })).toEqual({ kind: "years", text: "5.1年" });
    expect(describeListingAge({ ...base, estimated_listing_years: 10 })).toEqual({ kind: "years", text: "10.0年" });
    expect(describeListingAge({ ...base, estimated_listing_years: 0 })).toEqual({ kind: "years", text: "0.0年" });
  });

  it("データ期間開始以前・未確定・基準日なしを区別する", () => {
    expect(
      describeListingAge({ ...base, listed_before_data_start: true, estimated_listing_years: null, listing_years_lower_bound: 9 }),
    ).toEqual({ kind: "before_data_start", text: "データ期間開始以前から上場（9年超）" });
    expect(describeListingAge({ ...base, first_price_date: null })).toEqual({
      kind: "undetermined",
      text: "未確定（株価の初出日をまだ取り込んでいません）",
    });
    expect(describeListingAge({ ...base, reference_date: null, estimated_listing_years: null })).toEqual({
      kind: "no_reference",
      text: "基準日がないため算出できません",
    });
  });

  it("numeric が文字列で返っても数値として読む", () => {
    const row = listingAgeSchema.parse({
      code: "99991",
      first_price_date: "2021-09-23",
      data_start_date: "2016-09-26",
      reference_date: "2026-09-24",
      listed_before_data_start: false,
      listing_years_exact: "5.00273972602739726027",
      estimated_listing_years: "5.1",
      listing_years_lower_bound: null,
    });
    expect(row.estimated_listing_years).toBe(5.1);
    expect(describeListingAge(row).text).toBe("5.1年");
  });
});

describe("normalizeStockCode", () => {
  it("前後の空白を除き、大文字にし、4文字なら末尾に 0 を足す", () => {
    expect(normalizeStockCode(" 8697 ")).toBe("86970");
    expect(normalizeStockCode("130a0")).toBe("130A0");
    expect(normalizeStockCode("99991")).toBe("99991");
  });

  it.each(["", "abc", "123", "123456", "12-34", "<script>", "9999\u0000"])("%j は不正", (input) => {
    expect(normalizeStockCode(input)).toBeNull();
  });
});
