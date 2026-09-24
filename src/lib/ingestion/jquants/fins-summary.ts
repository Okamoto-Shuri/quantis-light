import { z } from "zod";

import { JQUANTS_API_BASE_URL, type FetchLike } from "./equities-master";
import { requestJQuants, type JQuantsFailure } from "./http";

/**
 * J-Quants API V2 の財務情報（GET /v2/fins/summary）。決算短信のサマリー。
 * https://jpx-jquants.com/ja/spec/fin-summary
 * - `code` か `date`（開示日）が必須。`date` だけなら、その開示日の全銘柄の開示が返る。pagination_key で次のページを取る。
 * - すべての項目が JSON の文字列で、値の無い項目は空文字列 ""（null ではない）。
 * 通期の決算短信（DocType が FYFinancialStatements_ で始まり、REIT でなく、CurPerType が FY）の行だけを取り出す。
 * 四半期決算短信・業績予想の修正・予想の項目（FSales、NxFSales など）は読まない（AC5.5）。
 */
export const FINS_SUMMARY_URL = `${JQUANTS_API_BASE_URL}/fins/summary`;

/** 通期の決算短信の開示書類種別（開示書類種別の一覧: https://jpx-jquants.com/ja/spec/fin-summary/typeofdocument）。REIT は含まない。 */
export const ANNUAL_DOC_TYPE = /^FYFinancialStatements_(Consolidated|NonConsolidated)_(JP|US|IFRS|JMIS|Foreign)$/;

/** public.financial_statements に保存する1行（列名は DB と同じ。金額は文字列のまま渡し、DB の numeric にする）。 */
export type AnnualStatementRow = {
  code: string;
  disclosure_no: string;
  disclosed_date: string;
  disclosed_time: string | null;
  document_type: string;
  fiscal_year_start: string;
  fiscal_year_end: string;
  net_sales: string | null;
  operating_profit: string | null;
};

export type FinsSummaryPage =
  | {
      kind: "rows";
      /** 通期の決算短信の行（検証済み） */
      annual: AnnualStatementRow[];
      /** このページで受け取った行数（全種別） */
      received: number;
      /** 通期の決算短信のうち、形式が想定と異なるため捨てた行数 */
      invalid: number;
      paginationKey: string | null;
    }
  | JQuantsFailure;

const envelopeSchema = z.object({
  data: z.array(z.unknown()),
  pagination_key: z.string().min(1).nullish(),
});

/** 全行に必須の項目（欠けていれば、その応答の形式の違い）。 */
const baseRowSchema = z.object({ Code: z.string(), DocType: z.string() });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 金額の項目: 空文字（または項目なし）は null、数値の文字列はそのまま、それ以外は形式の違い（undefined）。 */
function amount(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return NUMBER.test(trimmed) ? trimmed : undefined;
}

/**
 * 通期の決算短信の1行を検証して保存の形にする。形式が想定と異なれば null。
 * 非連結の短信は、Sales・OP が空のときだけ NCSales・NCOP を使う（項目ごとに判定する）。
 */
export function toAnnualStatement(raw: Record<string, unknown>): AnnualStatementRow | null {
  const code = raw.Code;
  const docType = raw.DocType;
  const discNo = raw.DiscNo;
  const discTime = raw.DiscTime;
  if (typeof code !== "string" || !/^[0-9A-Z]{4,5}$/.test(code)) return null;
  if (typeof docType !== "string" || !ANNUAL_DOC_TYPE.test(docType)) return null;
  if (typeof discNo !== "string" || discNo.trim() === "") return null;
  if (!isValidDate(raw.DiscDate)) return null;
  if (discTime !== undefined && discTime !== "" && (typeof discTime !== "string" || !TIME.test(discTime))) return null;
  if (raw.CurPerType !== "FY") return null;
  if (!isValidDate(raw.CurFYSt) || !isValidDate(raw.CurFYEn) || raw.CurFYEn <= raw.CurFYSt) return null;

  const sales = amount(raw.Sales);
  const op = amount(raw.OP);
  const ncSales = amount(raw.NCSales);
  const ncOp = amount(raw.NCOP);
  if (sales === undefined || op === undefined || ncSales === undefined || ncOp === undefined) return null;

  const nonConsolidated = docType.startsWith("FYFinancialStatements_NonConsolidated_");
  return {
    code,
    disclosure_no: discNo.trim(),
    disclosed_date: raw.DiscDate,
    disclosed_time: typeof discTime === "string" && discTime !== "" ? discTime : null,
    document_type: docType,
    fiscal_year_start: raw.CurFYSt,
    fiscal_year_end: raw.CurFYEn,
    net_sales: sales ?? (nonConsolidated ? ncSales : null),
    operating_profit: op ?? (nonConsolidated ? ncOp : null),
  };
}

/** 通期の決算短信の候補（DocType だけで判定する。検証は toAnnualStatement）。 */
export function isAnnualDocType(docType: string): boolean {
  return ANNUAL_DOC_TYPE.test(docType);
}

/** 応答の本文（JSON）を分類する。 */
export function parseFinsSummary(json: unknown): FinsSummaryPage {
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return { kind: "invalid_format" };
  const annual: AnnualStatementRow[] = [];
  let invalid = 0;
  for (const raw of envelope.data.data) {
    const base = baseRowSchema.safeParse(raw);
    if (!base.success) return { kind: "invalid_format" };
    if (!isAnnualDocType(base.data.DocType)) continue;
    const row = toAnnualStatement(raw as Record<string, unknown>);
    if (row) annual.push(row);
    else invalid += 1;
  }
  return {
    kind: "rows",
    annual,
    received: envelope.data.data.length,
    invalid,
    paginationKey: envelope.data.pagination_key ?? null,
  };
}

function buildUrl(date: string, paginationKey: string | null): string {
  const params = new URLSearchParams({ date });
  if (paginationKey) params.set("pagination_key", paginationKey);
  return `${FINS_SUMMARY_URL}?${params.toString()}`;
}

/** 開示日を指定して財務情報を1ページ取得し、分類する。例外は投げない。 */
export async function requestFinsSummaryPage({
  apiKey,
  date,
  paginationKey = null,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  apiKey: string;
  date: string;
  paginationKey?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<FinsSummaryPage> {
  const response = await requestJQuants({ url: buildUrl(date, paginationKey), apiKey, fetchImpl, timeoutMs });
  if (response.kind !== "ok") return response;
  return parseFinsSummary(response.json);
}
