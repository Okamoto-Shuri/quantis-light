import { z } from "zod";

import { OPERATING_MARGIN_REASONS, periodSourceSchema, REVENUE_CAGR_REASONS } from "@/lib/financials/display";
import { ownershipSummarySchema } from "@/lib/ownership/display";

/** screen_stocks の応答の形（画面と API で共有する）。値はすべて DB が算出したもの。 */

const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CONDITION_STATUSES = ["met", "unmet", "unavailable", "off"] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];
const status = z.enum(CONDITION_STATUSES);

export const screeningRowSchema = z.object({
  code: z.string(),
  company_name: z.string(),
  market_code: z.string().nullable(),
  market_name: z.string().nullable(),
  sector33_code: z.string().nullable(),
  sector33_name: z.string().nullable(),
  revenue_cagr: numeric.nullable(),
  revenue_cagr_display_pct: numeric.nullable(),
  revenue_cagr_unavailable_reason: z.enum(REVENUE_CAGR_REASONS).nullable(),
  /** Sprint 9: CAGR の算出に EDINET から補った期を含む（一覧の「補完」の印） */
  revenue_cagr_supplemented: z.boolean(),
  /** Sprint 9: 算出に使った期のうち、補った期（決算短信以外の出典。新しい順） */
  revenue_cagr_supplement: z.array(periodSourceSchema),
  revenue_cagr_mixed_consolidation: z.boolean(),
  revenue_cagr_mixed_standard: z.boolean(),
  operating_margin: numeric.nullable(),
  operating_margin_display_pct: numeric.nullable(),
  operating_margin_unavailable_reason: z.enum(OPERATING_MARGIN_REASONS).nullable(),
  /** Sprint 9: 直近通期の出典（営業利益率の理由の文言の出し分けだけに使う） */
  latest_period_source: z.string().nullable(),
  has_financials: z.boolean(),
  first_price_date: dateString.nullable(),
  data_start_date: dateString.nullable(),
  listed_before_data_start: z.boolean().nullable(),
  listing_years_exact: numeric.nullable(),
  estimated_listing_years: numeric.nullable(),
  listing_years_lower_bound: z.number().int().nullable(),
  /** Sprint 10: 条件④の判定（現在のモード・閾値での結果）と保有状態の要約 */
  ownership: ownershipSummarySchema,
  status: z.object({ cagr: status, margin: status, years: status, owner: status }),
});
export type ScreeningRow = z.infer<typeof screeningRowSchema>;

const count = z.number().int().nonnegative();

export const screeningResultSchema = z.object({
  rows: z.array(screeningRowSchema),
  total: count,
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().positive(),
  excludedUnavailable: count,
  /** Sprint 10: 条件④の判定不能だけの理由で除いた数 */
  excludedUndeterminable: count,
  referenceDate: dateString.nullable(),
  /** 上場中の銘柄の数（Sprint 12 から上場廃止を数えない） */
  stockCount: count,
  /** 上場廃止の銘柄の数（検索の対象外。Sprint 12） */
  delistedCount: count,
  metricsCount: count,
  listingDatesCount: count,
  ownershipDeterminedCount: count,
});
export type ScreeningResult = z.infer<typeof screeningResultSchema>;

export const filterOptionsSchema = z.object({
  sectors: z.array(z.object({ code: z.string(), name: z.string().nullable(), count })),
  markets: z.record(z.string(), count),
});
export type FilterOptions = z.infer<typeof filterOptionsSchema>;

/**
 * 除外の分類（Sprint 14。DB の screening_evaluate の exclusion と blocking）。優先順位は DB の1か所で決める:
 * delisted → filters → unmet → unavailable（①〜③の算出不可）→ undeterminable（④の判定不能）。該当なら exclusion は null。
 */
export const EXCLUSIONS = ["delisted", "filters", "unmet", "unavailable", "undeterminable"] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];
export const exclusionSchema = z.enum(EXCLUSIONS);

export const CONDITION_KEY_VALUES = ["cagr", "margin", "years", "owner"] as const;
/** 該当を妨げている条件（①〜④の順）。status は unmet か unavailable */
export const blockingSchema = z.array(z.object({ condition: z.enum(CONDITION_KEY_VALUES), status: status }));
export type Blocking = z.infer<typeof blockingSchema>;
