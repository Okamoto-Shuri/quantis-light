import { MARKETS, SECTOR33_NAMES, type MarketCode } from "./sectors";

/**
 * スクリーニングの条件と、URL・API のパラメータの検証・正規化（契約の第2章の6）。
 * 画面（サーバーコンポーネント）と GET /api/screening が同じ関数を使う。違いは不正な値の扱いだけ:
 *   lenient（画面）: 不正な項目は既定値に置き換え（リストは正しい要素だけを残し）、invalidFields に項目名を返す
 *   strict（API）  : 呼び出し側が invalidFields が空でなければ 400 にする
 * 閾値は十進の文字列のまま扱い（浮動小数点を経由しない）、DB で numeric にする。
 */

export const CONDITION_KEYS = ["cagr", "margin", "years", "owner"] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

export const SORT_KEYS = ["cagr", "margin", "years", "owner", "code", "name", "market", "sector"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortOrder = "asc" | "desc";

/** 条件④の判定モード（Sprint 10）。any = オーナー企業または社長が筆頭株主、president = 社長が筆頭株主のみ */
export const OWNER_MODES = ["any", "president"] as const;
export type OwnerMode = (typeof OWNER_MODES)[number];

export type ScreeningConditions = {
  /** 閾値（正規形の十進の文字列）。cagr・margin・owner は %、years は年 */
  cagr: string;
  margin: string;
  years: string;
  /** 条件④: オーナー企業と判定する合計持株比率の閾値（%） */
  owner: string;
  ownerMode: OwnerMode;
  /** オフにした条件（cagr, margin, years, owner の順） */
  off: ConditionKey[];
  /** 条件①〜③の算出不可を含める */
  includeUnavailable: boolean;
  /** 条件④の判定不能を含める（①〜③の算出不可とは独立） */
  includeUndeterminable: boolean;
  /** 市場コード・33業種コード（昇順、重複なし）。空ならすべて */
  market: MarketCode[];
  sector: string[];
  sort: SortKey;
  order: SortOrder;
  page: number;
};

/** 閾値の範囲（小数点以下1桁の整数で持つ = 値 × 10） */
export const THRESHOLDS: Record<ConditionKey, { min: number; max: number; defaultValue: string; unit: string }> = {
  cagr: { min: -1000, max: 10000, defaultValue: "20", unit: "%" },
  margin: { min: -1000, max: 1000, defaultValue: "10", unit: "%" },
  years: { min: 1, max: 100, defaultValue: "5", unit: "年" },
  owner: { min: 0, max: 1000, defaultValue: "20", unit: "%" },
};

export const PAGE_SIZE = 100;

/** 列を初めて選んだときの並びの向き（第2章の5）。 */
export function defaultOrder(sort: SortKey): SortOrder {
  return sort === "cagr" || sort === "margin" || sort === "owner" ? "desc" : "asc";
}

export const DEFAULT_CONDITIONS: ScreeningConditions = {
  cagr: THRESHOLDS.cagr.defaultValue,
  margin: THRESHOLDS.margin.defaultValue,
  years: THRESHOLDS.years.defaultValue,
  owner: THRESHOLDS.owner.defaultValue,
  ownerMode: "any",
  off: [],
  includeUnavailable: false,
  includeUndeterminable: false,
  market: [],
  sector: [],
  sort: "cagr",
  order: "desc",
  page: 1,
};

const THRESHOLD_PATTERN = /^(-?)(\d{1,4})(?:\.(\d))?$/;
const PAGE_PATTERN = /^[1-9]\d{0,5}$/;
const MARKET_CODES = new Set<string>(MARKETS.map((market) => market.code));

/** 閾値の文字列を検証し、正規形（先頭の余分な 0・`.0`・`-0` を除いた形）にする。範囲外・文法違反は null。 */
export function normalizeThreshold(key: ConditionKey, raw: string): string | null {
  const match = THRESHOLD_PATTERN.exec(raw);
  if (!match) return null;
  const [, sign, intPart, fraction = "0"] = match;
  const tenths = Number(intPart) * 10 + Number(fraction);
  const value = sign === "-" ? -tenths : tenths;
  const { min, max } = THRESHOLDS[key];
  if (value < min || value > max) return null;
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const text = abs % 10 === 0 ? String(abs / 10) : `${Math.floor(abs / 10)}.${abs % 10}`;
  return value < 0 ? `-${text}` : text;
}

/** マイナスとして扱う文字（NFKC で `-` にならないもの。U+2212 の数学記号のマイナス、長音記号、各種ダッシュ） */
const MINUS_LIKE = /[−ー‐‑‒–—―﹣ｰ]/g;

/**
 * 画面の入力欄の値を閾値として解釈する。前後の空白を除き、全角を半角に直し（NFKC）、マイナスに見える記号を `-` にしてから、
 * URL と同じ文法で検証する。不正なら null。
 */
export function parseThresholdInput(key: ConditionKey, text: string): string | null {
  const normalized = text.normalize("NFKC").replace(MINUS_LIKE, "-").trim();
  return normalizeThreshold(key, normalized);
}

/** 入力欄のエラーの文言（ASCII のハイフンで範囲を示す）。 */
export function thresholdErrorMessage(key: ConditionKey): string {
  const { min, max } = THRESHOLDS[key];
  const format = (tenths: number) => (tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1));
  return `${format(min)}〜${format(max)} の数値を小数点以下1桁までで入力してください`;
}

export type RawParams = Record<string, string | string[] | undefined>;

export function searchParamsToRecord(params: URLSearchParams): RawParams {
  const record: RawParams = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}

export type ParsedParams = { conditions: ScreeningConditions; invalidFields: string[] };

/**
 * パラメータを検証する。未知のパラメータは無視する。
 * - 同じパラメータの重複（`?cagr=10&cagr=20`）は無効
 * - カンマ区切りの値の重複は除く。空の値（`market=`）は指定なし。空の要素（`market=0111,`）は無効な要素
 * - 一部だけ不正なリストは、正しい要素だけを残し、項目を無効として報告する
 */
export function parseScreeningParams(raw: RawParams): ParsedParams {
  const invalid = new Set<string>();
  const conditions: ScreeningConditions = { ...DEFAULT_CONDITIONS, off: [], market: [], sector: [] };

  const single = (key: string): string | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
      invalid.add(key);
      return undefined;
    }
    return value;
  };

  const list = (key: string, isValid: (item: string) => boolean): string[] => {
    const value = single(key);
    if (value === undefined || value === "") return [];
    const items: string[] = [];
    for (const item of value.split(",")) {
      if (isValid(item)) {
        if (!items.includes(item)) items.push(item);
      } else {
        invalid.add(key);
      }
    }
    return items;
  };

  for (const key of CONDITION_KEYS) {
    const value = single(key);
    if (value === undefined) continue;
    const normalized = normalizeThreshold(key, value);
    if (normalized === null) invalid.add(key);
    else conditions[key] = normalized;
  }

  const off = list("off", (item) => (CONDITION_KEYS as readonly string[]).includes(item));
  conditions.off = CONDITION_KEYS.filter((key) => off.includes(key));

  const unavailable = single("unavailable");
  if (unavailable === "include") conditions.includeUnavailable = true;
  else if (unavailable !== undefined && unavailable !== "exclude") invalid.add("unavailable");

  const ownerMode = single("ownermode");
  if (ownerMode !== undefined) {
    if ((OWNER_MODES as readonly string[]).includes(ownerMode)) conditions.ownerMode = ownerMode as OwnerMode;
    else invalid.add("ownermode");
  }

  const undeterminable = single("undeterminable");
  if (undeterminable === "include") conditions.includeUndeterminable = true;
  else if (undeterminable !== undefined && undeterminable !== "exclude") invalid.add("undeterminable");

  conditions.market = (list("market", (item) => MARKET_CODES.has(item)) as MarketCode[]).sort();
  conditions.sector = list("sector", (item) => SECTOR33_NAMES.has(item)).sort();

  const sort = single("sort");
  if (sort !== undefined) {
    if ((SORT_KEYS as readonly string[]).includes(sort)) conditions.sort = sort as SortKey;
    else invalid.add("sort");
  }
  const order = single("order");
  if (order === "asc" || order === "desc") conditions.order = order;
  else {
    if (order !== undefined) invalid.add("order");
    conditions.order = defaultOrder(conditions.sort);
  }

  const page = single("page");
  if (page !== undefined) {
    if (PAGE_PATTERN.test(page)) conditions.page = Number(page);
    else invalid.add("page");
  }

  return { conditions, invalidFields: [...invalid] };
}

/**
 * 条件を URL のクエリ文字列（先頭の `?` なし）にする。条件のパラメータ（cagr・margin・years・owner・ownermode・sort・order）は
 * 常に書き、off・unavailable・undeterminable・market・sector は該当するときだけ、page は 2 以上のときだけ書く。
 */
export function serializeScreeningParams(conditions: ScreeningConditions): string {
  const params = new URLSearchParams();
  params.set("cagr", conditions.cagr);
  params.set("margin", conditions.margin);
  params.set("years", conditions.years);
  params.set("owner", conditions.owner);
  params.set("ownermode", conditions.ownerMode);
  if (conditions.off.length) params.set("off", CONDITION_KEYS.filter((key) => conditions.off.includes(key)).join(","));
  if (conditions.includeUnavailable) params.set("unavailable", "include");
  if (conditions.includeUndeterminable) params.set("undeterminable", "include");
  if (conditions.market.length) params.set("market", [...conditions.market].sort().join(","));
  if (conditions.sector.length) params.set("sector", [...conditions.sector].sort().join(","));
  params.set("sort", conditions.sort);
  params.set("order", conditions.order);
  if (conditions.page > 1) params.set("page", String(conditions.page));
  // カンマは読みやすさのためエンコードしない（URLSearchParams は %2C にする）
  return params.toString().replaceAll("%2C", ",");
}

/** DB 関数 screen_stocks に渡す値。 */
export function toScreenStocksParams(conditions: ScreeningConditions, options: { clampPage: boolean }) {
  return {
    cagr: conditions.cagr,
    margin: conditions.margin,
    years: conditions.years,
    cagrOn: !conditions.off.includes("cagr"),
    marginOn: !conditions.off.includes("margin"),
    yearsOn: !conditions.off.includes("years"),
    owner: conditions.owner,
    ownerMode: conditions.ownerMode,
    ownerOn: !conditions.off.includes("owner"),
    includeUnavailable: conditions.includeUnavailable,
    includeUndeterminable: conditions.includeUndeterminable,
    markets: conditions.market,
    sectors: conditions.sector,
    sort: conditions.sort,
    order: conditions.order,
    page: conditions.page,
    pageSize: PAGE_SIZE,
    clampPage: options.clampPage,
  };
}

/** API の応答に載せる条件。 */
export function toApiConditions(conditions: ScreeningConditions) {
  return {
    cagr: conditions.cagr,
    margin: conditions.margin,
    years: conditions.years,
    owner: conditions.owner,
    ownermode: conditions.ownerMode,
    off: conditions.off,
    unavailable: conditions.includeUnavailable ? "include" : "exclude",
    undeterminable: conditions.includeUndeterminable ? "include" : "exclude",
    market: conditions.market,
    sector: conditions.sector,
    sort: conditions.sort,
    order: conditions.order,
  };
}
