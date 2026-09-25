/**
 * テスト用のインライン XBRL を組み立てる（テストからだけ import する。アプリの画面・DB には出ない）。
 * 形は EDINET の公開の有報（同じフォルダの S100W7OT.htm などの実データの抜粋）に合わせる:
 * XHTML のルートの xmlns の宣言、非表示の ix:header の ix:resources にあるコンテキスト、本文の表の中の ix:nonNumeric・ix:nonFraction。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const JPCRP_COR_NS = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor";
export const FILER_NS = "http://disclosure.edinet-fsa.go.jp/jpcrp030000/asr/001/E99999-000/2025-03-31/01/2025-06-27";

/** 実データの抜粋のフィクスチャ（S100W7OT・S100W4KN・S100W5PD）を読む。 */
export function readRealFixture(docId: "S100W7OT" | "S100W4KN" | "S100W5PD"): string {
  return readFileSync(resolve(import.meta.dirname, `${docId}.htm`), "utf8");
}

type Prefixes = { ix?: string; xbrli?: string; xbrldi?: string; jpcrp?: string; filer?: string };

export function ixbrlDocument({
  contexts,
  body,
  prefixes = {},
  ixNamespace = "http://www.xbrl.org/2013/inlineXBRL",
}: {
  contexts: string[];
  body: string;
  prefixes?: Prefixes;
  ixNamespace?: string;
}): string {
  const p = { ix: "ix", xbrli: "xbrli", xbrldi: "xbrldi", jpcrp: "jpcrp_cor", filer: "jpcrp030000-asr_E99999-000", ...prefixes };
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:${p.ix}="${ixNamespace}" xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2011-07-31" xmlns:${p.xbrli}="http://www.xbrl.org/2003/instance" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:${p.jpcrp}="${JPCRP_COR_NS}" xmlns:${p.filer}="${FILER_NS}" xmlns:${p.xbrldi}="http://xbrl.org/2006/xbrldi" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
<head><title>テスト</title></head>
<body>
<div style="display:none"><${p.ix}:header><${p.ix}:references><link:schemaRef xlink:type="simple" xlink:href="x.xsd"/></${p.ix}:references><${p.ix}:resources>
${contexts.join("\n")}
</${p.ix}:resources></${p.ix}:header></div>
${body}
</body>
</html>`;
}

export function context(
  id: string,
  {
    instant,
    start,
    end,
    members = [],
    typed = false,
    prefixes = {},
  }: { instant?: string; start?: string; end?: string; members?: [string, string][]; typed?: boolean; prefixes?: Prefixes },
): string {
  const x = prefixes.xbrli ?? "xbrli";
  const d = prefixes.xbrldi ?? "xbrldi";
  const period = instant ? `<${x}:instant>${instant}</${x}:instant>` : `<${x}:startDate>${start}</${x}:startDate><${x}:endDate>${end}</${x}:endDate>`;
  const scenario =
    members.length > 0 || typed
      ? `<${x}:scenario>${members.map(([dim, mem]) => `<${d}:explicitMember dimension="${dim}">${mem}</${d}:explicitMember>`).join("")}${
          typed ? `<${d}:typedMember dimension="jpcrp_cor:X"><v>1</v></${d}:typedMember>` : ""
        }</${x}:scenario>`
      : "";
  return `<${x}:context id="${id}"><${x}:entity><${x}:identifier scheme="http://disclosure.edinet-fsa.go.jp">E99999-000</${x}:identifier></${x}:entity><${x}:period>${period}</${x}:period>${scenario}</${x}:context>`;
}

export function nonNumeric(name: string, contextRef: string, html: string, { ix = "ix", nil = false } = {}): string {
  return nil
    ? `<${ix}:nonNumeric name="${name}" contextRef="${contextRef}" xsi:nil="true"></${ix}:nonNumeric>`
    : `<${ix}:nonNumeric name="${name}" contextRef="${contextRef}" escape="true">${html}</${ix}:nonNumeric>`;
}

export function nonFraction(
  name: string,
  contextRef: string,
  display: string,
  {
    unitRef = "pure",
    decimals = "4",
    scale = "0",
    format = "ixt:numdotdecimal",
    sign,
    ix = "ix",
    nil = false,
  }: { unitRef?: string; decimals?: string; scale?: string; format?: string | null; sign?: "-"; ix?: string; nil?: boolean } = {},
): string {
  const attrs = [
    `name="${name}"`,
    `contextRef="${contextRef}"`,
    `unitRef="${unitRef}"`,
    `decimals="${decimals}"`,
    `scale="${scale}"`,
    format ? `format="${format}"` : "",
    sign ? `sign="${sign}"` : "",
    nil ? `xsi:nil="true"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<${ix}:nonFraction ${attrs}>${nil ? "" : display}</${ix}:nonFraction>`;
}

export const CURRENT_YEAR = "2025-03-31";
export const FILING_DATE = "2025-06-27";

/** 大株主の行のコンテキスト（CurrentYearInstant_No{n}MajorShareholdersMember） */
export function shareholderContext(rank: number): string {
  return context(`CurrentYearInstant_No${rank}MajorShareholdersMember`, {
    instant: CURRENT_YEAR,
    members: [["jpcrp_cor:MajorShareholdersAxis", `jpcrp_cor:No${rank}MajorShareholdersMember`]],
  });
}

/** 役員のコンテキスト（FilingDateInstant_<提出者のメンバー>） */
export function officerContext(member: string): string {
  return context(`FilingDateInstant_jpcrp030000-asr_E99999-000${member}`, {
    instant: FILING_DATE,
    members: [["jpcrp_cor:DirectorsAndOtherOfficersAxis", `jpcrp030000-asr_E99999-000:${member}`]],
  });
}

export function officerRef(member: string): string {
  return `FilingDateInstant_jpcrp030000-asr_E99999-000${member}`;
}

/** 大株主の表の1行（実データと同じく、所有株式数は千株・scale 3、割合は % 表示・scale -2）。 */
export function shareholderRow(
  rank: number,
  name: string,
  address: string,
  sharesThousands: string,
  ratioDisplay: string,
  { ratioDecimals = "4" }: { ratioDecimals?: string } = {},
): string {
  const ref = `CurrentYearInstant_No${rank}MajorShareholdersMember`;
  return `<tr>
<td><p>${nonNumeric("jpcrp_cor:NameMajorShareholders", ref, name)}</p></td>
<td><p>${nonNumeric("jpcrp_cor:AddressMajorShareholders", ref, address)}</p></td>
<td><p>${nonFraction("jpcrp_cor:NumberOfSharesHeld", ref, sharesThousands, { unitRef: "shares", decimals: "-3", scale: "3" })}</p></td>
<td><p>${nonFraction("jpcrp_cor:ShareholdingRatio", ref, ratioDisplay, { decimals: ratioDecimals, scale: "-2" })}</p></td>
</tr>`;
}

/** 役員の表の1行（役職名 → 氏名の順。実データと同じ）。 */
export function officerRow(member: string, titleHtml: string, name: string, { proposal = false } = {}): string {
  const suffix = proposal ? "Proposal" : "";
  return `<tr>
<td>${nonNumeric(`jpcrp_cor:OfficialTitleOrPositionInformationAboutDirectorsAndCorporateAuditors${suffix}`, officerRef(member), titleHtml)}</td>
<td>${nonNumeric(`jpcrp_cor:NameInformationAboutDirectorsAndCorporateAuditors${suffix}`, officerRef(member), `<span>${name}</span>`)}</td>
</tr>`;
}
