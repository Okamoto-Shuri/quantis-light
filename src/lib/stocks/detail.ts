import { z } from "zod";

import {
  parseScreeningParams,
  serializeScreeningParams,
  type ConditionKey,
  type RawParams,
  type ScreeningConditions,
} from "@/lib/screening/params";
import { CONDITION_STATUSES, type ConditionStatus } from "@/lib/screening/result";

/**
 * 銘柄詳細（Sprint 7）の値の形と、判定の条件・結果に含まれるかの表示。画面と GET /api/stocks/[code] が共有する。
 * 値はすべて DB（stock_detail・financial_periods・financial_metrics）が算出したもの。
 */

const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const status = z.enum(CONDITION_STATUSES);

export const stockDetailSchema = z.object({
  stock: z.object({
    code: z.string(),
    company_name: z.string(),
    market_code: z.string().nullable(),
    market_name: z.string().nullable(),
    sector33_code: z.string().nullable(),
    sector33_name: z.string().nullable(),
  }),
  referenceDate: dateString.nullable(),
  listing: z
    .object({
      first_price_date: dateString,
      data_start_date: dateString,
      listed_before_data_start: z.boolean(),
      listing_years_exact: numeric.nullable(),
      estimated_listing_years: numeric.nullable(),
      listing_years_lower_bound: z.number().int().nullable(),
    })
    .nullable(),
  evaluation: z.object({
    status: z.object({ cagr: status, margin: status, years: status }),
    matchesFilters: z.boolean(),
    included: z.boolean(),
  }),
});
export type StockDetail = z.infer<typeof stockDetailSchema>;
export type StockEvaluation = StockDetail["evaluation"];

/** スクリーニングの条件のパラメータ（URL のうち、判定と戻り先に使うもの）。 */
export const SCREENING_PARAM_KEYS = ["cagr", "margin", "years", "off", "unavailable", "market", "sector", "sort", "order", "page"] as const;

export type DetailConditions = {
  conditions: ScreeningConditions;
  /** スクリーニングの条件のパラメータがあれば screening、無ければ default（既定の条件） */
  source: "screening" | "default";
  invalidFields: string[];
  /** スクリーニングに戻る URL（パンくず・「条件を変える」・ナビゲーション）。正規形のクエリ（不正な項目・未知のパラメータは含めない） */
  screeningHref: string;
};

/** スクリーニングの条件のパラメータが1つでもあれば screening（スクリーニングから開いた）、無ければ default（既定の条件）。 */
export function conditionSource(raw: RawParams): DetailConditions["source"] {
  return SCREENING_PARAM_KEYS.some((key) => raw[key] !== undefined) ? "screening" : "default";
}

/** URL のクエリから、判定に使う条件と戻り先を求める（不正な項目は既定値。画面用）。 */
export function detailConditionsFromParams(raw: RawParams): DetailConditions {
  const source = conditionSource(raw);
  const { conditions, invalidFields } = parseScreeningParams(raw);
  return {
    conditions,
    source,
    invalidFields,
    screeningHref: source === "screening" ? `/screening?${serializeScreeningParams(conditions)}` : "/screening",
  };
}

/** 銘柄詳細の URL（スクリーニングの行のリンク）。クエリは表示中の結果の条件の正規形。 */
export function stockDetailHref(code: string, screeningQuery: string | null): string {
  return screeningQuery ? `/stocks/${code}?${screeningQuery}` : `/stocks/${code}`;
}

export const CONDITION_NAMES: Record<ConditionKey, string> = { cagr: "条件①", margin: "条件②", years: "条件③" };
const ORDER: ConditionKey[] = ["cagr", "margin", "years"];

export type InclusionKind = "included" | "filters" | "unmet" | "unavailable";

/**
 * スクリーニング結果に含まれるかの1行（契約の第2章の2の表）。優先順位: 絞り込みの外 → unmet → 算出不可。
 * 含まれるかどうか自体は DB（stock_detail の included）の値で、ここでは理由の文言だけを作る。
 */
export function describeInclusion(evaluation: StockEvaluation): { kind: InclusionKind; text: string } {
  if (evaluation.included) return { kind: "included", text: "現在の条件でスクリーニング結果に含まれます" };
  if (!evaluation.matchesFilters) {
    return { kind: "filters", text: "市場区分・業種の絞り込みの対象外のため、スクリーニング結果に含まれません" };
  }
  const withStatus = (s: ConditionStatus) => ORDER.filter((key) => evaluation.status[key] === s).map((key) => CONDITION_NAMES[key]);
  const unmet = withStatus("unmet");
  if (unmet.length > 0) return { kind: "unmet", text: `${unmet.join("・")}を満たさないため、スクリーニング結果に含まれません` };
  const unavailable = withStatus("unavailable");
  return {
    kind: "unavailable",
    text: `${unavailable.join("・")}が算出不可のため、スクリーニング結果から除外されています（『算出不可を含める』をオンにすると表示されます）`,
  };
}
