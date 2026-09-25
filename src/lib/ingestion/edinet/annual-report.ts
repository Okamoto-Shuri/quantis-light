import { fractionDigits, padFraction, parseDecimal, shiftDecimal } from "./decimal";
import type { InlineXbrl, QName, XbrlContext, XbrlFact } from "./xbrl";

/**
 * 有価証券報告書（インライン XBRL）から「大株主の状況」と「役員の状況」を抽出する。
 * 要素名・コンテキストは、EDINET の公開の有報（S100W7OT・S100W4KN・S100W5PD。第2章の1）で確かめた。
 *
 * 大株主: jpcrp_cor:NameMajorShareholders・AddressMajorShareholders・NumberOfSharesHeld・ShareholdingRatio。
 *   コンテキストは当事業年度末の時点（ID が CurrentYearInstant で始まり、期間が時点）で、軸 jpcrp_cor:MajorShareholdersAxis の
 *   メンバー jpcrp_cor:No{N}MajorShareholdersMember だけを持つもの。それ以外（合計の行、議決権の割合の表など）は読まない。
 * 役員: jpcrp_cor:NameInformationAboutDirectorsAndCorporateAuditors・OfficialTitleOrPositionInformationAboutDirectorsAndCorporateAuditors。
 *   コンテキストは提出日の時点（ID が FilingDateInstant で始まる）で、軸 jpcrp_cor:DirectorsAndOtherOfficersAxis の
 *   メンバー（提出者の独自のメンバー。役員ごと）だけを持つもの。
 *   株主総会の前に提出した有報には、提出日現在の表と「定時株主総会の議案が承認可決された後の役員」の表がある。
 *   実データ（S100W4KN）では、2つの表は同じコンテキスト（役員ごとのメンバー）を使い、**要素名で区別される**
 *   （後の表は NameInformationAboutDirectorsAndCorporateAuditorsProposal など、末尾が Proposal の要素）。
 *   読むのは提出日現在の表の要素だけで、後の表の要素があれば「総会後の表あり」と記録する。
 *   提出日現在の表の中で同じ役員が2回現れたら、表が混ざっているとみなして invalid_values（duplicate_officer）にする。
 *   記載順は、インライン XBRL の文書の順（役員ごとに最初に現れた順）。
 */

export type SectionStatus = "ok" | "no_xbrl" | "section_not_found" | "invalid_values";

export type ShareholderRow = {
  rank: number;
  name: string;
  address: string | null;
  /** 株。十進の文字列 */
  shares_held: string | null;
  /** 百分率。十進の文字列（32.10 = 32.10%） */
  ratio_pct: string;
  /** 百分率の小数点以下の記載の桁数 */
  ratio_decimals: number;
};

export type OfficerRow = { seq: number; name: string; title: string };

export type AnnualReportExtraction = {
  shareholdersStatus: SectionStatus;
  shareholdersDetail: string | null;
  shareholders: ShareholderRow[];
  officersStatus: SectionStatus;
  officersDetail: string | null;
  officers: OfficerRow[];
  officersBasis: "filing_date" | null;
  officersHasPostAgmTable: boolean;
  officersOrderSource: "inline_document" | null;
  /** コンテキストの限定で読まなかった、区画の要素の事実の数 */
  discardedFacts: number;
};

const JPCRP_COR_NAMESPACE = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/[^/]+\/jpcrp_cor$/;

function isJpcrpCor(qname: QName, local: string): boolean {
  if (qname.local !== local) return false;
  return qname.namespace === null ? qname.prefix === "jpcrp_cor" : JPCRP_COR_NAMESPACE.test(qname.namespace);
}

const SHAREHOLDER_CONCEPTS = ["NameMajorShareholders", "AddressMajorShareholders", "NumberOfSharesHeld", "ShareholdingRatio"] as const;
const OFFICER_NAME = "NameInformationAboutDirectorsAndCorporateAuditors";
const OFFICER_TITLE = "OfficialTitleOrPositionInformationAboutDirectorsAndCorporateAuditors";
/** 定時株主総会の議案（役員の選任）が承認可決された後の役員の表の要素 */
const PROPOSAL_OFFICER_NAME = "NameInformationAboutDirectorsAndCorporateAuditorsProposal";

export function noXbrlExtraction(detail: string | null = null): AnnualReportExtraction {
  return {
    shareholdersStatus: "no_xbrl",
    shareholdersDetail: detail,
    shareholders: [],
    officersStatus: "no_xbrl",
    officersDetail: detail,
    officers: [],
    officersBasis: null,
    officersHasPostAgmTable: false,
    officersOrderSource: null,
    discardedFacts: 0,
  };
}

function singleMember(context: XbrlContext | undefined, axis: string): QName | null {
  if (!context || context.typedMemberCount > 0 || context.explicitMembers.length !== 1) return null;
  const [{ dimension, member }] = context.explicitMembers;
  return isJpcrpCor(dimension, axis) ? member : null;
}

// ---------------------------------------------------------------------------
// 大株主
// ---------------------------------------------------------------------------

type ShareholderResult = { status: SectionStatus; detail: string | null; rows: ShareholderRow[]; discarded: number };

function extractShareholders(xbrl: InlineXbrl): ShareholderResult {
  const relevant = xbrl.facts.filter((fact) => SHAREHOLDER_CONCEPTS.some((local) => isJpcrpCor(fact.concept, local)));
  const byRank = new Map<number, Map<string, XbrlFact[]>>();
  let discarded = 0;
  let otherNameFacts = 0;

  for (const fact of relevant) {
    const context = xbrl.contexts.get(fact.contextRef);
    const member = singleMember(context, "MajorShareholdersAxis");
    const match = member && isJpcrpCor(member, member.local) ? /^No(\d+)MajorShareholdersMember$/.exec(member.local) : null;
    const valid = context !== undefined && context.id.startsWith("CurrentYearInstant") && context.instant !== null && match !== null;
    if (!valid) {
      discarded += 1;
      if (isJpcrpCor(fact.concept, "NameMajorShareholders")) otherNameFacts += 1;
      continue;
    }
    const rank = Number(match![1]);
    const concepts = byRank.get(rank) ?? new Map<string, XbrlFact[]>();
    const list = concepts.get(fact.concept.local) ?? [];
    list.push(fact);
    concepts.set(fact.concept.local, list);
    byRank.set(rank, concepts);
  }

  const hasName = [...byRank.values()].some((concepts) => concepts.has("NameMajorShareholders"));
  if (!hasName) {
    return {
      status: "section_not_found",
      detail: otherNameFacts > 0 ? "other_table_only" : null,
      rows: [],
      discarded,
    };
  }

  const invalid = (detail: string): ShareholderResult => ({ status: "invalid_values", detail, rows: [], discarded });

  /** 同じ項目の事実が複数あるとき、値が同じならその値。違えば undefined（矛盾）。 */
  const single = (facts: XbrlFact[] | undefined, pick: (fact: XbrlFact) => string | null): string | null | undefined => {
    if (!facts || facts.length === 0) return null;
    const values = new Set(facts.map(pick));
    return values.size === 1 ? [...values][0] : undefined;
  };

  const rows: ShareholderRow[] = [];
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const concepts = byRank.get(rank)!;
    const name = single(concepts.get("NameMajorShareholders"), (f) => (f.nil ? null : f.text.replace(/\n/g, " ")));
    const address = single(concepts.get("AddressMajorShareholders"), (f) => (f.nil ? null : f.text.replace(/\n/g, " ")));
    const shares = single(concepts.get("NumberOfSharesHeld"), (f) => (f.nil ? null : f.value ?? "invalid"));
    const ratioFacts = concepts.get("ShareholdingRatio");
    const ratio = single(ratioFacts, (f) => (f.nil ? null : f.value ?? "invalid"));
    const decimals = single(ratioFacts, (f) => f.decimals);

    if (name === undefined || address === undefined || shares === undefined || ratio === undefined || decimals === undefined) {
      return invalid("duplicate_rank");
    }
    if (!name) return invalid("missing_name");
    if (ratio === null) return invalid("missing_ratio");
    if (ratio === "invalid" || !parseDecimal(ratio)) return invalid("ratio_not_numeric");
    if (shares === "invalid" || (shares !== null && !parseDecimal(shares))) return invalid("shares_not_numeric");

    const pct = shiftDecimal(ratio, 2);
    if (pct === null) return invalid("ratio_not_numeric");
    const pctNumber = Number(pct);
    if (pctNumber < 0 || pctNumber > 100) return invalid("ratio_out_of_range");
    // 記載の精度: XBRL の decimals は比率（1 = 100%）の小数点以下の桁数なので、百分率では 2 を引く
    const ratioDecimals =
      decimals !== null && /^-?\d+$/.test(decimals) ? Math.max(0, Number(decimals) - 2) : fractionDigits(pct);
    const ratioPct = padFraction(pct, ratioDecimals);
    if (ratioPct === null) return invalid("ratio_not_numeric");
    // 記載の桁数より細かい 0 以外の桁が残るときは、その桁数を記載の精度とする（丸めない）
    rows.push({
      rank,
      name,
      address: address || null,
      shares_held: shares,
      ratio_pct: ratioPct,
      ratio_decimals: fractionDigits(ratioPct),
    });
  }
  return { status: "ok", detail: null, rows, discarded };
}

// ---------------------------------------------------------------------------
// 役員
// ---------------------------------------------------------------------------

type OfficerResult = {
  status: SectionStatus;
  detail: string | null;
  rows: OfficerRow[];
  hasPostAgmTable: boolean;
  discarded: number;
};

function memberKey(member: QName): string {
  return `${member.namespace ?? member.prefix}|${member.local}`;
}

function extractOfficers(xbrl: InlineXbrl): OfficerResult {
  let discarded = 0;
  const facts: { fact: XbrlFact; member: string; concept: "name" | "title" }[] = [];
  for (const fact of xbrl.facts) {
    const concept = isJpcrpCor(fact.concept, OFFICER_NAME) ? "name" : isJpcrpCor(fact.concept, OFFICER_TITLE) ? "title" : null;
    if (!concept) continue;
    const context = xbrl.contexts.get(fact.contextRef);
    const member = singleMember(context, "DirectorsAndOtherOfficersAxis");
    if (!context || !member || !context.id.startsWith("FilingDateInstant") || context.instant === null) {
      discarded += 1;
      continue;
    }
    facts.push({ fact, member: memberKey(member), concept });
  }

  if (!facts.some((f) => f.concept === "name")) {
    return { status: "section_not_found", detail: null, rows: [], hasPostAgmTable: false, discarded };
  }

  const hasPostAgmTable = xbrl.facts.some((fact) => isJpcrpCor(fact.concept, PROPOSAL_OFFICER_NAME));
  const order: string[] = [];
  const values = new Map<string, { names: string[]; titles: string[] }>();
  for (const item of facts) {
    if (!values.has(item.member)) {
      order.push(item.member);
      values.set(item.member, { names: [], titles: [] });
    }
    const entry = values.get(item.member)!;
    const text = item.fact.nil ? "" : item.fact.text;
    if (item.concept === "name") entry.names.push(text.replace(/\n/g, " "));
    else entry.titles.push(text);
  }

  const rows: OfficerRow[] = [];
  for (const [index, member] of order.entries()) {
    // 同じ事実の重複（値が同じ）は1つとみなす。値が違えば表が混ざっている
    const names = [...new Set(values.get(member)!.names)];
    const titles = [...new Set(values.get(member)!.titles)];
    if (names.length > 1 || titles.length > 1) {
      return { status: "invalid_values", detail: "duplicate_officer", rows: [], hasPostAgmTable, discarded };
    }
    if (!names[0]) return { status: "invalid_values", detail: "missing_name", rows: [], hasPostAgmTable, discarded };
    if (titles.length === 0 || !titles[0]) {
      return { status: "invalid_values", detail: "missing_title", rows: [], hasPostAgmTable, discarded };
    }
    rows.push({ seq: index + 1, name: names[0], title: titles[0] });
  }
  return { status: "ok", detail: null, rows, hasPostAgmTable, discarded };
}

/** 有報の大株主・役員を抽出する。 */
export function extractAnnualReport(xbrl: InlineXbrl): AnnualReportExtraction {
  const shareholders = extractShareholders(xbrl);
  const officers = extractOfficers(xbrl);
  return {
    shareholdersStatus: shareholders.status,
    shareholdersDetail: shareholders.detail,
    shareholders: shareholders.rows,
    officersStatus: officers.status,
    officersDetail: officers.detail,
    officers: officers.rows,
    officersBasis: officers.status === "ok" ? "filing_date" : null,
    officersHasPostAgmTable: officers.hasPostAgmTable,
    officersOrderSource: officers.status === "ok" ? "inline_document" : null,
    discardedFacts: shareholders.discarded + officers.discarded,
  };
}
