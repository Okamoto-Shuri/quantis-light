import { z } from "zod";

import { INGESTION_MESSAGES, IngestionFailure } from "../errors";

/**
 * J-Quants API V2 の上場銘柄一覧（GET /v2/equities/master）。
 * https://jpx-jquants.com/ja/spec/eq-master
 * パラメータ無しで、実行日時点の全銘柄が返る（ページ送りの pagination_key は付かない）。
 */
export const JQUANTS_API_BASE_URL = "https://api.jquants.com/v2";
export const EQUITIES_MASTER_URL = `${JQUANTS_API_BASE_URL}/equities/master`;

/** 保存する市場区分（プライム／スタンダード／グロース）。 */
export const TARGET_MARKET_CODES: ReadonlySet<string> = new Set(["0111", "0112", "0113"]);
/** 保存する商品区分（内国株券）。 */
export const TARGET_PRODUCT_CATEGORY = "011";
/** 除外する33業種コード（その他。ETF・REIT など）。 */
export const EXCLUDED_SECTOR33_CODE = "9999";

const requiredText = z.string().trim().min(1);
const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value && value.trim() ? value.trim() : null));

const masterItemSchema = z.object({
  Date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  Code: requiredText,
  CoName: requiredText,
  CoNameEn: optionalText,
  S17: optionalText,
  S17Nm: optionalText,
  S33: requiredText,
  S33Nm: requiredText,
  ScaleCat: optionalText,
  Mkt: requiredText,
  MktNm: requiredText,
  ProdCat: requiredText,
});

const masterResponseSchema = z.object({ data: z.array(z.unknown()) });

/** public.stocks に保存する1行（列名は DB と同じ）。 */
export type StockMasterRow = {
  code: string;
  company_name: string;
  company_name_en: string | null;
  market_code: string;
  market_name: string;
  sector17_code: string | null;
  sector17_name: string | null;
  sector33_code: string;
  sector33_name: string;
  scale_category: string | null;
  product_category: string;
  listed_info_date: string;
};

/** 実行履歴の details に記録する件数の内訳（市場データそのものは含めない）。 */
export type StockMasterDetails = {
  fetched: number;
  skipped: number;
  skippedByProduct: number;
  skippedByMarket: number;
  skippedBySector: number;
  listedInfoDate: string;
};

export type ParsedStockMaster = { rows: StockMasterRow[]; details: StockMasterDetails };

const STOCK_CODE_PATTERN = /^[0-9A-Z]{4,5}$/;

/**
 * 上場銘柄一覧の応答から、保存する行を作る。
 * 保存するのは「商品区分 011（内国株券）」「市場区分 0111〜0113」「33業種が 9999 以外」をすべて満たす行。
 * 対象外の行は、この順で最初に満たさなかった条件で1つに数える。
 * 形式が想定と違う場合（必須の項目の欠け、pagination_key、保存する行のコードの重複など）は、
 * 一部だけを保存しないよう、全体を失敗にする。
 */
export function parseEquitiesMaster(json: unknown): ParsedStockMaster {
  const response = masterResponseSchema.safeParse(json);
  if (!response.success) throw new IngestionFailure(INGESTION_MESSAGES.jquantsInvalidFormat);
  if (typeof json === "object" && json !== null && "pagination_key" in json) {
    throw new IngestionFailure(INGESTION_MESSAGES.jquantsInvalidFormat);
  }

  const rows: StockMasterRow[] = [];
  const seen = new Set<string>();
  let skippedByProduct = 0;
  let skippedByMarket = 0;
  let skippedBySector = 0;
  let listedInfoDate = "";

  for (const raw of response.data.data) {
    const item = masterItemSchema.safeParse(raw);
    if (!item.success) throw new IngestionFailure(INGESTION_MESSAGES.jquantsInvalidFormat);
    const it = item.data;
    if (it.Date > listedInfoDate) listedInfoDate = it.Date;

    if (it.ProdCat !== TARGET_PRODUCT_CATEGORY) {
      skippedByProduct += 1;
      continue;
    }
    if (!TARGET_MARKET_CODES.has(it.Mkt)) {
      skippedByMarket += 1;
      continue;
    }
    if (it.S33 === EXCLUDED_SECTOR33_CODE) {
      skippedBySector += 1;
      continue;
    }

    if (!STOCK_CODE_PATTERN.test(it.Code) || seen.has(it.Code)) {
      throw new IngestionFailure(INGESTION_MESSAGES.jquantsInvalidFormat);
    }
    seen.add(it.Code);
    rows.push({
      code: it.Code,
      company_name: it.CoName,
      company_name_en: it.CoNameEn,
      market_code: it.Mkt,
      market_name: it.MktNm,
      sector17_code: it.S17,
      sector17_name: it.S17Nm,
      sector33_code: it.S33,
      sector33_name: it.S33Nm,
      scale_category: it.ScaleCat,
      product_category: it.ProdCat,
      listed_info_date: it.Date,
    });
  }

  if (rows.length === 0) throw new IngestionFailure(INGESTION_MESSAGES.jquantsNoTargets);

  const skipped = skippedByProduct + skippedByMarket + skippedBySector;
  return {
    rows,
    details: {
      fetched: response.data.data.length,
      skipped,
      skippedByProduct,
      skippedByMarket,
      skippedBySector,
      listedInfoDate,
    },
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 接続の失敗の原因を、キーや応答を含まない短い説明にする。 */
export function describeNetworkError(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "タイムアウト";
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === "string" && /^[A-Z_]+$/.test(code) ? `ネットワークエラー: ${code}` : "ネットワークエラー";
}

/**
 * 上場銘柄一覧を取得する。失敗は IngestionFailure（決まった日本語のメッセージ）にする。
 * メッセージには、キーの値や応答の本文を含めない。
 */
export async function fetchEquitiesMaster({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}: {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(EQUITIES_MASTER_URL, {
      method: "GET",
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new IngestionFailure(INGESTION_MESSAGES.jquantsUnreachable(describeNetworkError(error)));
  }

  if (response.status === 401 || response.status === 403) {
    throw new IngestionFailure(INGESTION_MESSAGES.jquantsUnauthorized(response.status));
  }
  if (response.status === 429) throw new IngestionFailure(INGESTION_MESSAGES.jquantsRateLimited);
  if (response.status !== 200) throw new IngestionFailure(INGESTION_MESSAGES.jquantsUnexpectedStatus(response.status));

  try {
    return await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new IngestionFailure(INGESTION_MESSAGES.jquantsUnreachable("タイムアウト"));
    }
    throw new IngestionFailure(INGESTION_MESSAGES.jquantsInvalidFormat);
  }
}
