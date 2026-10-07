import { describe, expect, it } from "vitest";

import { readDocumentArchive } from "./document-archive";
import {
  extractBusinessDescription,
  isBusinessDescriptionConcept,
  isHeadingParagraph,
  noXbrlBusinessDescription,
  PARAGRAPH_MAX_LENGTH,
} from "./business-description";
import { extractAnnualReport } from "./annual-report";
import { readInlineXbrl } from "./xbrl";
import {
  businessDescriptionDocument,
  context,
  FILING_DATE,
  ixbrlDocument,
  readBusinessDescriptionFixture,
  readRealFixture,
} from "./__fixtures__/synthetic";
import { zipSync, strToU8 } from "fflate";

function extract(html: string) {
  return extractBusinessDescription(readInlineXbrl([{ name: "doc", html }], { textBlocks: isBusinessDescriptionConcept }));
}

function paragraphOf(inner: string, options?: Parameters<typeof businessDescriptionDocument>[1]) {
  const result = extract(businessDescriptionDocument(inner, options));
  expect(result.status).toBe("ok");
  return result.paragraph;
}

describe("事業の内容（実データの抜粋。AC16.12）", () => {
  it("S100W7OT（ニップン）: 見出し（h3）を飛ばし、最初の段落だけを原文のまま採る", () => {
    expect(extract(readBusinessDescriptionFixture("S100W7OT"))).toEqual({
      status: "ok",
      detail: null,
      paragraph: "当社グループ（当社及び当社の関係会社）は、当社（株式会社ニップン）及び子会社58社、関連会社20社で構成されております。",
      discardedFacts: 0,
    });
  });

  it("S100W4KN: 改ページの &nbsp; の段落と「３&nbsp;【事業の内容】」の見出しを飛ばす。長い段落も切らない", () => {
    const result = extract(readBusinessDescriptionFixture("S100W4KN"));
    expect(result.status).toBe("ok");
    expect(result.paragraph).toBe(
      "当社グループは、当社及び連結子会社13社により構成されており、主な事業として、一般家庭向け環境衛生、企業向け環境衛生、戸建住宅及び企業・法人向けに太陽光発電システムの施工販売、電力の小売及び卸売、産業廃棄物由来のプラスチックを燃料とする資源循環型発電、有機廃液の資源リサイクル等の事業を行っております。",
    );
  });

  it("S100W5PD: 「次のとおりであります。」を含む段落もそのまま採り、続きの段落は採らない", () => {
    expect(extract(readBusinessDescriptionFixture("S100W5PD")).paragraph).toBe(
      "当社の事業内容は次のとおりであります。なお、当社は単一セグメントであるため、サービス別に記載しております。",
    );
  });

  it("既存の大株主・役員の抽出は、textBlocks を指定した読み取りでも結果が変わらない", () => {
    const html = readRealFixture("S100W7OT");
    const plain = extractAnnualReport(readInlineXbrl([{ name: "doc", html }]));
    const withBlocks = extractAnnualReport(readInlineXbrl([{ name: "doc", html }], { textBlocks: isBusinessDescriptionConcept }));
    expect(withBlocks).toEqual(plain);
    // 大株主・役員の抜粋には事業の内容の区画が無い
    expect(extract(html).status).toBe("section_not_found");
  });
});

describe("最初の段落の規則（第2章の4）", () => {
  const AC_EXAMPLE = "当社グループは、当社及び連結子会社3社で構成されており、中小企業向けのクラウド会計ソフトの開発・販売を主な事業としております。";

  it("AC16.2 の例: 見出しの行 → 字下げの段落 → 「次のとおり」の段落 → 画像 → 表。2行目の段落を、字下げを除いて採る", () => {
    const inner = `<p>(1) 事業の概要</p>
<p>　${AC_EXAMPLE}</p>
<p>　当社グループの事業内容と各社の位置付けは次のとおりであります。</p>
<p><img src="" alt="事業系統図"/></p>
<table><tr><td>セグメント</td><td>主な事業の内容</td></tr></table>`;
    expect(paragraphOf(inner)).toBe(AC_EXAMPLE);
  });

  it("仕様の見出しの例「＜当社グループの事業＞」「【事業系統図】」は飛ばす", () => {
    expect(paragraphOf(`<p>＜当社グループの事業＞</p><p>【事業系統図】</p><p>当社は検証用の事業を営んでおります。</p>`)).toBe(
      "当社は検証用の事業を営んでおります。",
    );
  });

  it("空の p・空白だけの p・&nbsp; の p・<br><br> の空行を飛ばす", () => {
    const inner = `<p></p><p>   </p><p>　　</p><p>&nbsp;</p><p><br/><br/></p><div>
  <br/>
</div><p>　当社は空行の後の段落です。</p>`;
    expect(paragraphOf(inner)).toBe("当社は空行の後の段落です。");
  });

  it("表と事業系統図の画像（alt 付き）が最初の段落より前にあっても、表の中の文と alt は採らない", () => {
    const inner = `<table><tr><td>当社は表の中の文であります。</td></tr></table>
<p><img src="" alt="当社グループは画像の代替テキストであります。"/></p>
<figure><figcaption>図の説明であります。</figcaption></figure>
<svg><text>SVG の文字であります。</text></svg>
<p>当社グループは、表と図の後の段落であります。</p>`;
    expect(paragraphOf(inner)).toBe("当社グループは、表と図の後の段落であります。");
  });

  it("「当社グループは…」で始まり「…次のとおりであります。」で終わる段落をそのまま採り、続きは採らない", () => {
    const first = "当社グループは、当社及び連結子会社5社で構成されており、事業の内容と各社の位置付けは次のとおりであります。";
    expect(paragraphOf(`<p>${first}</p><p>(1) 製品事業</p><p>当社が製造しております。</p>`)).toBe(first);
  });

  it("句点で終わる短い1行の段落は見出しとして飛ばさない", () => {
    expect(paragraphOf(`<p>当社は、不動産業を営んでおります。</p><p>次の段落。</p>`)).toBe("当社は、不動産業を営んでおります。");
    expect(paragraphOf(`<p>当社は不動産業を営む．</p>`)).toBe("当社は不動産業を営む．");
  });

  it("見出しの長さの境: 句点の無い1行は 40 コードポイントなら飛ばし、41 なら採る（サロゲートペアは1文字）", () => {
    const forty = "𠮷".repeat(40);
    const fortyOne = "あ".repeat(41);
    expect(isHeadingParagraph(forty)).toBe(true);
    expect(isHeadingParagraph(fortyOne)).toBe(false);
    expect(paragraphOf(`<p>${forty}</p><p>${fortyOne}</p>`)).toBe(fortyOne);
  });

  it("p の中の <br> 1つの2行は、改行（U+000A）を含む1つの段落（見出しの規則に当たらない）", () => {
    expect(paragraphOf(`<p>(1) 概要<br/>　当社は2行目です</p>`)).toBe("(1) 概要\n　当社は2行目です");
  });

  it("段落の中の文字は変えない（全角空白・記号・全角英数・括弧・文字参照）。装飾は文字だけになり、HTML の空白の連続は1つ", () => {
    const inner = `<p>　当社は「ＡＢＣ（株）」と<b>太字</b>・<a href="#">リンク</a>・<span>A&amp;B</span>・&lt;b&gt;・全角　空白・(1)を
    含む。</p>`;
    expect(paragraphOf(inner)).toBe("当社は「ＡＢＣ（株）」と太字・リンク・A&B・<b>・全角　空白・(1)を 含む。");
  });

  it("ix:exclude の中は採らず、入れ子の ix:nonNumeric の中は採る", () => {
    const inner = `<p>当社は<ix:exclude>除外される文</ix:exclude><ix:nonNumeric name="jpcrp_cor:X" contextRef="FilingDateInstant">入れ子の事実</ix:nonNumeric>を含みます。</p>`;
    expect(paragraphOf(inner)).toBe("当社は入れ子の事実を含みます。");
  });
});

describe("結果の種類", () => {
  it("区画が無い書類は section_not_found", () => {
    const html = ixbrlDocument({ contexts: [context("FilingDateInstant", { instant: FILING_DATE })], body: "<p>本文</p>" });
    expect(extract(html)).toMatchObject({ status: "section_not_found", detail: null, paragraph: null });
  });

  it("区画はあるが見出し・表・図・空の段落だけなら invalid_values（no_paragraph）", () => {
    const html = businessDescriptionDocument(`<p>&nbsp;</p><p>(1) 事業の概要</p><table><tr><td>表</td></tr></table><p><img src="" alt="図"/></p>`);
    expect(extract(html)).toMatchObject({ status: "invalid_values", detail: "no_paragraph", paragraph: null });
  });

  it("インライン XBRL の無い ZIP は no_xbrl（no_inline_xbrl）、XBRL のフラグの無い書類は no_xbrl（xbrl_flag_off）", () => {
    const zip = zipSync({ "XBRL/PublicDoc/jpcrp-asr.xbrl": strToU8("<xbrl/>") });
    const archive = readDocumentArchive(zip);
    expect(archive).toEqual({ kind: "no_xbrl", detail: "no_inline_xbrl" });
    expect(noXbrlBusinessDescription("no_inline_xbrl")).toMatchObject({ status: "no_xbrl", detail: "no_inline_xbrl" });
    expect(noXbrlBusinessDescription("xbrl_flag_off")).toMatchObject({ status: "no_xbrl", detail: "xbrl_flag_off" });
  });

  it("異なる段落の区画が2つなら conflicting_sections、同じ段落なら ok", () => {
    const block = (text: string) =>
      `<ix:nonNumeric name="jpcrp_cor:DescriptionOfBusinessTextBlock" contextRef="FilingDateInstant" escape="true"><p>${text}</p></ix:nonNumeric>`;
    const doc = (a: string, b: string) => ixbrlDocument({ contexts: [context("FilingDateInstant", { instant: FILING_DATE })], body: block(a) + block(b) });
    expect(extract(doc("当社は甲です。", "当社は乙です。"))).toMatchObject({ status: "invalid_values", detail: "conflicting_sections" });
    expect(extract(doc("当社は甲です。", "当社は甲です。"))).toMatchObject({ status: "ok", paragraph: "当社は甲です。" });
  });

  it("20,000 コードポイントを超える段落は切らずに paragraph_too_long。ちょうどなら ok", () => {
    const exact = "𠮷".repeat(PARAGRAPH_MAX_LENGTH - 1) + "。";
    expect(paragraphOf(`<p>${exact}</p>`)).toBe(exact);
    const over = "𠮷".repeat(PARAGRAPH_MAX_LENGTH) + "。";
    expect(extract(businessDescriptionDocument(`<p>${over}</p>`))).toMatchObject({
      status: "invalid_values",
      detail: "paragraph_too_long",
      paragraph: null,
    });
  });

  it("continuedAt のある区画は continuation_not_supported", () => {
    const html = businessDescriptionDocument(`<p>当社は続きのある段落です。</p>`, { attrs: `continuedAt="c1"` });
    expect(extract(html)).toMatchObject({ status: "invalid_values", detail: "continuation_not_supported" });
  });

  it("軸付き・FilingDateInstant でないコンテキストの区画は読まず、discardedFacts に数える", () => {
    const withMember = businessDescriptionDocument(`<p>当社は軸付きの段落です。</p>`, {
      contextRef: "FilingDateInstant_jpcrp030000-asr_E99999-000XMember",
    });
    expect(extract(withMember)).toMatchObject({ status: "section_not_found", discardedFacts: 1 });
    const otherContext = businessDescriptionDocument(`<p>当社は当期末の段落です。</p>`, { contextRef: "CurrentYearInstant" });
    expect(extract(otherContext)).toMatchObject({ status: "section_not_found", discardedFacts: 1 });
  });

  it("textBlocks を指定しない読み取りの結果を渡すと、黙って失敗にせず例外にする", () => {
    const html = businessDescriptionDocument(`<p>当社は検証用です。</p>`);
    expect(() => extractBusinessDescription(readInlineXbrl([{ name: "doc", html }]))).toThrow();
  });
});
