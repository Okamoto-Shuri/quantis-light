import { z } from "zod";

import { docTypeLabel, edinetViewerUrl } from "@/lib/edinet";

import { jstDateOf, toJstIso } from "./annual-report";

/**
 * 銘柄詳細の「事業の内容」（Sprint 16。F16）の値の形・状態・文言。画面と GET /api/stocks/[code] が共有する。
 * 書類の選び方は DB の business_description_sections_for の1か所（大株主・役員の区画と同じ規則）。ここでは表示だけを行う。
 */

export const BUSINESS_DESCRIPTION_LABEL = "有価証券報告書『事業の内容』の冒頭の段落（原文のまま）";

const extractionStatus = z.enum(["pending", "ok", "no_xbrl", "section_not_found", "invalid_values"]);

const documentSchema = z.object({
  doc_id: z.string(),
  doc_type_code: z.string(),
  submitted_at: z.string(),
  period_start: z.string().nullable(),
  period_end: z.string(),
});

/** DB の business_description_detail の1行（候補が無ければ NULL） */
export const businessDescriptionRowSchema = z
  .object({
    status: extractionStatus,
    detail: z.string().nullable(),
    paragraph: z.string().nullable(),
    document: documentSchema,
    fallback: z.boolean(),
    latest: z.object({
      doc_id: z.string(),
      doc_type_code: z.string(),
      submitted_at: z.string(),
      status: extractionStatus,
    }),
  })
  .refine((row) => (row.status === "ok") === (row.paragraph !== null), { message: "段落は ok のときだけ" });

export type BusinessDescriptionRow = z.infer<typeof businessDescriptionRowSchema>;

/** 画面・API の状態（候補の無い銘柄は no_annual_report） */
export type BusinessDescriptionStatus = "no_annual_report" | z.infer<typeof extractionStatus>;

export function businessDescriptionStatus(row: BusinessDescriptionRow | null): BusinessDescriptionStatus {
  return row === null ? "no_annual_report" : row.status;
}

/** 読み取れなかった理由（no_xbrl・invalid_values）。ほかの状態は null */
export function businessDescriptionReason(status: BusinessDescriptionStatus, detail: string | null): string | null {
  switch (status) {
    case "no_xbrl":
      return "書類にインライン XBRL（機械で読めるデータ）が含まれていません";
    case "invalid_values": {
      const reasons: Record<string, string> = {
        no_paragraph: "『事業の内容』の区画に本文の段落が見つかりません（見出し・表・図だけでした）",
        conflicting_sections: "『事業の内容』の記載が複数あり、内容が一致しません",
        paragraph_too_long: "最初の段落が長すぎます（20,000 文字を超えています）",
        continuation_not_supported: "記載が複数の箇所に分かれているため、読み取れません",
      };
      return (detail ? reasons[detail] : undefined) ?? "『事業の内容』の記載を読み取れませんでした";
    }
    default:
      return null;
  }
}

/** 状態ごとの見出しの文（ok は null） */
export function businessDescriptionMessage(status: BusinessDescriptionStatus, row: BusinessDescriptionRow | null): string | null {
  switch (status) {
    case "ok":
      return null;
    case "no_annual_report":
      return "有報が未取得のため、事業の内容を表示できません";
    case "pending":
      return `${docTypeLabel(row!.document.doc_type_code)}（${row!.document.doc_id}）の事業の内容は取り込み待ちです`;
    case "section_not_found":
      return "有報に『事業の内容』の記載が見つかりませんでした";
    case "no_xbrl":
    case "invalid_values":
      return "有報から事業の内容を読み取れませんでした";
  }
}

/** 元の有報の記載を表示しているときの注記（fallback のときだけ） */
export function businessDescriptionFallbackNote(row: BusinessDescriptionRow): string | null {
  if (!row.fallback) return null;
  const latest = `${docTypeLabel(row.latest.doc_type_code)} ${row.latest.doc_id}（${jstDateOf(row.latest.submitted_at)} 提出）`;
  const source = `${docTypeLabel(row.document.doc_type_code)} ${row.document.doc_id}（${jstDateOf(row.document.submitted_at)} 提出）`;
  return row.latest.status === "no_xbrl"
    ? `${latest}からは事業の内容を読み取れない（XBRL なし）ため、${source}の記載を表示しています`
    : `${latest}に『事業の内容』の記載が無いため、${source}の記載を表示しています`;
}

/** API の形（契約の第2章の7） */
export function toApiBusinessDescription(row: BusinessDescriptionRow | null) {
  const status = businessDescriptionStatus(row);
  return {
    status,
    detail: row?.detail ?? null,
    reason: businessDescriptionReason(status, row?.detail ?? null),
    paragraph: row?.status === "ok" ? row.paragraph : null,
    document: row
      ? {
          doc_id: row.document.doc_id,
          doc_type_code: row.document.doc_type_code,
          doc_type_label: docTypeLabel(row.document.doc_type_code),
          submitted_at: toJstIso(row.document.submitted_at),
          period_start: row.document.period_start,
          period_end: row.document.period_end,
          edinet_url: edinetViewerUrl(row.document.doc_id),
        }
      : null,
    fallback:
      row && row.fallback
        ? {
            skipped_doc_id: row.latest.doc_id,
            skipped_doc_type_code: row.latest.doc_type_code,
            skipped_doc_type_label: docTypeLabel(row.latest.doc_type_code),
            skipped_submitted_at: toJstIso(row.latest.submitted_at),
            skipped_status: row.latest.status,
          }
        : null,
  };
}
