import { z } from "zod";

import { blockingSchema, exclusionSchema, screeningRowSchema, type Blocking, type Exclusion } from "@/lib/screening/result";
import { CONDITION_NAMES } from "@/lib/stocks/detail";

/**
 * ウォッチリストの行（Sprint 14。DB 関数 watchlist_entries の戻り値）。表示の値は screen_stocks の行と同じ形（row）、
 * 判定の分類（included・exclusion・blocking）は screening_evaluate の値。ここは形の確認と文言だけ。
 */
export const watchlistEntrySchema = z.object({
  code: z.string(),
  memo: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  delisted_on: z.string().nullable(),
  row: screeningRowSchema,
  included: z.boolean(),
  exclusion: exclusionSchema.nullable(),
  blocking: blockingSchema,
});
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;

export type WatchlistInclusionKind = "included" | Exclusion;

/** 「該当」の列の文言（契約の第2章の6の表）。種類と、妨げている条件の並びは DB の値 */
export function watchlistInclusionText(entry: { exclusion: Exclusion | null; blocking: Blocking }): { kind: WatchlistInclusionKind; text: string } {
  const names = (status: "unmet" | "unavailable", owner: boolean) =>
    entry.blocking
      .filter((item) => item.status === status && (item.condition === "owner") === owner)
      .map((item) => CONDITION_NAMES[item.condition]);
  switch (entry.exclusion) {
    case null:
      return { kind: "included", text: "該当" };
    case "delisted":
      return { kind: "delisted", text: "上場廃止" };
    case "filters":
      return { kind: "filters", text: "該当しない（絞り込みの対象外）" };
    case "unmet":
      return {
        kind: "unmet",
        text: `該当しない（${entry.blocking.filter((item) => item.status === "unmet").map((item) => CONDITION_NAMES[item.condition]).join("・")}）`,
      };
    case "unavailable":
      return { kind: "unavailable", text: `該当しない（${names("unavailable", false).join("・")} 算出不可）` };
    case "undeterminable":
      return { kind: "undeterminable", text: "該当しない（条件④ 判定不能）" };
  }
}
