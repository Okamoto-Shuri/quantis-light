import { z } from "zod";

import type { FetchLike } from "../jquants/equities-master";

import { requestEdinetJson, type EdinetFailure } from "./http";

/**
 * 書類一覧 API（GET /documents.json?date=&type=2）の取得と、行の分類。
 * EDINET API 仕様書（Version 2）の 3-1 で確かめた内容:
 * - 応答は metadata（status が "200"、resultset.count）と results（提出書類の配列）。日時は日本時間の "YYYY-MM-DD hh:mm"。
 * - 期間（periodStart・periodEnd）は有報・半期報告書でだけ出力される（訂正有報・届出書では null）。
 * - 取下書は withdrawalStatus "1"（parentDocID が取り下げの対象）。取り下げられた書類は "2" で、日次更新の後は
 *   連番・書類管理番号・親書類管理番号・取下区分以外が null になる。親書類が取り下げられると、その子の書類も取り下げられる。
 * - 開示不開示区分 disclosureStatus: "1" 不開示の開始の情報（操作日のファイル日付に出る。opeDateTime あり）、
 *   "2" 不開示とされている書類、"3" 不開示の解除の情報、"0" それ以外。
 */

/** 保存する書類の種類（有報・訂正有報・届出書・訂正届出書）。 */
export const SAVED_DOC_TYPES = ["120", "130", "030", "040"] as const;
/** 企業内容等の開示に関する内閣府令 */
export const CORPORATE_ORDINANCE = "010";

const nullableString = z.string().nullable().optional().transform((v) => (v === undefined || v === "" ? null : v));

const rowSchema = z.object({
  seqNumber: z.number().optional(),
  docID: z.string().min(1),
  edinetCode: nullableString,
  secCode: nullableString,
  filerName: nullableString,
  ordinanceCode: nullableString,
  formCode: nullableString,
  docTypeCode: nullableString,
  periodStart: nullableString,
  periodEnd: nullableString,
  submitDateTime: nullableString,
  docDescription: nullableString,
  parentDocID: nullableString,
  opeDateTime: nullableString,
  withdrawalStatus: nullableString,
  disclosureStatus: nullableString,
  xbrlFlag: nullableString,
});

const listSchema = z.object({
  metadata: z.object({
    status: z.string(),
    resultset: z.object({ count: z.number().int().nonnegative() }),
  }),
  results: z.array(z.unknown()),
});

export type ListedDocument = {
  doc_id: string;
  sec_code: string | null;
  edinet_code: string;
  filer_name: string | null;
  doc_type_code: string;
  ordinance_code: string;
  form_code: string | null;
  period_start: string | null;
  period_end: string | null;
  submitted_at: string;
  parent_doc_id: string | null;
  doc_description: string | null;
  xbrl_available: boolean;
  withheld: boolean;
};

export type DisclosureChange = { doc_id: string; withheld: boolean; ope_at: string };

export type ParsedList = {
  kind: "ok";
  /** 一覧の件数（results の件数） */
  received: number;
  documents: ListedDocument[];
  /** 取り下げの対象の書類ID（取り下げられた書類、取下書の親書類） */
  withdrawn: string[];
  disclosure: DisclosureChange[];
  /** 保存の対象外にした行の数（種類・府令・証券コード・形の違い） */
  skipped: number;
  /** 行の形が想定と違った（必須の項目の欠け）行の数 */
  invalidRows: number;
};

export type ListResult = ParsedList | EdinetFailure;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;

/** 日本時間の "YYYY-MM-DD hh:mm" を ISO 8601（+09:00）にする。形が違えば null。 */
export function jstDateTimeToIso(value: string | null): string | null {
  if (!value) return null;
  const match = DATETIME.exec(value.trim());
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:00+09:00`;
}

function dateOrNull(value: string | null): string | null {
  return value && DATE.test(value) ? value : null;
}

/** 応答の JSON を検証して分類する。形が違えば invalid_format。 */
export function parseDocumentList(json: unknown): ParsedList | { kind: "invalid_format"; status: number | null } {
  const parsed = listSchema.safeParse(json);
  if (!parsed.success || parsed.data.metadata.status !== "200") return { kind: "invalid_format", status: null };
  const { results } = parsed.data;
  if (parsed.data.metadata.resultset.count !== results.length) return { kind: "invalid_format", status: null };

  const documents: ListedDocument[] = [];
  const withdrawn = new Set<string>();
  const disclosure: DisclosureChange[] = [];
  let skipped = 0;
  let invalidRows = 0;

  for (const raw of results) {
    const row = rowSchema.safeParse(raw);
    if (!row.success) {
      invalidRows += 1;
      continue;
    }
    const r = row.data;

    // 取り下げ: 取り下げられた書類（"2"）と、取下書（"1"）の親書類
    if (r.withdrawalStatus === "2") {
      withdrawn.add(r.docID);
      continue;
    }
    if (r.withdrawalStatus === "1") {
      if (r.parentDocID) withdrawn.add(r.parentDocID);
      continue;
    }

    // 不開示の開始・解除の情報（操作日時あり）
    const opeAt = jstDateTimeToIso(r.opeDateTime);
    if ((r.disclosureStatus === "1" || r.disclosureStatus === "3") && opeAt) {
      disclosure.push({ doc_id: r.docID, withheld: r.disclosureStatus === "1", ope_at: opeAt });
    }

    const docType = r.docTypeCode;
    if (r.ordinanceCode !== CORPORATE_ORDINANCE || !docType || !(SAVED_DOC_TYPES as readonly string[]).includes(docType)) {
      skipped += 1;
      continue;
    }
    const isAnnual = docType === "120" || docType === "130";
    const secCode = r.secCode && /^[0-9A-Z]{5}$/.test(r.secCode) ? r.secCode : null;
    if (isAnnual && !secCode) {
      skipped += 1;
      continue;
    }
    const submittedAt = jstDateTimeToIso(r.submitDateTime);
    if (!r.edinetCode || !submittedAt) {
      invalidRows += 1;
      continue;
    }
    documents.push({
      doc_id: r.docID,
      sec_code: secCode,
      edinet_code: r.edinetCode,
      filer_name: r.filerName,
      doc_type_code: docType,
      ordinance_code: r.ordinanceCode,
      form_code: r.formCode,
      period_start: dateOrNull(r.periodStart),
      period_end: dateOrNull(r.periodEnd),
      submitted_at: submittedAt,
      parent_doc_id: r.parentDocID,
      doc_description: r.docDescription,
      xbrl_available: r.xbrlFlag === "1",
      withheld: r.disclosureStatus === "1" || r.disclosureStatus === "2",
    });
  }

  return {
    kind: "ok",
    received: results.length,
    documents,
    withdrawn: [...withdrawn],
    disclosure,
    skipped,
    invalidRows,
  };
}

/** 1日分の書類一覧を取得して分類する。例外は投げない。 */
export async function fetchDocumentList({
  date,
  apiKey,
  fetchImpl,
}: {
  date: string;
  apiKey: string;
  fetchImpl?: FetchLike;
}): Promise<ListResult> {
  const response = await requestEdinetJson({ path: "/documents.json", params: { date, type: "2" }, apiKey, fetchImpl });
  if (response.kind !== "ok") return response;
  return parseDocumentList(response.json);
}
