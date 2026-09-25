import { z } from "zod";

import { ownerConditionText } from "@/lib/ownership/display";
import { codePointLength, trimWhitespace } from "@/lib/text/whitespace";

import {
  CONDITION_KEYS,
  DEFAULT_CONDITIONS,
  parseScreeningParams,
  searchParamsToRecord,
  serializeScreeningParams,
  type ConditionKey,
  type ScreeningConditions,
  type SortKey,
} from "./params";
import { MARKETS, SECTOR33_NAMES } from "./sectors";

/**
 * 条件プリセット（Sprint 13。F12）。画面（client・server）と API で共有する、依存の無い関数だけを置く。
 * プリセットの中身は、スクリーニングの URL の正規形のクエリ（serializeScreeningParams の出力から page を除いたもの）。
 * 条件の文法・範囲の検証は parseScreeningParams の1か所だけで、ここでは同じ関数を呼ぶ（2つ目の解釈を作らない）。
 */

export const PRESET_NAME_MAX_LENGTH = 40;
export const PRESET_LIMIT = 50;

// ---------------------------------------------------------------------------
// 名前の規則（画面・API・DB で同じ定義。契約の第2章の5）
// ---------------------------------------------------------------------------

/** 名前の途中に使えない文字（制御文字と U+2028・U+2029。DB の check 制約と同じ） */
const NAME_FORBIDDEN = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "u");

export type PresetNameError = "name_required" | "name_too_long" | "name_invalid_chars";

export function trimPresetName(name: string): string {
  return trimWhitespace(name);
}

export function presetNameLength(name: string): number {
  return codePointLength(trimPresetName(name));
}

/** 検証（前後の空白を除いた値で数える）。問題が無ければ null */
export function validatePresetName(name: string): PresetNameError | null {
  const trimmed = trimPresetName(name);
  const length = codePointLength(trimmed);
  if (length === 0) return "name_required";
  if (length > PRESET_NAME_MAX_LENGTH) return "name_too_long";
  if (NAME_FORBIDDEN.test(trimmed)) return "name_invalid_chars";
  return null;
}

export const PRESET_MESSAGES = {
  name_required: "名前を入力してください",
  name_too_long: "名前は 40 文字以内で入力してください",
  name_invalid_chars: "名前に改行やタブは使えません",
  duplicate_name: "同じ名前のプリセットがあります",
  preset_limit: "プリセットは 50 件まで保存できます",
  save_failed: "保存できませんでした。時間をおいてもう一度お試しください",
  list_error: "プリセットを読み込めませんでした。再読み込みしてください",
  load_error: "既定のプリセットを読み込めませんでした（標準の条件で表示しています）",
} as const;

// ---------------------------------------------------------------------------
// クエリと条件
// ---------------------------------------------------------------------------

/** 条件をプリセットのクエリ（正規形、page を除く）にする */
export function presetQueryOf(conditions: ScreeningConditions): string {
  return serializeScreeningParams({ ...conditions, page: 1 });
}

/** 標準の条件（アプリの初期値）のクエリ */
export const STANDARD_QUERY = presetQueryOf(DEFAULT_CONDITIONS);

export type PresetQueryStatus = "ok" | "invalid" | "noncanonical";

export type ParsedPresetQuery = {
  conditions: ScreeningConditions;
  /** 無効な項目（URL と同じ規則で既定値にしたもの）。正規形でないときは ["query"] */
  invalidFields: string[];
  status: PresetQueryStatus;
};

/**
 * 保存したクエリを条件にする（URL と同じ parseScreeningParams の寛容な解釈。1ページ目）。
 * 無効な項目があれば invalid、項目は有効でも正規形と違えば noncanonical（契約の第2章の6）。
 */
export function parsePresetQuery(query: string): ParsedPresetQuery {
  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(new URLSearchParams(query)));
  const normalized = { ...conditions, page: 1 };
  if (invalidFields.length > 0) return { conditions: normalized, invalidFields, status: "invalid" };
  if (presetQueryOf(normalized) !== query) return { conditions: normalized, invalidFields: ["query"], status: "noncanonical" };
  return { conditions: normalized, invalidFields: [], status: "ok" };
}

/** API の本文の query を厳しく検証し、保存する正規形にする（page と未知のパラメータは無視する） */
export function canonicalPresetQuery(raw: string): { ok: true; query: string } | { ok: false; queryFields: string[] } {
  const { conditions, invalidFields } = parseScreeningParams(searchParamsToRecord(new URLSearchParams(raw.replace(/^\?/, ""))));
  const fields = invalidFields.filter((field) => field !== "page");
  if (fields.length > 0) return { ok: false, queryFields: fields };
  return { ok: true, query: presetQueryOf(conditions) };
}

// ---------------------------------------------------------------------------
// 保存した行
// ---------------------------------------------------------------------------

export const presetRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  query: z.string(),
  is_default: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PresetRow = z.infer<typeof presetRowSchema>;

/** 画面に渡すプリセット（行＋解釈の結果） */
export type Preset = PresetRow & ParsedPresetQuery;

export function toPreset(row: PresetRow): Preset {
  return { ...row, ...parsePresetQuery(row.query) };
}

/** 表示中の条件のクエリに一致するプリセット（作成の古い順。無効・正規形でないものは一致とみなさない） */
export function matchingPresets(presets: readonly Preset[], currentQuery: string): Preset[] {
  return presets.filter((preset) => preset.status === "ok" && preset.query === currentQuery);
}

export type SelectorCurrent = { kind: "preset"; preset: Preset } | { kind: "standard" } | { kind: "none" };

/**
 * セレクターのボタンに出すもの（契約の第2章の3の優先順位）: 一致するプリセットのうち作成の最も古いもの → 標準の条件 → 保存されていない条件。
 * presets が null（一覧を読めない）ならプリセットとの一致は判定しない。
 */
export function selectorCurrent(presets: readonly Preset[] | null, currentQuery: string): SelectorCurrent {
  const first = presets ? matchingPresets(presets, currentQuery)[0] : undefined;
  if (first) return { kind: "preset", preset: first };
  if (currentQuery === STANDARD_QUERY) return { kind: "standard" };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// 条件の要約（保存・管理・上書きの確認で共有）
// ---------------------------------------------------------------------------

export const SORT_LABELS: Record<SortKey, string> = {
  cagr: "売上CAGR",
  margin: "営業利益率",
  years: "推定上場年数",
  owner: "オーナー系合計",
  code: "コード",
  name: "社名",
  market: "市場区分",
  sector: "業種",
};

/** 要約の1項目。key は上書きの確認で違いを強調するための識別子 */
export type SummaryPart = { key: string; text: string };

export function presetSummaryParts(conditions: ScreeningConditions): SummaryPart[] {
  const off = (key: ConditionKey) => conditions.off.includes(key);
  const parts: SummaryPart[] = [
    { key: "cagr", text: off("cagr") ? "CAGR オフ" : `CAGR ≥${conditions.cagr}%` },
    { key: "margin", text: off("margin") ? "営業利益率 オフ" : `営業利益率 ≥${conditions.margin}%` },
    { key: "years", text: off("years") ? "上場年数 オフ" : `上場${conditions.years}年以内` },
    { key: "owner", text: off("owner") ? "④ オフ" : `④ ${ownerConditionText(conditions.ownerMode, conditions.owner)}` },
  ];
  if (conditions.includeUnavailable) parts.push({ key: "unavailable", text: "算出不可を含める" });
  if (conditions.includeUndeterminable) parts.push({ key: "undeterminable", text: "判定不能を含める" });
  if (conditions.market.length > 0) {
    const names = MARKETS.filter((market) => conditions.market.includes(market.code)).map((market) => market.name);
    parts.push({ key: "market", text: `市場: ${names.join("・")}` });
  }
  if (conditions.sector.length > 0) {
    const text =
      conditions.sector.length <= 3
        ? `業種: ${conditions.sector.map((code) => SECTOR33_NAMES.get(code) ?? code).join("・")}`
        : `業種 ${conditions.sector.length} 件`;
    parts.push({ key: "sector", text });
  }
  parts.push({ key: "sort", text: `並べ替え: ${SORT_LABELS[conditions.sort]} ${conditions.order === "asc" ? "昇順" : "降順"}` });
  return parts;
}

export function presetSummary(conditions: ScreeningConditions): string {
  return presetSummaryParts(conditions)
    .map((part) => part.text)
    .join(" ・ ");
}

// ---------------------------------------------------------------------------
// 入力欄の無効な値の注記（契約の第2章の7）
// ---------------------------------------------------------------------------

const THRESHOLD_NAMES: Record<ConditionKey, string> = {
  cagr: "売上CAGR",
  margin: "営業利益率",
  years: "上場年数",
  owner: "オーナー系合計の閾値",
};

/** 「入力中の無効な値は保存されません（売上CAGR は 20% で保存します）」 */
export function invalidInputNote(keys: readonly ConditionKey[], saved: ScreeningConditions): string | null {
  const ordered = CONDITION_KEYS.filter((key) => keys.includes(key));
  if (ordered.length === 0) return null;
  const items = ordered.map((key) => `${THRESHOLD_NAMES[key]} は ${saved[key]}${key === "years" ? "年" : "%"}`);
  return `入力中の無効な値は保存されません（${items.join("、")} で保存します）`;
}
