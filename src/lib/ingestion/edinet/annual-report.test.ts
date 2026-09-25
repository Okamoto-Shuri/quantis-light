import { describe, expect, it } from "vitest";

import {
  context,
  CURRENT_YEAR,
  ixbrlDocument,
  nonFraction,
  nonNumeric,
  officerContext,
  officerRef,
  officerRow,
  readRealFixture,
  shareholderContext,
  shareholderRow,
} from "./__fixtures__/synthetic";
import { extractAnnualReport } from "./annual-report";
import { readInlineXbrl } from "./xbrl";

function extract(html: string) {
  return extractAnnualReport(readInlineXbrl([{ name: "doc", html }]));
}

function doc({ contexts, shareholders = "", officers = "" }: { contexts: string[]; shareholders?: string; officers?: string }) {
  return ixbrlDocument({
    contexts,
    body: `<h3>（６）【大株主の状況】</h3><table>${shareholders}</table><h3>４【役員の状況】</h3><table>${officers}</table>`,
  });
}

describe("実データの抜粋（EDINET の公開の有報）", () => {
  it("S100W7OT: 大株主10名（信託口・持株会・法人）と役員12名。比率は小数点以下1桁の記載", () => {
    const result = extract(readRealFixture("S100W7OT"));
    expect(result.shareholdersStatus).toBe("ok");
    expect(result.shareholders).toHaveLength(10);
    expect(result.shareholders[0]).toEqual({
      rank: 1,
      name: "日本マスタートラスト信託銀行株式会社（信託口）",
      address: "東京都港区赤坂１丁目８番１号",
      shares_held: "7554000",
      ratio_pct: "9.6",
      ratio_decimals: 1,
    });
    expect(result.shareholders.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.officersStatus).toBe("ok");
    expect(result.officers).toHaveLength(12);
    // 兼務の表記（複数の行の役職名）を1つの文字列として保つ。旧字体（﨑）も記載のまま
    expect(result.officers[0]).toEqual({ seq: 1, name: "前鶴　俊哉", title: "代表取締役社長\n社長執行役員" });
    expect(result.officers[2].name).toBe("川﨑　裕章");
    expect(result.officers[2].title.split("\n")[0]).toBe("取締役");
    expect(result.officersHasPostAgmTable).toBe(false);
    expect(result.officersBasis).toBe("filing_date");
    expect(result.officersOrderSource).toBe("inline_document");
  });

  it("S100W4KN: 株主総会の前の提出で、総会後の役員の表（…Proposal の要素）がある。提出日現在の11名だけを保存する", () => {
    const result = extract(readRealFixture("S100W4KN"));
    expect(result.officersStatus).toBe("ok");
    expect(result.officersHasPostAgmTable).toBe(true);
    expect(result.officers).toHaveLength(11);
    expect(result.officers[0]).toEqual({ seq: 1, name: "宗政　　寛", title: "代表取締役社長" });
    // 総会後の表にだけいる新任の候補者は、提出日現在の役員に混ざらない
    expect(result.officers.map((o) => o.name).join()).not.toContain("塩原");
    // 個人の大株主（社長本人）と法人の大株主。比率は小数点以下2桁の記載
    expect(result.shareholders.slice(0, 2)).toEqual([
      { rank: 1, name: "株式会社バイオン", address: "福岡市博多区博多駅東１丁目13番９号", shares_held: "8716000", ratio_pct: "18.23", ratio_decimals: 2 },
      { rank: 2, name: "宗政　寛", address: "福岡市南区", shares_held: "6454000", ratio_pct: "13.50", ratio_decimals: 2 },
    ]);
  });

  it("S100W5PD: 所有株式数が株の単位（scale 0）、外国名義（常任代理人の記載つき）", () => {
    const result = extract(readRealFixture("S100W5PD"));
    expect(result.shareholders[0]).toMatchObject({ shares_held: "2197499", ratio_pct: "69.38" });
    expect(result.shareholders[2].name).toContain("ＮＯＭＵＲＡ　ＰＢ　ＮＯＭＩＮＥＥＳ");
    expect(result.shareholders[2].name).toContain("（常任代理人野村證券株式会社）");
    expect(result.officers[0]).toEqual({ seq: 1, name: "平尾　泰文", title: "代表取締役社長" });
  });
});

describe("大株主の状況", () => {
  const contexts = [1, 2, 3, 4, 5].map(shareholderContext);

  it("個人（全角の空白・旧字体）・法人・信託口・外国名義を同じ形で保存し、合計の行（メンバーなし）は読まない", () => {
    const total = context("CurrentYearInstant", { instant: CURRENT_YEAR });
    const html = doc({
      contexts: [...contexts, total],
      shareholders: [
        shareholderRow(1, "髙橋　一郎", "東京都港区", "3,210", "32.10"),
        shareholderRow(2, "株式会社タカハシホールディングス", "東京都港区", "1,500", "15.00"),
        shareholderRow(3, "日本マスタートラスト信託銀行株式会社（信託口）", "東京都港区", "900", "9.00"),
        shareholderRow(4, "株式会社日本カストディ銀行（信託口４）", "東京都中央区", "129", "1.29"),
        shareholderRow(5, "THE BANK OF NEW YORK MELLON 140044", "NEW YORK, U.S.A.", "57", "0.57"),
        `<tr><td>計</td><td></td><td>${nonFraction("jpcrp_cor:NumberOfSharesHeld", "CurrentYearInstant", "5,796", { unitRef: "shares", decimals: "-3", scale: "3" })}</td><td>${nonFraction("jpcrp_cor:ShareholdingRatio", "CurrentYearInstant", "57.96", { scale: "-2" })}</td></tr>`,
      ].join(""),
    });
    const result = extract(html);
    expect(result.shareholdersStatus).toBe("ok");
    expect(result.shareholders.map((s) => [s.rank, s.name, s.shares_held, s.ratio_pct, s.ratio_decimals])).toEqual([
      [1, "髙橋　一郎", "3210000", "32.10", 2],
      [2, "株式会社タカハシホールディングス", "1500000", "15.00", 2],
      [3, "日本マスタートラスト信託銀行株式会社（信託口）", "900000", "9.00", 2],
      [4, "株式会社日本カストディ銀行（信託口４）", "129000", "1.29", 2],
      [5, "THE BANK OF NEW YORK MELLON 140044", "57000", "0.57", 2],
    ]);
    expect(result.discardedFacts).toBe(2); // 合計の行の2つ
  });

  it("持株比率は十進のまま百分率にする（0.0057 → 0.57、0.12345 → 12.345）。記載の桁数は decimals − 2", () => {
    const html = doc({
      contexts: contexts.slice(0, 3),
      shareholders: [
        // インスタンスの値が比率そのもの（scale 0）の書き方
        `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No1MajorShareholdersMember", "A")}</td><td>${nonFraction("jpcrp_cor:ShareholdingRatio", "CurrentYearInstant_No1MajorShareholdersMember", "0.0057", { decimals: "4" })}</td></tr>`,
        `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No2MajorShareholdersMember", "B")}</td><td>${nonFraction("jpcrp_cor:ShareholdingRatio", "CurrentYearInstant_No2MajorShareholdersMember", "0.0129", { decimals: "4" })}</td></tr>`,
        `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No3MajorShareholdersMember", "C")}</td><td>${nonFraction("jpcrp_cor:ShareholdingRatio", "CurrentYearInstant_No3MajorShareholdersMember", "0.12345", { decimals: "5" })}</td></tr>`,
      ].join(""),
    });
    const result = extract(html);
    expect(result.shareholders.map((s) => [s.ratio_pct, s.ratio_decimals, s.shares_held])).toEqual([
      ["0.57", 2, null],
      ["1.29", 2, null],
      ["12.345", 3, null],
    ]);
  });

  it("議決権の割合の表（別のメンバー・別の軸）は読まず、所有株式数の割合の表だけを保存する", () => {
    const voting = context("CurrentYearInstant_No1MajorShareholdersVotingRightsMember", {
      instant: CURRENT_YEAR,
      members: [["jpcrp_cor:MajorShareholdersAxis", "jpcrp_cor:No1MajorShareholdersVotingRightsMember"]],
    });
    const twoAxes = context("CurrentYearInstant_No1MajorShareholdersMember_OrdinarySharesMember", {
      instant: CURRENT_YEAR,
      members: [
        ["jpcrp_cor:MajorShareholdersAxis", "jpcrp_cor:No1MajorShareholdersMember"],
        ["jpcrp_cor:ClassesOfSharesAxis", "jpcrp_cor:OrdinarySharesMember"],
      ],
    });
    const html = doc({
      contexts: [shareholderContext(1), voting, twoAxes],
      shareholders: [
        shareholderRow(1, "山田　太郎", "東京都", "100", "10.00"),
        `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No1MajorShareholdersVotingRightsMember", "議決権 太郎")}</td><td>${nonFraction("jpcrp_cor:ShareholdingRatio", "CurrentYearInstant_No1MajorShareholdersVotingRightsMember", "30.00", { scale: "-2" })}</td></tr>`,
        `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No1MajorShareholdersMember_OrdinarySharesMember", "普通株 太郎")}</td></tr>`,
      ].join(""),
    });
    const result = extract(html);
    expect(result.shareholdersStatus).toBe("ok");
    expect(result.shareholders).toEqual([{ rank: 1, name: "山田　太郎", address: "東京都", shares_held: "100000", ratio_pct: "10.00", ratio_decimals: 2 }]);
    expect(result.discardedFacts).toBe(3);
  });

  it("議決権の割合の表だけの書類は section_not_found（理由 other_table_only）", () => {
    const voting = context("CurrentYearInstant_No1MajorShareholdersVotingRightsMember", {
      instant: CURRENT_YEAR,
      members: [["jpcrp_cor:MajorShareholdersAxis", "jpcrp_cor:No1MajorShareholdersVotingRightsMember"]],
    });
    const result = extract(
      doc({
        contexts: [voting],
        shareholders: `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No1MajorShareholdersVotingRightsMember", "議決権 太郎")}</td></tr>`,
      }),
    );
    expect(result.shareholdersStatus).toBe("section_not_found");
    expect(result.shareholdersDetail).toBe("other_table_only");
  });

  it("大株主の要素が無ければ section_not_found", () => {
    const result = extract(doc({ contexts: [officerContext("AMember")], officers: officerRow("AMember", "取締役", "A") }));
    expect(result.shareholdersStatus).toBe("section_not_found");
    expect(result.shareholdersDetail).toBeNull();
    expect(result.officersStatus).toBe("ok");
  });

  it.each([
    ["比率が数値でない", shareholderRow(1, "A", "東京都", "100", "一〇"), "ratio_not_numeric"],
    ["氏名の欠け", shareholderRow(1, "", "東京都", "100", "10.00"), "missing_name"],
    [
      "比率の欠け",
      `<tr><td>${nonNumeric("jpcrp_cor:NameMajorShareholders", "CurrentYearInstant_No1MajorShareholdersMember", "A")}</td></tr>`,
      "missing_ratio",
    ],
    ["同じ順位に異なる記載", shareholderRow(1, "A", "東京都", "100", "10.00") + shareholderRow(1, "B", "東京都", "100", "10.00"), "duplicate_rank"],
  ])("%s → invalid_values（正しい行だけを返さない）", (_label, rows, detail) => {
    const html = doc({ contexts, shareholders: shareholderRow(2, "正しい 行", "東京都", "50", "5.00") + rows });
    const result = extract(html);
    expect(result.shareholdersStatus).toBe("invalid_values");
    expect(result.shareholdersDetail).toBe(detail);
    expect(result.shareholders).toEqual([]);
  });

  it("同じ事実の重複（値が同じ）は1行として扱う", () => {
    const html = doc({ contexts, shareholders: shareholderRow(1, "A", "東京都", "100", "10.00") + shareholderRow(1, "A", "東京都", "100", "10.00") });
    expect(extract(html).shareholders).toHaveLength(1);
  });
});

describe("役員の状況", () => {
  const members = ["YamadaTaroMember", "SatoIchiroMember", "SuzukiHanakoMember", "TakahashiJiroMember"];
  const contexts = members.map(officerContext);

  it("兼務の表記（改行・「兼」・括弧の中の兼務）と監査等委員を、記載のまま保存する", () => {
    const html = doc({
      contexts,
      officers: [
        officerRow("YamadaTaroMember", "<p>代表取締役社長</p><p>社長執行役員</p>", "山田　太郎"),
        officerRow("SatoIchiroMember", "<p>取締役</p><p>（管理本部長兼経理部長）</p>", "佐藤　一郎"),
        officerRow("SuzukiHanakoMember", "<p>取締役（監査等委員）</p>", "鈴木　花子"),
        officerRow("TakahashiJiroMember", "<p>代表取締役会長 兼 CEO</p>", "髙橋　次郎"),
      ].join(""),
    });
    const result = extract(html);
    expect(result.officersStatus).toBe("ok");
    expect(result.officers).toEqual([
      { seq: 1, name: "山田　太郎", title: "代表取締役社長\n社長執行役員" },
      { seq: 2, name: "佐藤　一郎", title: "取締役\n（管理本部長兼経理部長）" },
      { seq: 3, name: "鈴木　花子", title: "取締役（監査等委員）" },
      { seq: 4, name: "髙橋　次郎", title: "代表取締役会長 兼 CEO" },
    ]);
  });

  it("記載順はインライン XBRL の文書の順（表示リンクで順が決まらなくても、コンテキストの定義の順や名前の順には並べない）", () => {
    // コンテキストの定義の順（ix:resources）とメンバーの名前の順を、文書の順と逆にしておく
    const html = doc({
      contexts: [...contexts].reverse(),
      officers: [
        officerRow("TakahashiJiroMember", "代表取締役社長", "髙橋　次郎"),
        officerRow("YamadaTaroMember", "取締役", "山田　太郎"),
        officerRow("SuzukiHanakoMember", "監査役", "鈴木　花子"),
      ].join(""),
    });
    const result = extract(html);
    expect(result.officers.map((o) => o.name)).toEqual(["髙橋　次郎", "山田　太郎", "鈴木　花子"]);
    expect(result.officersOrderSource).toBe("inline_document");
  });

  it("総会後の役員の表（…Proposal の要素。同じコンテキスト）は混ぜず、ありと記録する", () => {
    const html = doc({
      contexts: [...contexts, officerContext("NewcomerMember")],
      officers: [
        officerRow("YamadaTaroMember", "代表取締役社長", "山田　太郎"),
        officerRow("SatoIchiroMember", "取締役", "佐藤　一郎"),
        "</table><p>２．2025年６月26日開催予定の定時株主総会の議案承認可決後の役員一覧予定</p><table>",
        officerRow("YamadaTaroMember", "代表取締役会長", "山田　太郎", { proposal: true }),
        officerRow("NewcomerMember", "代表取締役社長", "新任　三郎", { proposal: true }),
      ].join(""),
    });
    const result = extract(html);
    expect(result.officersStatus).toBe("ok");
    expect(result.officersHasPostAgmTable).toBe(true);
    expect(result.officers).toEqual([
      { seq: 1, name: "山田　太郎", title: "代表取締役社長" },
      { seq: 2, name: "佐藤　一郎", title: "取締役" },
    ]);
  });

  it("提出日の時点でないコンテキスト・別の軸のコンテキストの事実は読まない", () => {
    const other = context("CurrentYearInstant_jpcrp030000-asr_E99999-000YamadaTaroMember", {
      instant: CURRENT_YEAR,
      members: [["jpcrp_cor:DirectorsAndOtherOfficersAxis", "jpcrp030000-asr_E99999-000:YamadaTaroMember"]],
    });
    const html = doc({
      contexts: [officerContext("YamadaTaroMember"), other],
      officers:
        officerRow("YamadaTaroMember", "代表取締役社長", "山田　太郎") +
        `<tr><td>${nonNumeric("jpcrp_cor:NameInformationAboutDirectorsAndCorporateAuditors", "CurrentYearInstant_jpcrp030000-asr_E99999-000YamadaTaroMember", "別の時点")}</td></tr>`,
    });
    const result = extract(html);
    expect(result.officers).toEqual([{ seq: 1, name: "山田　太郎", title: "代表取締役社長" }]);
    expect(result.discardedFacts).toBe(1);
  });

  it("同じ役員に異なる記載があれば invalid_values（duplicate_officer）。役職名の欠けは missing_title", () => {
    const duplicate = doc({
      contexts,
      officers: officerRow("YamadaTaroMember", "代表取締役社長", "山田　太郎") + officerRow("YamadaTaroMember", "取締役", "山田　太郎"),
    });
    expect(extract(duplicate)).toMatchObject({ officersStatus: "invalid_values", officersDetail: "duplicate_officer", officers: [] });

    const missingTitle = doc({
      contexts,
      officers: `<tr><td>${nonNumeric("jpcrp_cor:NameInformationAboutDirectorsAndCorporateAuditors", officerRef("YamadaTaroMember"), "山田　太郎")}</td></tr>`,
    });
    expect(extract(missingTitle)).toMatchObject({ officersStatus: "invalid_values", officersDetail: "missing_title" });
  });

  it("役員の要素が無ければ section_not_found", () => {
    const result = extract(doc({ contexts: [shareholderContext(1)], shareholders: shareholderRow(1, "A", "東京都", "1", "1.00") }));
    expect(result.officersStatus).toBe("section_not_found");
    expect(result.officersBasis).toBeNull();
  });
});
