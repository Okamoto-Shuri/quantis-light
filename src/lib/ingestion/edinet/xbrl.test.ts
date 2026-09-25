import { describe, expect, it } from "vitest";

import { context, ixbrlDocument, JPCRP_COR_NS, nonFraction, nonNumeric, readRealFixture } from "./__fixtures__/synthetic";
import { applyNumberFormat, normalizeText, readInlineXbrl } from "./xbrl";

describe("readInlineXbrl（インライン XBRL の汎用の読み取り）", () => {
  it("コンテキスト（時点・期間、明示のメンバー、型付きのメンバー）を読む", () => {
    const html = ixbrlDocument({
      contexts: [
        context("CurrentYearInstant_No1MajorShareholdersMember", {
          instant: "2025-03-31",
          members: [["jpcrp_cor:MajorShareholdersAxis", "jpcrp_cor:No1MajorShareholdersMember"]],
        }),
        context("CurrentYearDuration", { start: "2024-04-01", end: "2025-03-31" }),
        context("Typed", { instant: "2025-03-31", typed: true }),
      ],
      body: "<p>本文</p>",
    });
    const { contexts } = readInlineXbrl([{ name: "a", html }]);
    expect(contexts.get("CurrentYearInstant_No1MajorShareholdersMember")).toEqual({
      id: "CurrentYearInstant_No1MajorShareholdersMember",
      instant: "2025-03-31",
      startDate: null,
      endDate: null,
      explicitMembers: [
        {
          dimension: { prefix: "jpcrp_cor", local: "MajorShareholdersAxis", namespace: JPCRP_COR_NS },
          member: { prefix: "jpcrp_cor", local: "No1MajorShareholdersMember", namespace: JPCRP_COR_NS },
        },
      ],
      typedMemberCount: 0,
    });
    expect(contexts.get("CurrentYearDuration")).toMatchObject({ instant: null, startDate: "2024-04-01", endDate: "2025-03-31" });
    expect(contexts.get("Typed")?.typedMemberCount).toBe(1);
  });

  it("接頭辞が違っても、xmlns の宣言で名前空間に直して読む", () => {
    const prefixes = { ix: "inl", xbrli: "xi", xbrldi: "xd", jpcrp: "crp" };
    const html = ixbrlDocument({
      prefixes,
      contexts: [context("C1", { instant: "2025-03-31", members: [["crp:MajorShareholdersAxis", "crp:No1MajorShareholdersMember"]], prefixes })],
      body: `<p>${nonNumeric("crp:NameMajorShareholders", "C1", "山田　太郎", { ix: "inl" })}</p>`,
    });
    const { contexts, facts } = readInlineXbrl([{ name: "a", html }]);
    expect(facts).toHaveLength(1);
    expect(facts[0].concept).toEqual({ prefix: "crp", local: "NameMajorShareholders", namespace: JPCRP_COR_NS });
    expect(facts[0].text).toBe("山田　太郎");
    expect(contexts.get("C1")?.explicitMembers[0].dimension.namespace).toBe(JPCRP_COR_NS);
  });

  it("2008 年版の ix の名前空間（EDINET の閲覧サイトの表示）も読む", () => {
    const html = ixbrlDocument({
      ixNamespace: "http://www.xbrl.org/2008/inlineXBRL",
      contexts: [context("C1", { instant: "2025-03-31" })],
      body: nonNumeric("jpcrp_cor:NameMajorShareholders", "C1", "A"),
    });
    expect(readInlineXbrl([{ name: "a", html }]).facts).toHaveLength(1);
  });

  it("nonFraction は format・scale・sign を適用したインスタンスの値を返す。xsi:nil は値 null", () => {
    const html = ixbrlDocument({
      contexts: [context("C1", { instant: "2025-03-31" })],
      body: [
        nonFraction("jpcrp_cor:ShareholdingRatio", "C1", "9.6", { decimals: "3", scale: "-2" }),
        nonFraction("jpcrp_cor:NumberOfSharesHeld", "C1", "7,554", { unitRef: "shares", decimals: "-3", scale: "3" }),
        nonFraction("jpcrp_cor:X", "C1", "1,234", { sign: "-", scale: "6" }),
        nonFraction("jpcrp_cor:Y", "C1", "－", { format: "ixt:zerodash" }),
        nonFraction("jpcrp_cor:Z", "C1", "", { nil: true }),
        nonFraction("jpcrp_cor:W", "C1", "一千", { format: "ixt:numwordsja" }),
      ].join(""),
    });
    const values = readInlineXbrl([{ name: "a", html }]).facts.map((f) => [f.concept.local, f.value, f.decimals, f.nil]);
    expect(values).toEqual([
      ["ShareholdingRatio", "0.096", "3", false],
      ["NumberOfSharesHeld", "7554000", "-3", false],
      ["X", "-1234000000", "4", false],
      ["Y", "0", "4", false],
      ["Z", null, "4", true],
      ["W", null, "4", false],
    ]);
  });

  it("nonNumeric の本文は、ブロックの要素を改行にして整える（ix:exclude は除く）", () => {
    const html = ixbrlDocument({
      contexts: [context("C1", { instant: "2025-06-27" })],
      body: nonNumeric(
        "jpcrp_cor:OfficialTitleOrPositionInformationAboutDirectorsAndCorporateAuditors",
        "C1",
        `<p><span>代表取締役社長</span></p><p><span>社長執行役員</span></p><p><span>&#160;</span></p><ix:exclude>（注）</ix:exclude>`,
      ),
    });
    expect(readInlineXbrl([{ name: "a", html }]).facts[0].text).toBe("代表取締役社長\n社長執行役員");
  });

  it("事実は複数のファイルをまたいで文書の順に並び、コンテキストはどのファイルにあってもよい", () => {
    const header = ixbrlDocument({ contexts: [context("C1", { instant: "2025-03-31" })], body: nonNumeric("jpcrp_cor:A", "C1", "1") });
    const second = ixbrlDocument({ contexts: [], body: `<p>見出し</p>${nonNumeric("jpcrp_cor:B", "C1", "2")}` });
    const { facts, contexts } = readInlineXbrl([
      { name: "0000000_header.htm", html: header },
      { name: "0101010_honbun.htm", html: second },
    ]);
    expect(facts.map((f) => [f.concept.local, f.document, f.index])).toEqual([
      ["A", 0, 0],
      ["B", 1, 1],
    ]);
    expect(facts[1].precedingText).toContain("見出し");
    expect(contexts.has("C1")).toBe(true);
  });

  it("実データの抜粋（S100W7OT）を読める", () => {
    const { contexts, facts } = readInlineXbrl([{ name: "S100W7OT", html: readRealFixture("S100W7OT") }]);
    expect(contexts.size).toBeGreaterThan(20);
    const names = facts.filter((f) => f.concept.local === "NameMajorShareholders");
    expect(names).toHaveLength(10);
    expect(names[0].text).toBe("日本マスタートラスト信託銀行株式会社（信託口）");
  });
});

describe("applyNumberFormat・normalizeText", () => {
  it("ixt の数の書式", () => {
    expect(applyNumberFormat("1,234.5", "ixt:numdotdecimal")).toBe("1234.5");
    expect(applyNumberFormat("1.234,5", "ixt:numcommadecimal")).toBe("1234.5");
    expect(applyNumberFormat("１２．３", null)).toBe("12.3");
    expect(applyNumberFormat("-", "ixt:zerodash")).toBe("0");
    expect(applyNumberFormat("abc", "ixt:numdotdecimal")).toBeNull();
  });

  it("行の前後の空白（全角を含む）と空の行を除き、行の中の全角の空白は保つ", () => {
    expect(normalizeText("\n  宗政　　寛  \n\n　取締役　\n")).toBe("宗政　　寛\n取締役");
  });
});
