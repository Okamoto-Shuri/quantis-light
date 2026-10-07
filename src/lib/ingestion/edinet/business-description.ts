import { codePointLength, trimWhitespace, WHITESPACE_CLASS } from "@/lib/text/whitespace";

import type { InlineXbrl, QName, TextBlockItem, XbrlFact } from "./xbrl";

/**
 * 有価証券報告書（インライン XBRL）の「第1 企業の概況 › 3 事業の内容」から、最初の段落を原文のまま取り出す（Sprint 16。F16）。
 * 規則は契約（docs/harness/sprints/sprint-16/contract.md）の第2章の4。要素とコンテキストは、公開の有報
 * （S100W7OT・S100W4KN・S100W5PD。__fixtures__/*-business-description.htm）で確かめた。
 *
 * (a) 区画: jpcrp_cor:DescriptionOfBusinessTextBlock。コンテキストは ID が FilingDateInstant で始まり、時点で、軸の無いものだけ。
 *     区画の見出し（「３【事業の内容】」の h3）はテキストブロックの中にある（実データ）。見出しの規則で飛ばす。
 * (b) 段落: ブロック要素・表・図・hr・空行（br の間の空白だけの行）で区切る。HTML の空白の連続は U+0020 1つ（ブラウザの表示と同じ）。
 *     改行（br）は U+000A。改行に隣接する U+0020 は除く。段落の前後の空白（全角空白・NBSP を含む JavaScript の \s）を除く。
 * (c) 最初の段落: 空の段落・見出しだけの段落（1行・最後が「。」「．」でない・40 コードポイント以下）を飛ばした最初の段落。表・図は段落にならない。
 */

export type BusinessDescriptionStatus = "ok" | "no_xbrl" | "section_not_found" | "invalid_values";

export type BusinessDescriptionExtraction = {
  status: BusinessDescriptionStatus;
  detail: string | null;
  /** status が ok のときだけ */
  paragraph: string | null;
  /** コンテキストの限定で読まなかった区画の事実の数 */
  discardedFacts: number;
};

export const BUSINESS_DESCRIPTION_CONCEPT = "DescriptionOfBusinessTextBlock";
/** 段落の長さの上限（コードポイント）。超えたら切らずに抽出の失敗にする */
export const PARAGRAPH_MAX_LENGTH = 20_000;
/** 見出しとみなす1行の段落の長さの上限（コードポイント） */
export const HEADING_MAX_LENGTH = 40;

const JPCRP_COR_NAMESPACE = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/[^/]+\/jpcrp_cor$/;

/** 事業の内容のテキストブロックの要素か（名前空間で照合する）。読み取りの options.textBlocks に渡す。 */
export function isBusinessDescriptionConcept(qname: QName): boolean {
  if (qname.local !== BUSINESS_DESCRIPTION_CONCEPT) return false;
  return qname.namespace === null ? qname.prefix === "jpcrp_cor" : JPCRP_COR_NAMESPACE.test(qname.namespace);
}

export function noXbrlBusinessDescription(detail: string | null = null): BusinessDescriptionExtraction {
  return { status: "no_xbrl", detail, paragraph: null, discardedFacts: 0 };
}

const HTML_WHITESPACE_RUN = /[\t\n\f\r ]+/g;
const BLANK_LINE = new RegExp(`^${WHITESPACE_CLASS}*$`, "u");

/** テキストブロックの項目の列を段落の文字列に分ける（前後の空白を除いた後で空の段落も含む）。 */
export function splitParagraphs(items: readonly TextBlockItem[]): string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [""];

  const flush = () => {
    // 空行（空白だけの行）で区切る
    let group: string[] = [];
    const emit = () => {
      if (group.length === 0) return;
      const text = group.join("\n").replace(/ *\n */g, "\n");
      paragraphs.push(trimWhitespace(text));
      group = [];
    };
    for (const raw of lines) {
      const line = raw.replace(HTML_WHITESPACE_RUN, " ");
      if (BLANK_LINE.test(line)) emit();
      else group.push(line);
    }
    emit();
    lines = [""];
  };

  for (const item of items) {
    switch (item.kind) {
      case "text":
        lines[lines.length - 1] += item.value;
        break;
      case "br":
        lines.push("");
        break;
      default:
        flush();
    }
  }
  flush();
  return paragraphs;
}

/** 見出しだけの段落か（1行・最後が句点でない・40 コードポイント以下） */
export function isHeadingParagraph(paragraph: string): boolean {
  if (paragraph.includes("\n")) return false;
  if (paragraph.endsWith("。") || paragraph.endsWith("．")) return false;
  return codePointLength(paragraph) <= HEADING_MAX_LENGTH;
}

/** 最初の段落（空・見出しを飛ばす）。無ければ null。 */
export function firstParagraph(items: readonly TextBlockItem[]): string | null {
  for (const paragraph of splitParagraphs(items)) {
    if (paragraph === "") continue;
    if (isHeadingParagraph(paragraph)) continue;
    return paragraph;
  }
  return null;
}

function isTargetContext(xbrl: InlineXbrl, fact: XbrlFact): boolean {
  const context = xbrl.contexts.get(fact.contextRef);
  return (
    context !== undefined &&
    context.id.startsWith("FilingDateInstant") &&
    context.instant !== null &&
    context.explicitMembers.length === 0 &&
    context.typedMemberCount === 0
  );
}

/** 事業の内容の最初の段落を抽出する。読み取りは options.textBlocks に isBusinessDescriptionConcept を渡して行うこと。 */
export function extractBusinessDescription(xbrl: InlineXbrl): BusinessDescriptionExtraction {
  const relevant = xbrl.facts.filter((fact) => fact.kind === "nonNumeric" && isBusinessDescriptionConcept(fact.concept));
  const targets = relevant.filter((fact) => isTargetContext(xbrl, fact));
  const discardedFacts = relevant.length - targets.length;
  const result = (status: BusinessDescriptionStatus, detail: string | null, paragraph: string | null = null): BusinessDescriptionExtraction => ({
    status,
    detail,
    paragraph,
    discardedFacts,
  });

  if (targets.length === 0) return result("section_not_found", null);
  if (targets.some((fact) => fact.continuedAt)) return result("invalid_values", "continuation_not_supported");
  if (targets.some((fact) => fact.textBlock === undefined)) {
    throw new Error("事業の内容のテキストブロックの構造がありません（読み取りの options.textBlocks を指定してください）");
  }

  const paragraphs = new Set(targets.map((fact) => (fact.nil ? null : firstParagraph(fact.textBlock!))));
  if (paragraphs.size > 1) return result("invalid_values", "conflicting_sections");
  const [paragraph] = [...paragraphs];
  if (paragraph === null) return result("invalid_values", "no_paragraph");
  if (codePointLength(paragraph) > PARAGRAPH_MAX_LENGTH) return result("invalid_values", "paragraph_too_long");
  return result("ok", null, paragraph);
}
