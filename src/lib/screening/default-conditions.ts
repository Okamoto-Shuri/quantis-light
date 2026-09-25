import { DEFAULT_CONDITIONS, type ScreeningConditions } from "./params";
import { presetQueryOf, type Preset, type PresetQueryStatus } from "./presets";

/**
 * 「既定の条件」の解決（Sprint 14。契約の第2章の7）。既定のプリセットがあればその条件、無ければ標準の条件（DEFAULT_CONDITIONS）。
 * ダッシュボード・ウォッチリスト・銘柄詳細（条件のパラメータなし）・/screening のリダイレクトが、この1か所を使う。
 * 既定のプリセットを読めなければ標準の条件で判定し、loadError で注記させる（0件・未設定として扱わない）。
 * API（GET /api/screening・/api/screening/changes・/api/watchlist・/api/stocks/[code]）は既定のプリセットを当てない（Sprint 13 の規則）。
 */
export type DefaultConditions = {
  conditions: ScreeningConditions;
  /** preset = 既定のプリセット、standard = 標準の条件（既定のプリセットが無い・読めない） */
  source: "preset" | "standard";
  presetName?: string;
  /** 既定のプリセットの解釈（invalid・noncanonical なら注記する。Sprint 13 評価の m3） */
  presetStatus?: PresetQueryStatus;
  invalidFields: string[];
  /** 既定のプリセットを読めなかった */
  loadError: boolean;
  /** 正規形のクエリ（page を除く。「スクリーニングで開く」の URL に使う） */
  query: string;
  /** /screening のリダイレクト先に使う、保存したクエリそのまま（既定のプリセットが無ければ null） */
  redirectQuery: string | null;
};

type PresetLoad = { ok: true; value: Preset | null } | { ok: false };

function standard(loadError: boolean): DefaultConditions {
  const conditions = { ...DEFAULT_CONDITIONS, off: [], market: [], sector: [] };
  return { conditions, source: "standard", invalidFields: [], loadError, query: presetQueryOf(conditions), redirectQuery: null };
}

/** 既定のプリセットの読み出しの結果から、既定の条件を求める */
export function defaultConditionsFrom(load: PresetLoad): DefaultConditions {
  if (!load.ok) return standard(true);
  const preset = load.value;
  if (preset === null) return standard(false);
  return {
    conditions: preset.conditions,
    source: "preset",
    presetName: preset.name,
    presetStatus: preset.status,
    invalidFields: preset.invalidFields,
    loadError: false,
    query: presetQueryOf(preset.conditions),
    redirectQuery: preset.query,
  };
}

/** プリセットの一覧の読み出しの結果から（/screening は一覧を読むので、そこから既定を選ぶ） */
export function defaultConditionsFromList(load: { ok: true; value: Preset[] } | { ok: false }): DefaultConditions {
  if (!load.ok) return defaultConditionsFrom({ ok: false });
  return defaultConditionsFrom({ ok: true, value: load.value.find((preset) => preset.is_default) ?? null });
}

/**
 * 既定のプリセットに無効な項目がある・正規形でないときの注記（Sprint 13 評価の m3）。verb は「判定」「比較」など。問題が無ければ null
 */
export function defaultPresetNote(dc: Pick<DefaultConditions, "source" | "presetName" | "presetStatus" | "invalidFields">, verb = "判定"): string | null {
  if (dc.source !== "preset") return null;
  if (dc.presetStatus === "invalid") {
    return `既定のプリセット『${dc.presetName}』の条件の一部（${dc.invalidFields.join(", ")}）が無効なため、既定値で${verb}しています`;
  }
  if (dc.presetStatus === "noncanonical") return `既定のプリセット『${dc.presetName}』の条件を標準の形に直して${verb}しています`;
  return null;
}

/** 既定のプリセットを読めなかったときの注記 */
export const DEFAULT_PRESET_LOAD_ERROR = "既定のプリセットを読み込めませんでした（標準の条件で判定しています）";
