import { z } from "zod";

import { docTypeLabel, edinetViewerUrl } from "@/lib/edinet";

/**
 * 銘柄詳細の「大株主・役員（有価証券報告書）」（Sprint 8）の値の形と表示。画面と GET /api/stocks/[code] が共有する。
 * 書類の選び方（最新の提出分、区画ごとの書類）は DB のビュー annual_report_sections の1か所で決まる。ここでは表示だけを行う。
 */

export const SECTION_STATUSES = ["ok", "no_xbrl", "section_not_found", "invalid_values", "pending"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export { DOC_TYPE_LABELS, docTypeLabel, edinetViewerUrl } from "@/lib/edinet";

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

const sectionBase = {
  status: z.enum(SECTION_STATUSES),
  detail: z.string().nullable(),
  source_doc_id: z.string(),
  source_doc_type_code: z.string().nullable(),
  source_submitted_at: z.string().nullable(),
  fallback: z.boolean(),
};

export const annualReportRowSchema = z.object({
  document: z.object({
    doc_id: z.string(),
    doc_type_code: z.string(),
    submitted_at: z.string(),
    period_start: z.string().nullable(),
    period_end: z.string(),
    status: z.enum(["processed", "pending"]),
  }),
  siblings: z.array(
    z.object({
      doc_id: z.string(),
      doc_type_code: z.string(),
      submitted_at: z.string().nullable(),
      withdrawn: z.boolean(),
      withheld: z.boolean(),
    }),
  ),
  candidate_count: z.number().int(),
  shareholders: z.object({
    ...sectionBase,
    rows: z.array(
      z.object({
        rank: z.number().int(),
        name: z.string(),
        address: z.string().nullable(),
        shares_held: decimalString.nullable(),
        ratio_pct: decimalString,
        ratio_decimals: z.number().int(),
      }),
    ),
  }),
  officers: z.object({
    ...sectionBase,
    basis: z.string().nullable(),
    has_post_agm_table: z.boolean(),
    rows: z.array(z.object({ seq: z.number().int(), name: z.string(), title: z.string() })),
  }),
});

export type AnnualReportRow = z.infer<typeof annualReportRowSchema>;

const jstDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** 日時（ISO 8601）を日本時間の ISO 8601（+09:00）にする。 */
export function toJstIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${jstDateTime.format(date).replace(" ", "T")}+09:00`;
}

/** 日時の日本時間の日付（YYYY-MM-DD）。 */
export function jstDateOf(value: string | null): string | null {
  return toJstIso(value)?.slice(0, 10) ?? null;
}

/** 決算期の表示（例 2025/03期）。 */
export function fiscalPeriodLabel(periodEnd: string): string {
  return `${periodEnd.slice(0, 4)}/${periodEnd.slice(5, 7)}期`;
}

/**
 * 持株比率の表示。保存値の記載の精度を保ち、小数点以下は最低2桁、記載がそれより細かければその桁まで（丸めない）。
 * 例 ("32.10", 2) → "32.10%"、("9.6", 1) → "9.60%"、("12.345", 3) → "12.345%"、("5.100", 3) → "5.100%"。
 */
export function formatRatioPct(ratioPct: string, ratioDecimals: number): string {
  const [int, frac = ""] = ratioPct.replace(/^-/, "").split(".");
  const digits = Math.max(2, ratioDecimals, frac.length);
  const sign = ratioPct.startsWith("-") ? "-" : "";
  return `${sign}${int}.${frac.padEnd(digits, "0")}%`;
}

/** 所有株式数（株）の3桁区切り。 */
export function formatShares(shares: string | null): string | null {
  if (shares === null) return null;
  const [int, frac] = shares.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac && /[1-9]/.test(frac) ? `${grouped}.${frac}` : grouped;
}

/** 抽出できなかった理由の文言（区画ごと）。 */
export function sectionReason(section: "shareholders" | "officers", status: SectionStatus, detail: string | null): string | null {
  const label = section === "shareholders" ? "大株主の状況" : "役員の状況";
  switch (status) {
    case "ok":
    case "pending":
      return null;
    case "no_xbrl":
      return "書類に XBRL（機械で読めるデータ）が含まれていません";
    case "section_not_found":
      if (section === "shareholders" && detail === "other_table_only") {
        return "所有株式数の割合による大株主の表が見つかりません";
      }
      return `書類から『${label}』の項目を見つけられませんでした`;
    case "invalid_values": {
      const cause: Record<string, string> = {
        ratio_not_numeric: "持株比率が数値でない行があります",
        missing_ratio: "持株比率の無い行があります",
        ratio_out_of_range: "持株比率が 0〜100% の範囲外の行があります",
        shares_not_numeric: "所有株式数が数値でない行があります",
        missing_name: "氏名・名称の無い行があります",
        missing_title: "役職名の無い行があります",
        duplicate_rank: "同じ順位に異なる記載があります",
        duplicate_officer: "同じ役員に異なる記載があります",
      };
      const reason = detail ? cause[detail] : undefined;
      return `『${label}』の記載を読み取れませんでした${reason ? `（${reason}）` : ""}`;
    }
  }
}

/** API の形（第4章）。数値は十進の文字列のまま返す。 */
export function toApiAnnualReport(row: AnnualReportRow) {
  const section = <T extends AnnualReportRow["shareholders"] | AnnualReportRow["officers"]>(value: T) => ({
    status: value.status,
    detail: value.detail,
    reason: null as string | null,
    source_doc_id: value.source_doc_id,
    source_doc_type_code: value.source_doc_type_code,
    source_submitted_at: toJstIso(value.source_submitted_at),
    fallback: value.fallback,
  });
  return {
    document: {
      doc_id: row.document.doc_id,
      doc_type_code: row.document.doc_type_code,
      doc_type_label: docTypeLabel(row.document.doc_type_code),
      submitted_at: toJstIso(row.document.submitted_at),
      period_start: row.document.period_start,
      period_end: row.document.period_end,
      edinet_url: edinetViewerUrl(row.document.doc_id),
      status: row.document.status,
    },
    siblings: row.siblings.map((sibling) => ({
      doc_id: sibling.doc_id,
      doc_type_code: sibling.doc_type_code,
      doc_type_label: docTypeLabel(sibling.doc_type_code),
      submitted_at: toJstIso(sibling.submitted_at),
      edinet_url: edinetViewerUrl(sibling.doc_id),
      withdrawn: sibling.withdrawn,
      withheld: sibling.withheld,
    })),
    shareholders: {
      ...section(row.shareholders),
      reason: sectionReason("shareholders", row.shareholders.status, row.shareholders.detail),
      rows: row.shareholders.rows.map((r) => ({
        rank: r.rank,
        name: r.name,
        address: r.address,
        shares_held: r.shares_held,
        ratio_pct: r.ratio_pct,
        ratio_decimals: r.ratio_decimals,
        ratio_display: formatRatioPct(r.ratio_pct, r.ratio_decimals),
      })),
    },
    officers: {
      ...section(row.officers),
      reason: sectionReason("officers", row.officers.status, row.officers.detail),
      basis: row.officers.basis,
      has_post_agm_table: row.officers.has_post_agm_table,
      rows: row.officers.rows,
    },
  };
}
