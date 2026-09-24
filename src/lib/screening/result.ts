import { z } from "zod";

import { OPERATING_MARGIN_REASONS, REVENUE_CAGR_REASONS } from "@/lib/financials/display";

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
  operating_margin: numeric.nullable(),
  operating_margin_display_pct: numeric.nullable(),
  operating_margin_unavailable_reason: z.enum(OPERATING_MARGIN_REASONS).nullable(),
  has_financials: z.boolean(),
  first_price_date: dateString.nullable(),
  data_start_date: dateString.nullable(),
  listed_before_data_start: z.boolean().nullable(),
  listing_years_exact: numeric.nullable(),
  estimated_listing_years: numeric.nullable(),
  listing_years_lower_bound: z.number().int().nullable(),
  status: z.object({ cagr: status, margin: status, years: status }),
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
  referenceDate: dateString.nullable(),
  stockCount: count,
  metricsCount: count,
  listingDatesCount: count,
});
export type ScreeningResult = z.infer<typeof screeningResultSchema>;

export const filterOptionsSchema = z.object({
  sectors: z.array(z.object({ code: z.string(), name: z.string().nullable(), count })),
  markets: z.record(z.string(), count),
});
export type FilterOptions = z.infer<typeof filterOptionsSchema>;
