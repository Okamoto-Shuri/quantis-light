import { describe, expect, it } from "vitest";

import {
  categoryTotals,
  formatTruncPct,
  holderReasonText,
  isEstimatedCategory,
  OWNER_RESULT_LABELS,
  ownerConditionText,
  presidentBasisNote,
  topHolderName,
  undeterminableReasonText,
} from "./display";
import { kanaToRomaji, romajiVariants } from "./romaji";

describe("比率の表示（切り捨て1桁）", () => {
  it.each([
    ["35.00", "35.0%"],
    ["19.98", "19.9%"],
    ["0", "0.0%"],
    ["4.00", "4.0%"],
    ["12.345", "12.3%"],
    ["100", "100.0%"],
  ])("%s → %s", (value, expected) => expect(formatTruncPct(value)).toBe(expected));
});

describe("文言", () => {
  it("判定結果のラベルと推定の区分", () => {
    expect(OWNER_RESULT_LABELS).toEqual({
      president_top: "該当（社長が筆頭株主）",
      owner_company: "該当（オーナー企業）",
      not_matched: "非該当",
      undeterminable: "判定不能",
    });
    expect(isEstimatedCategory("family")).toBe(true);
    expect(isEstimatedCategory("asset_company")).toBe(true);
    expect(isEstimatedCategory("president")).toBe(false);
  });

  it("分類理由（AC9.13 の例の形）", () => {
    expect(holderReasonText({ category: "president", reason_code: "president_name", reason: { president_name: "山田　太郎" } })).toBe(
      "社長『山田太郎』と氏名が一致",
    );
    expect(holderReasonText({ category: "family", reason_code: "president_surname", reason: { surname: "山田" } })).toBe(
      "社長と同姓『山田』の個人（親族と推定）",
    );
    expect(holderReasonText({ category: "asset_company", reason_code: "president_surname", reason: { surname: "山田" } })).toBe(
      "社長の姓『山田』を名称に含む法人（資産管理会社と推定）",
    );
    expect(
      holderReasonText({ category: "officer", reason_code: "officer_name", reason: { officer_name: "佐藤　一郎", officer_title: "取締役\nCFO" } }),
    ).toBe("役員『佐藤一郎（取締役 CFO）』と氏名が一致");
    expect(holderReasonText({ category: "asset_company", reason_code: "surname_reading", reason: { surname: "山田", reading: "ヤマダ" } })).toBe(
      "社長の姓『山田』の読み『ヤマダ』を名称に含む法人（資産管理会社と推定）",
    );
  });

  it("判定不能の理由・社長の特定の根拠・筆頭株主・条件の文", () => {
    expect(undeterminableReasonText({ undeterminable_reason: "no_annual_report", undeterminable_detail: null })).toBe("有報が未取得のため判定できません");
    expect(undeterminableReasonText({ undeterminable_reason: "annual_report_pending", undeterminable_detail: { doc_id: "S100X" } })).toContain("S100X");
    expect(
      undeterminableReasonText({ undeterminable_reason: "shareholders_not_extracted", undeterminable_detail: { status: "invalid_values", detail: "ratio_not_numeric" } }),
    ).toBe("有報から大株主を抽出できなかったため判定できません（『大株主の状況』の記載を読み取れませんでした（持株比率が数値でない行があります））");
    expect(presidentBasisNote("representative")).toBe("役職名に『社長』等が無いため、代表取締役を社長として扱っています");
    expect(presidentBasisNote("title")).toBeNull();
    expect(
      topHolderName([
        { rank: 1, name: "A", ratio_pct: "20", ratio_decimals: 2, category: "other" },
        { rank: 2, name: "B", ratio_pct: "20", ratio_decimals: 2, category: "president" },
      ]),
    ).toBe("A ほか 1 名（同率）");
    expect(ownerConditionText("any", "20")).toBe("オーナー系 ≥20% または社長が筆頭株主");
    expect(ownerConditionText("president", "20")).toBe("社長が筆頭株主のみ");
  });

  it("区分別の合計の6行", () => {
    const rows = categoryTotals({
      owner_total_pct: "35.00",
      category_pct: { president: "12.00", officer: "0", family: "5.00", asset_company: "18.00", other: "9.00" },
    });
    expect(rows?.map((r) => [r.label, formatTruncPct(r.value)])).toEqual([
      ["社長本人", "12.0%"],
      ["その他の役員本人", "0.0%"],
      ["同姓の親族（推定）", "5.0%"],
      ["資産管理会社（推定）", "18.0%"],
      ["オーナー系合計", "35.0%"],
      ["オーナー系以外", "9.0%"],
    ]);
  });
});

describe("読みのローマ字（辞書の生成）", () => {
  it("ヘボン式と長音の3つの形", () => {
    expect(kanaToRomaji("ヤマダ")).toBe("YAMADA");
    expect(kanaToRomaji("ハットリ")).toBe("HATTORI");
    expect(kanaToRomaji("キョウゴク")).toBe("KYOUGOKU");
    expect(kanaToRomaji("マッチ")).toBe("MATCHI");
    expect(romajiVariants("オオノ")).toEqual(["OONO", "ONO", "OHNO"]);
    expect(romajiVariants("サイトウ")).toEqual(["SAITOU", "SAITO", "SAITOH"]);
    expect(romajiVariants("ヤマダ")).toEqual(["YAMADA"]);
  });
});
