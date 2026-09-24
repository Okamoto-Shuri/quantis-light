/**
 * テスト専用のフィクスチャ: J-Quants API V2 GET /v2/equities/bars/daily の応答の形
 * （https://jpx-jquants.com/ja/spec/eq-bars-daily の項目名に合わせる）。
 * アプリ本体からは import しない（画面には出ない）。
 */
export type BarItem = {
  Date: string;
  Code: string;
  O: number | null;
  H: number | null;
  L: number | null;
  C: number | null;
  UL: string;
  LL: string;
  Vo: number | null;
  Va: number | null;
  AdjFactor: number;
  AdjO: number | null;
  AdjH: number | null;
  AdjL: number | null;
  AdjC: number | null;
  AdjVo: number | null;
};

/** 1日分の行。halted を true にすると、売買の無い日（四本値・出来高が null）の行になる。 */
export function barItem(code: string, date: string, { halted = false }: { halted?: boolean } = {}): BarItem {
  const price = halted ? null : 1000;
  return {
    Date: date,
    Code: code,
    O: price,
    H: halted ? null : 1010,
    L: halted ? null : 990,
    C: price,
    UL: "0",
    LL: "0",
    Vo: halted ? null : 12300,
    Va: halted ? null : 12300000,
    AdjFactor: 1,
    AdjO: price,
    AdjH: halted ? null : 1010,
    AdjL: halted ? null : 990,
    AdjC: price,
    AdjVo: halted ? null : 12300,
  };
}

export function barsResponse(items: BarItem[], paginationKey?: string) {
  return paginationKey ? { data: items, pagination_key: paginationKey } : { data: items };
}

/** 実 API で確認した、キーが無効なときの 403 の本文。 */
export const INVALID_KEY_BODY = { message: "The incoming api key is invalid or expired." };
export const MISSING_KEY_BODY = { message: "The api key is required." };
/** キー以外の 403（契約プランの範囲外などを想定した文言。公式に例は無い）。 */
export const OUT_OF_PLAN_BODY = { message: "Access to the requested data is not allowed under your plan." };
