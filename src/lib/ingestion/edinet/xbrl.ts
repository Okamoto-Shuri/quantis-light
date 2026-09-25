import { parse, type DefaultTreeAdapterMap } from "parse5";

import { parseDecimal, shiftDecimal } from "./decimal";

/**
 * インライン XBRL（EDINET の提出本文書 XBRL/PublicDoc/*_ixbrl.htm）の汎用の読み取り。
 * 書類の種類や項目に依存しない（大株主・役員の抽出は annual-report.ts、Sprint 9 の「主要な経営指標等の推移」も
 * この読み取りの結果を使う）。
 *
 * - 文書（複数のファイル）を順に読み、事実（ix:nonNumeric・ix:nonFraction）を**文書の順**に返す。
 *   事実の直前の本文（前の事実からの文字列）も返す（表の見出しや注記で、同じ区画の2つの表を見分けるため）。
 * - コンテキスト（xbrli:context）は、どのファイルの ix:header にあっても集める。
 * - 接頭辞は、文書の xmlns の宣言で名前空間に直す（接頭辞の違いに依存しない）。宣言が無い接頭辞は名前空間 null。
 * - HTML として読む（parse5）。要素名・属性名は小文字になる。XHTML の空要素の書き方（<a/>）は、読む前に開始と終了の組に直す。
 */

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export const IX_NAMESPACES = new Set(["http://www.xbrl.org/2013/inlineXBRL", "http://www.xbrl.org/2008/inlineXBRL"]);
export const XBRLI_NAMESPACE = "http://www.xbrl.org/2003/instance";
export const XBRLDI_NAMESPACE = "http://xbrl.org/2006/xbrldi";

export type QName = { prefix: string; local: string; namespace: string | null };

export type XbrlContext = {
  id: string;
  instant: string | null;
  startDate: string | null;
  endDate: string | null;
  explicitMembers: { dimension: QName; member: QName }[];
  typedMemberCount: number;
};

export type XbrlFact = {
  /** 文書の順（0 から） */
  index: number;
  /** ファイルの番号（documents の順） */
  document: number;
  kind: "nonNumeric" | "nonFraction";
  concept: QName;
  contextRef: string;
  unitRef: string | null;
  nil: boolean;
  /** 表示されている文字列（改行・空白を整えた本文。nonFraction は表示の数字） */
  text: string;
  /**
   * 値。nonNumeric は text と同じ。nonFraction は、表示の数字に format・sign・scale を適用したインスタンスの値
   * （十進の文字列）。nil、または表示を数として読めない・未知の format なら null。
   */
  value: string | null;
  decimals: string | null;
  scale: number;
  format: string | null;
  /** 前の事実（入れ子の事実を含む）の後から、この事実の開始までの本文（最大 2,000 文字） */
  precedingText: string;
};

export type InlineXbrl = { contexts: Map<string, XbrlContext>; facts: XbrlFact[] };

const PRECEDING_TEXT_LIMIT = 2_000;
const BLOCK_ELEMENTS = new Set([
  "p", "div", "br", "tr", "li", "ul", "ol", "table", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd", "section", "blockquote",
]);

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function attr(element: Element, name: string): string | null {
  const found = element.attrs.find((a) => a.name === name);
  return found ? found.value : null;
}

/** XHTML の名前空間付きの空要素（<link:schemaRef ... />）を、開始と終了の組に直す（HTML の読み取りで後ろを飲み込まないように）。 */
function expandSelfClosing(html: string): string {
  return html.replace(/<([A-Za-z_][\w.-]*:[\w.-]+)(\s[^<>]*?)?\/>/g, (_match, tag: string, attrs: string | undefined) => `<${tag}${attrs ?? ""}></${tag}>`);
}

/** 空白（全角の空白は保つ）と改行を整える。行ごとに前後の空白を除き、空の行を除く。 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t \f\v]+/g, " ").replace(/^[ 　]+|[ 　]+$/g, ""))
    .filter((line) => line !== "")
    .join("\n");
}

function localName(tagName: string): { prefix: string; local: string } {
  const index = tagName.indexOf(":");
  return index < 0 ? { prefix: "", local: tagName } : { prefix: tagName.slice(0, index), local: tagName.slice(index + 1) };
}

type Namespaces = Map<string, string>;

function resolveQName(value: string, namespaces: Namespaces): QName {
  const trimmed = value.trim();
  const index = trimmed.indexOf(":");
  const prefix = index < 0 ? "" : trimmed.slice(0, index);
  const local = index < 0 ? trimmed : trimmed.slice(index + 1);
  return { prefix, local, namespace: namespaces.get(prefix.toLowerCase()) ?? null };
}

function collectNamespaces(node: Node, namespaces: Namespaces): void {
  if (isElement(node)) {
    for (const a of node.attrs) {
      if (a.name.startsWith("xmlns:")) namespaces.set(a.name.slice(6).toLowerCase(), a.value);
    }
  }
  if ("childNodes" in node) for (const child of node.childNodes) collectNamespaces(child, namespaces);
}

function elementNamespace(element: Element, namespaces: Namespaces): { namespace: string | null; local: string } {
  const { prefix, local } = localName(element.tagName);
  return { namespace: prefix ? (namespaces.get(prefix) ?? null) : null, local };
}

function isIx(element: Element, namespaces: Namespaces, local: string): boolean {
  const ns = elementNamespace(element, namespaces);
  return ns.local === local && ns.namespace !== null && IX_NAMESPACES.has(ns.namespace);
}

function isNs(element: Element, namespaces: Namespaces, namespace: string, local: string): boolean {
  const ns = elementNamespace(element, namespaces);
  return ns.local === local && ns.namespace === namespace;
}

/** 要素の本文（ix:exclude を除く。ブロックの要素は改行にする）。 */
function textOf(node: Node, namespaces: Namespaces): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
  if (!isElement(node) && !("childNodes" in node)) return "";
  if (isElement(node)) {
    if (isIx(node, namespaces, "exclude")) return "";
    const tag = node.tagName;
    if (tag === "br") return "\n";
    const inner = node.childNodes.map((child) => textOf(child, namespaces)).join("");
    if (BLOCK_ELEMENTS.has(tag)) return `\n${inner}\n`;
    if (tag === "td" || tag === "th") return `${inner} `;
    return inner;
  }
  return (node as DefaultTreeAdapterMap["parentNode"]).childNodes.map((child) => textOf(child, namespaces)).join("");
}

function findChild(element: Element, predicate: (e: Element) => boolean): Element | null {
  for (const child of element.childNodes) {
    if (!isElement(child)) continue;
    if (predicate(child)) return child;
    const nested = findChild(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function readContext(element: Element, namespaces: Namespaces): XbrlContext | null {
  const id = attr(element, "id");
  if (!id) return null;
  const text = (e: Element | null) => (e ? normalizeText(textOf(e, namespaces)) || null : null);
  const instant = text(findChild(element, (e) => isNs(e, namespaces, XBRLI_NAMESPACE, "instant")));
  const startDate = text(findChild(element, (e) => isNs(e, namespaces, XBRLI_NAMESPACE, "startdate")));
  const endDate = text(findChild(element, (e) => isNs(e, namespaces, XBRLI_NAMESPACE, "enddate")));
  const explicitMembers: XbrlContext["explicitMembers"] = [];
  let typedMemberCount = 0;
  const walk = (node: Element) => {
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (isNs(child, namespaces, XBRLDI_NAMESPACE, "explicitmember")) {
        const dimension = attr(child, "dimension");
        const member = normalizeText(textOf(child, namespaces));
        if (dimension && member) {
          explicitMembers.push({ dimension: resolveQName(dimension, namespaces), member: resolveQName(member, namespaces) });
        }
      } else if (isNs(child, namespaces, XBRLDI_NAMESPACE, "typedmember")) {
        typedMemberCount += 1;
      } else {
        walk(child);
      }
    }
  };
  walk(element);
  return { id, instant, startDate, endDate, explicitMembers, typedMemberCount };
}

/** ixt の format を適用して、表示の数字を十進の文字列にする。未知の format・数でない表示は null。 */
export function applyNumberFormat(display: string, format: string | null): string | null {
  const text = display.replace(/[\s 　]/g, "");
  const local = format ? format.slice(format.indexOf(":") + 1).toLowerCase() : null;
  let normalized: string;
  switch (local) {
    case null:
      normalized = text;
      break;
    case "numdotdecimal":
    case "num-dot-decimal":
    case "numcommadot":
      normalized = text.replace(/,/g, "");
      break;
    case "numcommadecimal":
    case "num-comma-decimal":
    case "numdotcomma":
      normalized = text.replace(/\./g, "").replace(/,/g, ".");
      break;
    case "zerodash":
    case "fixed-zero":
    case "numdash":
      return "0";
    default:
      return null;
  }
  // 全角の数字は半角に直す
  normalized = normalized.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/．/g, ".");
  return parseDecimal(normalized) ? normalized : null;
}

/**
 * インライン XBRL の文書（documents の順＝文書の順。EDINET の PublicDoc のファイル名の順）を読む。
 */
export function readInlineXbrl(documents: readonly { name: string; html: string }[]): InlineXbrl {
  const contexts = new Map<string, XbrlContext>();
  const facts: XbrlFact[] = [];
  let buffer = "";

  documents.forEach((doc, documentIndex) => {
    const tree = parse(expandSelfClosing(doc.html.replace(/^﻿+/, "")));
    const namespaces: Namespaces = new Map();
    collectNamespaces(tree, namespaces);

    const visit = (node: Node) => {
      if (node.nodeName === "#text") {
        buffer += (node as DefaultTreeAdapterMap["textNode"]).value;
        if (buffer.length > PRECEDING_TEXT_LIMIT * 2) buffer = buffer.slice(-PRECEDING_TEXT_LIMIT);
        return;
      }
      if (isElement(node)) {
        if (isNs(node, namespaces, XBRLI_NAMESPACE, "context")) {
          const context = readContext(node, namespaces);
          if (context) contexts.set(context.id, context);
          return;
        }
        if (isIx(node, namespaces, "header")) {
          // ix:header の中（ix:hidden の事実、ix:resources のコンテキスト）も読むが、本文には数えない
          const saved = buffer;
          for (const child of node.childNodes) visit(child);
          buffer = saved;
          return;
        }
        const isNonNumeric = isIx(node, namespaces, "nonnumeric");
        const isNonFraction = isIx(node, namespaces, "nonfraction");
        if (isNonNumeric || isNonFraction) {
          const name = attr(node, "name");
          const contextRef = attr(node, "contextref");
          if (name && contextRef) {
            const nil = attr(node, "xsi:nil") === "true";
            const text = normalizeText(textOf(node, namespaces));
            const format = attr(node, "format");
            const scaleRaw = attr(node, "scale");
            const scale = scaleRaw !== null && /^-?\d+$/.test(scaleRaw) ? Number(scaleRaw) : 0;
            let value: string | null;
            if (nil) {
              value = null;
            } else if (isNonNumeric) {
              value = text;
            } else {
              const number = applyNumberFormat(text, format);
              const signed = number !== null && attr(node, "sign") === "-" ? `-${number}` : number;
              value = signed === null ? null : shiftDecimal(signed, scale);
            }
            facts.push({
              index: facts.length,
              document: documentIndex,
              kind: isNonNumeric ? "nonNumeric" : "nonFraction",
              concept: resolveQName(name, namespaces),
              contextRef,
              unitRef: attr(node, "unitref"),
              nil,
              text,
              value,
              decimals: attr(node, "decimals"),
              scale,
              format,
              precedingText: normalizeText(buffer.slice(-PRECEDING_TEXT_LIMIT)),
            });
            buffer = "";
          }
        }
      }
      if ("childNodes" in node) for (const child of (node as DefaultTreeAdapterMap["parentNode"]).childNodes) visit(child);
    };
    visit(tree);
  });

  return { contexts, facts };
}
