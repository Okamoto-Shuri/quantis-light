import { parseDecimal } from "./decimal";
import type { InlineXbrl, QName, XbrlContext, XbrlFact } from "./xbrl";

/**
 * 有価証券報告書・有価証券届出書（インライン XBRL）の「主要な経営指標等の推移」から、各期の通期の売上高と営業利益を抽出する。
 * 要素名・コンテキストは、EDINET タクソノミ（2025年版の勘定科目リスト 1e_ElementList.xlsx）と、公開の書類の実データ
 * （S100X683・S100UOKQ・S100VTA5・S100W7OT・S100DA8H。__fixtures__ の *-business-results.htm）で確かめた。
 *
 * - 事実のコンテキスト: 期間が duration で、ID が CurrentYearDuration または Prior{N}YearDuration で始まり、軸が無いか、
 *   連結・個別の軸（jppfs_cor:ConsolidatedOrNonConsolidatedAxis）のメンバー NonConsolidatedMember だけを持つもの。
 *   届出書（新規公開時）は、進行中の事業年度を CurrentYear とするため、表の5期が Prior1〜Prior5 になる（S100X683・S100VTA5）。
 *   有報は CurrentYear〜Prior4（S100W7OT）。中間期・セグメントなどのコンテキストの事実は読まない（discardedFacts に数える）。
 * - 期の開始日・終了日は、コンテキストの startDate・endDate（EDINET は期間の末日を書く。S100W7OT の CurrentYearDuration は
 *   2024-04-01〜2025-03-31）。書類一覧の periodStart・periodEnd は使わない。
 * - 軸の無い事実は連結、NonConsolidatedMember の事実は提出会社（単体）。連結財務諸表を作らない会社も NonConsolidatedMember を
 *   使う（S100VTA5）。DEI の「連結財務諸表の有無」が false の書類で軸の無い事実があれば、それも単体とする。
 * - 金額は scale（千円 = 3、百万円 = 6）を適用した円の十進の文字列（xbrl.ts）。単位は JPY だけ。
 */

export type BusinessResultsStatus = "ok" | "no_xbrl" | "section_not_found" | "invalid_values";

export type AccountingStandard = "JP" | "IFRS" | "US" | "JMIS";

export type BusinessResultsPeriod = {
  fiscal_year_start: string;
  fiscal_year_end: string;
  consolidated: boolean;
  accounting_standard: AccountingStandard;
  /** 円。十進の文字列。記載なしは null */
  net_sales: string | null;
  operating_profit: string | null;
  revenue_element: string | null;
  operating_profit_element: string | null;
};

export type BusinessResultsExtraction = {
  status: BusinessResultsStatus;
  detail: string | null;
  periods: BusinessResultsPeriod[];
  /** コンテキストの限定で読まなかった、売上高・営業利益の要素の事実の数 */
  discardedFacts: number;
};

/**
 * 売上高として読む要素（最初に事実のある要素）。標準ラベル（1e_ElementList.xlsx）:
 *   RevenueIFRSSummaryOfBusinessResults            売上収益（IFRS）、経営指標等
 *   RevenuesUSGAAPSummaryOfBusinessResults         売上高（US GAAP）、経営指標等
 *   RevenueJMISSummaryOfBusinessResults            売上収益（JMIS）、経営指標等
 *   NetSalesSummaryOfBusinessResults               売上高、経営指標等
 *   OperatingRevenue1SummaryOfBusinessResults      営業収益、経営指標等
 *   OperatingRevenue2SummaryOfBusinessResults      営業収入、経営指標等
 *   GrossOperatingRevenueSummaryOfBusinessResults  営業総収入、経営指標等
 *   OrdinaryIncomeSummaryOfBusinessResults         経常収益、経営指標等（銀行など。S100DA8H の「連結経常収益」）
 * 同じ期に IFRS などの要素と日本基準の要素の両方がある（移行期の書類）ときは、IFRS などを先にする。
 *
 * 読まない要素（売上高ではない）:
 *   OrdinaryIncomeLossSummaryOfBusinessResults     経常利益又は経常損失（△）、経営指標等 ← 英語名が経常収益と紛らわしい。読まない
 *   NetIncomeLossSummaryOfBusinessResults・ProfitLossAttributableToOwnersOfParent…（当期純利益）、Comprehensive…（包括利益）、
 *   NetAssets…（純資産）、NetPremiumsWrittenSummaryOfBusinessResultsINS（正味収入保険料）、ProfitLossBeforeTax…（税引前利益）など
 */
export const REVENUE_ELEMENTS: readonly { local: string; standard: AccountingStandard; label: string }[] = [
  { local: "RevenueIFRSSummaryOfBusinessResults", standard: "IFRS", label: "売上収益" },
  { local: "RevenuesUSGAAPSummaryOfBusinessResults", standard: "US", label: "売上高" },
  { local: "RevenueJMISSummaryOfBusinessResults", standard: "JMIS", label: "売上収益" },
  { local: "NetSalesSummaryOfBusinessResults", standard: "JP", label: "売上高" },
  { local: "OperatingRevenue1SummaryOfBusinessResults", standard: "JP", label: "営業収益" },
  { local: "OperatingRevenue2SummaryOfBusinessResults", standard: "JP", label: "営業収入" },
  { local: "GrossOperatingRevenueSummaryOfBusinessResults", standard: "JP", label: "営業総収入" },
  { local: "OrdinaryIncomeSummaryOfBusinessResults", standard: "JP", label: "経常収益" },
];

/**
 * 営業利益として読む要素。「主要な経営指標等の推移」の営業利益の要素は、タクソノミでは米国基準のものだけ
 * （日本基準・IFRS の表には営業利益の行が無い）。
 *   OperatingIncomeLossUSGAAPSummaryOfBusinessResults  営業利益又は営業損失（△）（US GAAP）、経営指標等
 */
export const OPERATING_PROFIT_ELEMENTS: readonly { local: string; standard: AccountingStandard }[] = [
  { local: "OperatingIncomeLossUSGAAPSummaryOfBusinessResults", standard: "US" },
];

const JPCRP_COR_NAMESPACE = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/[^/]+\/jpcrp_cor$/;
const JPPFS_COR_NAMESPACE = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jppfs\/[^/]+\/jppfs_cor$/;
const JPDEI_COR_NAMESPACE = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpdei\/[^/]+\/jpdei_cor$/;

function isTaxonomy(qname: QName, prefix: string, pattern: RegExp): boolean {
  return qname.namespace === null ? qname.prefix === prefix : pattern.test(qname.namespace);
}
const isJpcrpCor = (q: QName) => isTaxonomy(q, "jpcrp_cor", JPCRP_COR_NAMESPACE);
const isJppfsCor = (q: QName) => isTaxonomy(q, "jppfs_cor", JPPFS_COR_NAMESPACE);

/** 年度のコンテキストの ID（中間期・四半期・時点を除く） */
const YEAR_CONTEXT = /^(CurrentYear|Prior\d+Year)Duration(_|$)/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 事実を読むコンテキストなら連結か単体かを返す。読まないなら null。 */
function contextBasis(context: XbrlContext | undefined): { consolidated: boolean } | null {
  if (!context || !YEAR_CONTEXT.test(context.id) || context.instant !== null) return null;
  if (!context.startDate || !context.endDate) return null;
  if (context.typedMemberCount > 0) return null;
  if (context.explicitMembers.length === 0) return { consolidated: true };
  if (context.explicitMembers.length !== 1) return null;
  const [{ dimension, member }] = context.explicitMembers;
  if (isJppfsCor(dimension) && dimension.local === "ConsolidatedOrNonConsolidatedAxis" && member.local === "NonConsolidatedMember") {
    return { consolidated: false };
  }
  return null;
}

function daysBetween(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

function deiConsolidatedPrepared(xbrl: InlineXbrl): boolean | null {
  const fact = xbrl.facts.find(
    (f) => f.concept.local === "WhetherConsolidatedFinancialStatementsArePreparedDEI" && isTaxonomy(f.concept, "jpdei_cor", JPDEI_COR_NAMESPACE),
  );
  if (!fact || fact.value === null) return null;
  const v = fact.value.trim().toLowerCase();
  return v === "true" ? true : v === "false" ? false : null;
}

type Slot = { start: string; end: string; consolidated: boolean; values: Map<string, XbrlFact> };

function invalid(detail: string, discardedFacts: number): BusinessResultsExtraction {
  return { status: "invalid_values", detail, periods: [], discardedFacts };
}

export function noXbrlBusinessResults(detail: string | null = null): BusinessResultsExtraction {
  return { status: "no_xbrl", detail, periods: [], discardedFacts: 0 };
}

/** 事実の値を十進の文字列にする。nil は null（記載なし）。数として読めなければ undefined。 */
function amountOf(fact: XbrlFact): string | null | undefined {
  if (fact.nil) return null;
  if (fact.value === null || !parseDecimal(fact.value)) return undefined;
  return fact.value;
}

export function extractBusinessResults(xbrl: InlineXbrl): BusinessResultsExtraction {
  const revenueLocals = new Set(REVENUE_ELEMENTS.map((e) => e.local));
  const opLocals = new Set(OPERATING_PROFIT_ELEMENTS.map((e) => e.local));
  const consolidatedPrepared = deiConsolidatedPrepared(xbrl);

  const slots = new Map<string, Slot>();
  let discarded = 0;
  let relevant = 0;
  let otherSummaryFacts = 0;

  for (const fact of xbrl.facts) {
    const local = fact.concept.local;
    if (!(isJpcrpCor(fact.concept) && (revenueLocals.has(local) || opLocals.has(local)))) {
      // 提出者の独自の要素で「主要な経営指標等」の売上高らしきもの（読まない。理由の記録だけ）
      if (!isJpcrpCor(fact.concept) && /SummaryOfBusinessResults$/.test(local) && /(Sales|Revenue)/.test(local)) otherSummaryFacts += 1;
      continue;
    }
    const context = xbrl.contexts.get(fact.contextRef);
    const basis = contextBasis(context);
    if (!basis || !context) {
      discarded += 1;
      continue;
    }
    relevant += 1;
    if (fact.unitRef !== "JPY") return invalid("non_jpy_unit", discarded);
    const start = context.startDate!;
    const end = context.endDate!;
    if (!DATE.test(start) || !DATE.test(end) || daysBetween(start, end) < 1) return invalid("invalid_period", discarded);

    // DEI で連結財務諸表を作らないとされている書類の、軸の無い事実は単体
    const consolidated = basis.consolidated && consolidatedPrepared !== false;
    const key = `${end}|${consolidated}`;
    const slot = slots.get(key) ?? { start, end, consolidated, values: new Map<string, XbrlFact>() };
    if (slot.start !== start) return invalid("invalid_period", discarded);
    const existing = slot.values.get(local);
    if (existing) {
      // 同じ事実が繰り返し記載されることがある。値が等しければ1つにまとめ、違えば読み取れない
      const a = amountOf(existing);
      const b = amountOf(fact);
      if (a !== b) return invalid("conflicting_facts", discarded);
    } else {
      slot.values.set(local, fact);
    }
    slots.set(key, slot);
  }

  if (relevant === 0) {
    return {
      status: "section_not_found",
      detail: otherSummaryFacts > 0 ? "revenue_element_unknown" : null,
      periods: [],
      discardedFacts: discarded,
    };
  }

  const periods: BusinessResultsPeriod[] = [];
  for (const slot of slots.values()) {
    let netSales: string | null = null;
    let revenueElement: string | null = null;
    let standard: AccountingStandard | null = null;
    for (const element of REVENUE_ELEMENTS) {
      const fact = slot.values.get(element.local);
      if (!fact) continue;
      const amount = amountOf(fact);
      if (amount === undefined) return invalid("not_numeric", discarded);
      standard ??= element.standard;
      if (amount !== null && netSales === null) {
        netSales = amount;
        revenueElement = element.local;
        standard = element.standard;
      }
    }
    let operatingProfit: string | null = null;
    let opElement: string | null = null;
    for (const element of OPERATING_PROFIT_ELEMENTS) {
      const fact = slot.values.get(element.local);
      if (!fact) continue;
      const amount = amountOf(fact);
      if (amount === undefined) return invalid("not_numeric", discarded);
      operatingProfit = amount;
      opElement = element.local;
      standard ??= element.standard;
      break;
    }
    if (netSales === null && operatingProfit === null) continue;
    periods.push({
      fiscal_year_start: slot.start,
      fiscal_year_end: slot.end,
      consolidated: slot.consolidated,
      accounting_standard: standard ?? "JP",
      net_sales: netSales,
      operating_profit: operatingProfit,
      revenue_element: netSales === null ? null : revenueElement,
      operating_profit_element: operatingProfit === null ? null : opElement,
    });
  }

  if (periods.length === 0) return { status: "section_not_found", detail: "no_values", periods: [], discardedFacts: discarded };
  periods.sort((a, b) => (a.fiscal_year_end === b.fiscal_year_end ? Number(b.consolidated) - Number(a.consolidated) : a.fiscal_year_end < b.fiscal_year_end ? -1 : 1));
  return { status: "ok", detail: null, periods, discardedFacts: discarded };
}
