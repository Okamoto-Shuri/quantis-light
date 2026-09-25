import { z } from "zod";

import {
  parseScreeningParams,
  serializeScreeningParams,
  type ConditionKey,
  type RawParams,
  type ScreeningConditions,
} from "@/lib/screening/params";
import { OWNER_RESULTS, OWNER_VERDICTS, ownershipDetailSchema } from "@/lib/ownership/display";
import { blockingSchema, CONDITION_STATUSES, exclusionSchema, type Blocking, type Exclusion } from "@/lib/screening/result";

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
    /** Sprint 12: 上場廃止を確認した銘柄マスタの日付（NULL = 上場中） */
    delisted_on: dateString.nullable(),
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
    status: z.object({ cagr: status, margin: status, years: status, owner: status }),
    /** Sprint 10: 条件④の現在のモード・閾値での結果 */
    ownerResult: z.enum(OWNER_RESULTS),
    /** Sprint 11: 自動判定の結果と、呼び出したユーザーの手動補正の選択肢（無ければ null）。ownerResult は補正後 */
    ownerAutoResult: z.enum(OWNER_RESULTS),
    ownerOverride: z.enum(OWNER_VERDICTS).nullable(),
    matchesFilters: z.boolean(),
    /** Sprint 12: 上場廃止（included は常に false） */
    delisted: z.boolean(),
    included: z.boolean(),
    /** Sprint 14: 除外の種類と、該当を妨げている条件（DB の screening_evaluate の分類） */
    exclusion: exclusionSchema.nullable(),
    blocking: blockingSchema,
  }),
  /** Sprint 10: 条件④の判定根拠と保有状態の内訳 */
  ownership: ownershipDetailSchema,
});
export type StockDetail = z.infer<typeof stockDetailSchema>;
export type StockEvaluation = StockDetail["evaluation"];

/** スクリーニングの条件のパラメータ（URL のうち、判定と戻り先に使うもの）。 */
export const SCREENING_PARAM_KEYS = [
  "cagr",
  "margin",
  "years",
  "owner",
  "ownermode",
  "off",
  "unavailable",
  "undeterminable",
  "market",
  "sector",
  "sort",
  "order",
  "page",
] as const;

export type DetailConditions = {
  conditions: ScreeningConditions;
  /**
   * スクリーニングの条件のパラメータがあれば screening。無ければ、既定のプリセットがあれば preset（Sprint 13。画面だけ）、
   * 無ければ default（標準の条件）
   */
  source: "screening" | "default" | "preset";
  /** source が preset のときのプリセットの名前 */
  presetName?: string;
  /** 既定のプリセットを読めなかった（画面だけ。標準の条件で判定し、注記する） */
  presetLoadError?: boolean;
  /** Sprint 14（Sprint 13 評価の m3）: 既定のプリセットの解釈（invalid・noncanonical なら注記する）と無効な項目 */
  presetStatus?: "ok" | "invalid" | "noncanonical";
  presetInvalidFields?: string[];
  invalidFields: string[];
  /** スクリーニングに戻る URL（パンくず・「条件を変える」・ナビゲーション）。正規形のクエリ（不正な項目・未知のパラメータは含めない） */
  screeningHref: string;
};

/** スクリーニングの条件のパラメータ（page を含む）が1つでもあるか。無い URL は「画面を開いたとき」（Sprint 13 の既定のプリセットを当てる） */
export function hasScreeningParams(raw: RawParams): boolean {
  return SCREENING_PARAM_KEYS.some((key) => raw[key] !== undefined);
}

/** スクリーニングの条件のパラメータが1つでもあれば screening（スクリーニングから開いた）、無ければ default（既定の条件）。 */
export function conditionSource(raw: RawParams): "screening" | "default" {
  return hasScreeningParams(raw) ? "screening" : "default";
}

/**
 * 画面の詳細の判定の条件（Sprint 13）。条件のパラメータが無く、既定のプリセットがあればその条件で判定する（source: preset）。
 * 戻り先は /screening のまま（そこで既定のプリセットへリダイレクトされる）。API はこの関数を使わない（既定のプリセットを当てない）。
 */
export function detailConditionsWithPreset(
  raw: RawParams,
  defaultPreset:
    | { ok: true; value: { name: string; conditions: ScreeningConditions; status?: "ok" | "invalid" | "noncanonical"; invalidFields?: string[] } | null }
    | { ok: false },
): DetailConditions {
  const base = detailConditionsFromParams(raw);
  if (base.source !== "default") return base;
  if (!defaultPreset.ok) return { ...base, presetLoadError: true };
  if (defaultPreset.value === null) return base;
  return {
    ...base,
    source: "preset",
    presetName: defaultPreset.value.name,
    conditions: defaultPreset.value.conditions,
    presetStatus: defaultPreset.value.status ?? "ok",
    presetInvalidFields: defaultPreset.value.invalidFields ?? [],
  };
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

export const CONDITION_NAMES: Record<ConditionKey, string> = { cagr: "条件①", margin: "条件②", years: "条件③", owner: "条件④" };
const ORDER: ConditionKey[] = ["cagr", "margin", "years", "owner"];

export type InclusionKind = "included" | "delisted" | "filters" | "unmet" | "unavailable";

/**
 * 銘柄詳細の「結果に含まれるか」の種類（互換のため、④の判定不能も unavailable。契約の第2章の6の m7）。
 * 分類そのものは DB（screening_evaluate の exclusion）の値で、ここは詳細の data-kind への対応だけ。
 */
export function detailInclusionKind(exclusion: Exclusion | null): InclusionKind {
  if (exclusion === null) return "included";
  return exclusion === "undeterminable" ? "unavailable" : exclusion;
}

/** 妨げている条件のうち、指定の状態のものの名前（①〜④の順。DB の blocking の順のまま） */
export function blockingNames(blocking: Blocking, status: "unmet" | "unavailable", keys: readonly ConditionKey[] = ORDER): string[] {
  return blocking.filter((item) => item.status === status && keys.includes(item.condition)).map((item) => CONDITION_NAMES[item.condition]);
}

/**
 * スクリーニング結果に含まれるかの1行（契約の第2章の2の表）。優先順位（上場廃止 → 絞り込みの外 → 満たさない → 算出不可 → 判定不能）と
 * 妨げている条件は、DB（stock_detail の exclusion・blocking。screening_evaluate の1か所）の値で、ここでは文言だけを作る。
 */
export function describeInclusion(evaluation: Pick<StockEvaluation, "exclusion" | "blocking">): { kind: InclusionKind; text: string } {
  switch (evaluation.exclusion) {
    case null:
      return { kind: "included", text: "現在の条件でスクリーニング結果に含まれます" };
    case "delisted":
      return { kind: "delisted", text: "含まれない（上場廃止）。上場廃止の銘柄は、条件に関係なくスクリーニング結果に出ません" };
    case "filters":
      return { kind: "filters", text: "市場区分・業種の絞り込みの対象外のため、スクリーニング結果に含まれません" };
    case "unmet":
      return {
        kind: "unmet",
        text: `${blockingNames(evaluation.blocking, "unmet").join("・")}を満たさないため、スクリーニング結果に含まれません`,
      };
    case "unavailable":
      return {
        kind: "unavailable",
        text: `${blockingNames(evaluation.blocking, "unavailable", ["cagr", "margin", "years"]).join("・")}が算出不可のため、スクリーニング結果から除外されています（『算出不可を含める』をオンにすると表示されます）`,
      };
    case "undeterminable":
      return {
        kind: "unavailable",
        text: "条件④が判定不能のため、スクリーニング結果から除外されています（『判定不能の銘柄を含める』をオンにすると表示されます）",
      };
  }
}
