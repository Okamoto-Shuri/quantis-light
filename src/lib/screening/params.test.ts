import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONDITIONS,
  normalizeThreshold,
  parseScreeningParams,
  parseThresholdInput,
  searchParamsToRecord,
  serializeScreeningParams,
  thresholdErrorMessage,
  toScreenStocksParams,
} from "./params";

const parse = (query: string) => parseScreeningParams(searchParamsToRecord(new URLSearchParams(query)));

describe("閾値の文法（^-?\\d{1,4}(\\.\\d)?$ と範囲）", () => {
  it.each([
    ["20", "20"],
    ["20.0", "20"],
    ["20.5", "20.5"],
    ["-5", "-5"],
    ["-0", "0"],
    ["-0.0", "0"],
    ["005", "5"],
    ["020.0", "20"],
    ["0.1", "0.1"],
    ["1000", "1000"],
    ["-100", "-100"],
  ])("有効: %s → %s", (raw, expected) => {
    expect(normalizeThreshold("cagr", raw)).toBe(expected);
  });

  it.each(["+20", ".5", "20.", "20.55", "1e1", "Infinity", "NaN", "２０", " 20", "20 ", "", "12345", "1001", "-100.1", "abc", "0x10"])(
    "無効: %j",
    (raw) => {
      expect(normalizeThreshold("cagr", raw)).toBeNull();
    },
  );

  it("範囲は条件ごと（営業利益率 −100〜100、上場年数 0.1〜10.0）", () => {
    expect(normalizeThreshold("margin", "100")).toBe("100");
    expect(normalizeThreshold("margin", "100.1")).toBeNull();
    expect(normalizeThreshold("years", "0.1")).toBe("0.1");
    expect(normalizeThreshold("years", "0")).toBeNull();
    expect(normalizeThreshold("years", "10")).toBe("10");
    expect(normalizeThreshold("years", "10.1")).toBeNull();
    expect(normalizeThreshold("years", "-1")).toBeNull();
  });
});

describe("入力欄の値（空白の除去、NFKC、マイナスに見える記号）", () => {
  it.each([
    [" 20 ", "20"],
    ["２０", "20"],
    ["１５．５", "15.5"],
    ["－５", "-5"],
    ["−5", "-5"],
    ["ー5", "-5"],
    ["–5", "-5"],
  ])("%j → %s", (text, expected) => {
    expect(parseThresholdInput("cagr", text)).toBe(expected);
  });

  it("文法違反・範囲外は null", () => {
    expect(parseThresholdInput("cagr", "abc")).toBeNull();
    expect(parseThresholdInput("cagr", "20.55")).toBeNull();
    expect(parseThresholdInput("cagr", "1001")).toBeNull();
    expect(parseThresholdInput("years", "0")).toBeNull();
    expect(parseThresholdInput("years", "10.5")).toBeNull();
    expect(parseThresholdInput("cagr", "")).toBeNull();
  });

  it("エラーの文言は ASCII のハイフンで範囲を示す", () => {
    expect(thresholdErrorMessage("cagr")).toBe("-100〜1000 の数値を小数点以下1桁までで入力してください");
    expect(thresholdErrorMessage("margin")).toBe("-100〜100 の数値を小数点以下1桁までで入力してください");
    expect(thresholdErrorMessage("years")).toBe("0.1〜10 の数値を小数点以下1桁までで入力してください");
  });
});

describe("parseScreeningParams", () => {
  it("パラメータが無ければ既定値", () => {
    expect(parse("")).toEqual({ conditions: DEFAULT_CONDITIONS, invalidFields: [] });
  });

  it("有効な値を読む", () => {
    const { conditions, invalidFields } = parse(
      "cagr=15&margin=10.5&years=8&off=years,cagr&unavailable=include&market=0113,0111&sector=5250,3050&sort=years&order=asc&page=2",
    );
    expect(invalidFields).toEqual([]);
    expect(conditions).toEqual({
      cagr: "15",
      margin: "10.5",
      years: "8",
      owner: "20",
      ownerMode: "any",
      off: ["cagr", "years"],
      includeUnavailable: true,
      includeUndeterminable: false,
      market: ["0111", "0113"],
      sector: ["3050", "5250"],
      sort: "years",
      order: "asc",
      page: 2,
    });
  });

  it.each([
    ["cagr=abc", "cagr"],
    ["cagr=+20", "cagr"],
    ["cagr=1e1", "cagr"],
    ["cagr=", "cagr"],
    ["cagr=10&cagr=20", "cagr"],
    ["years=99", "years"],
    ["margin=100.5", "margin"],
    ["sort=zzz", "sort"],
    ["order=up", "order"],
    ["market=9999", "market"],
    ["sector=9999", "sector"],
    ["sector=5250&sector=3050", "sector"],
    ["page=-1", "page"],
    ["page=0", "page"],
    ["page=abc", "page"],
    ["page=1.5", "page"],
    ["off=foo", "off"],
    ["unavailable=yes", "unavailable"],
  ])("無効な項目 %s は既定値になり、%s を報告する", (query, field) => {
    const { conditions, invalidFields } = parse(query);
    expect(invalidFields).toEqual([field]);
    const key = field === "unavailable" ? "includeUnavailable" : (field as keyof typeof conditions);
    expect(conditions[key]).toEqual(DEFAULT_CONDITIONS[key]);
  });

  it("一部だけ不正なリストは、正しい要素だけを残して項目を報告する", () => {
    expect(parse("market=0111,9999")).toMatchObject({ conditions: { market: ["0111"] }, invalidFields: ["market"] });
    expect(parse("off=margin,foo")).toMatchObject({ conditions: { off: ["margin"] }, invalidFields: ["off"] });
    expect(parse("market=0111,")).toMatchObject({ conditions: { market: ["0111"] }, invalidFields: ["market"] });
    expect(parse("sector=5250,0000")).toMatchObject({ conditions: { sector: ["5250"] }, invalidFields: ["sector"] });
  });

  it("カンマ区切りの重複は除き、空のリストは指定なし", () => {
    expect(parse("market=0111,0111&off=cagr,cagr")).toEqual({
      conditions: { ...DEFAULT_CONDITIONS, market: ["0111"], off: ["cagr"] },
      invalidFields: [],
    });
    expect(parse("market=&off=&sector=")).toEqual({ conditions: DEFAULT_CONDITIONS, invalidFields: [] });
  });

  it("sector は固定の33業種の一覧で判定する（DB に銘柄が無い業種も有効）", () => {
    expect(parse("sector=0050")).toEqual({ conditions: { ...DEFAULT_CONDITIONS, sector: ["0050"] }, invalidFields: [] });
    expect(parse("sector=9050,7200")).toMatchObject({ conditions: { sector: ["7200", "9050"] }, invalidFields: [] });
  });

  it("unavailable=exclude と未知のパラメータは注記なしで受け付ける", () => {
    expect(parse("unavailable=exclude&foo=1&bar=2&bar=3")).toEqual({ conditions: DEFAULT_CONDITIONS, invalidFields: [] });
  });

  it("order が無ければ列ごとの既定の向き", () => {
    expect(parse("sort=years").conditions.order).toBe("asc");
    expect(parse("sort=margin").conditions.order).toBe("desc");
    expect(parse("sort=name").conditions.order).toBe("asc");
    expect(parse("order=asc").conditions).toMatchObject({ sort: "cagr", order: "asc" });
  });

  it("複数の無効な項目をまとめて報告する", () => {
    expect(parse("cagr=abc&years=99&page=0").invalidFields.sort()).toEqual(["cagr", "page", "years"]);
  });
});

describe("serializeScreeningParams（正規形）", () => {
  it("条件のパラメータは常に書き、その他は該当するときだけ", () => {
    expect(serializeScreeningParams(DEFAULT_CONDITIONS)).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&sort=cagr&order=desc");
  });

  it("off・unavailable・market・sector・page を決まった順で書く", () => {
    expect(
      serializeScreeningParams({
        ...DEFAULT_CONDITIONS,
        cagr: "15",
        off: ["years", "margin"],
        includeUnavailable: true,
        market: ["0113", "0111"],
        sector: ["5250", "3050"],
        sort: "years",
        order: "asc",
        page: 2,
      }),
    ).toBe(
      "cagr=15&margin=10&years=5&owner=20&ownermode=any&off=margin,years&unavailable=include&market=0111,0113&sector=3050,5250&sort=years&order=asc&page=2",
    );
  });

  it("読み直すと同じ条件になる（往復）", () => {
    const query = "cagr=-5&margin=0.5&years=0.1&owner=20&ownermode=any&off=cagr&market=0112&sector=0050&sort=sector&order=desc&page=3";
    const { conditions } = parse(query);
    expect(serializeScreeningParams(conditions)).toBe(query);
    expect(parse(serializeScreeningParams(conditions)).conditions).toEqual(conditions);
  });

  it("URL の値は正規形に書き直される（020.0 → 20、重複・未知・exclude を落とす）", () => {
    const { conditions } = parse("cagr=020.0&market=0111,0111&foo=1&unavailable=exclude");
    expect(serializeScreeningParams(conditions)).toBe("cagr=20&margin=10&years=5&owner=20&ownermode=any&market=0111&sort=cagr&order=desc");
  });
});

describe("toScreenStocksParams", () => {
  it("閾値は十進の文字列のまま DB に渡す（浮動小数点を経由しない）", () => {
    const params = toScreenStocksParams({ ...DEFAULT_CONDITIONS, cagr: "20.3", off: ["margin"] }, { clampPage: true });
    expect(params).toMatchObject({ cagr: "20.3", margin: "10", years: "5", cagrOn: true, marginOn: false, yearsOn: true, clampPage: true });
    expect(typeof params.cagr).toBe("string");
  });
});
