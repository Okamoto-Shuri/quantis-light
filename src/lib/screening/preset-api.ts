import { jsonNoStore } from "@/lib/http/no-store";
import { toJstIso } from "@/lib/stocks/annual-report";

import { toApiConditions } from "./params";
import { canonicalPresetQuery, presetRowSchema, toPreset, trimPresetName, validatePresetName, type Preset } from "./presets";

/**
 * 条件プリセットの API（Sprint 13）の本文の検証、DB のエラーの分類、応答の形。
 * 書き込みは DB 関数（create_screening_preset・update_screening_preset。security invoker）をユーザーのセッションで呼ぶ。
 */

export type PresetField = "name" | "query" | "isDefault";

export type PresetInput = { name?: string; query?: string; isDefault?: boolean };

type Invalid = { ok: false; fields: PresetField[]; queryFields: string[] };

/**
 * 本文の検証。mode = create では name・query が必須、update では1つ以上。
 * 名前は前後の空白を除いた値、クエリは正規形（page を除く）にして返す。
 */
export function parsePresetInput(body: unknown, mode: "create" | "update"): { ok: true; value: PresetInput } | Invalid {
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const fields: PresetField[] = [];
  let queryFields: string[] = [];
  const value: PresetInput = {};
  if (record === null) return { ok: false, fields: ["name", "query"], queryFields };

  if (record.name !== undefined || mode === "create") {
    if (typeof record.name !== "string" || validatePresetName(record.name) !== null) fields.push("name");
    else value.name = trimPresetName(record.name);
  }
  if (record.query !== undefined || mode === "create") {
    if (typeof record.query !== "string") fields.push("query");
    else {
      const canonical = canonicalPresetQuery(record.query);
      if (canonical.ok) value.query = canonical.query;
      else {
        fields.push("query");
        queryFields = canonical.queryFields;
      }
    }
  }
  if (record.isDefault !== undefined) {
    if (typeof record.isDefault !== "boolean") fields.push("isDefault");
    else value.isDefault = record.isDefault;
  }
  if (fields.length > 0) return { ok: false, fields, queryFields };
  if (mode === "update" && value.name === undefined && value.query === undefined && value.isDefault === undefined) {
    return { ok: false, fields: [], queryFields };
  }
  return { ok: true, value };
}

export function invalidPresetResponse(invalid: Invalid): Response {
  return jsonNoStore(
    { error: "invalid_preset", fields: invalid.fields, ...(invalid.queryFields.length > 0 ? { queryFields: invalid.queryFields } : {}) },
    { status: 400 },
  );
}

type DbError = { code?: string; message: string };

/**
 * DB のエラーを応答にする。23505 は制約の名前で区別する（名前の一意 → 409 duplicate_name。既定の部分一意索引は直列化で
 * 本来起きないので 500。duplicate_name にしない）。上限（QP050）→ 409 preset_limit。check 違反（23514）→ 400。
 */
export function presetDbErrorResponse(error: DbError, label: string): Response {
  if (error.code === "23505" && error.message.includes("screening_presets_user_name_key")) {
    return jsonNoStore({ error: "duplicate_name", fields: ["name"] }, { status: 409 });
  }
  if (error.code === "QP050") return jsonNoStore({ error: "preset_limit" }, { status: 409 });
  if (error.code === "23514") {
    const field: PresetField = error.message.includes("screening_presets_query_check") ? "query" : "name";
    return jsonNoStore({ error: "invalid_preset", fields: [field] }, { status: 400 });
  }
  console.error(`[api/screening/presets] ${label}に失敗しました`, error.code ?? "", error.message);
  return jsonNoStore({ error: "internal_error" }, { status: 500 });
}

/** API の形（日時は日本時間の ISO 8601、conditions は toApiConditions の形） */
export function toApiPreset(preset: Preset) {
  return {
    id: preset.id,
    name: preset.name,
    query: preset.query,
    isDefault: preset.is_default,
    conditions: toApiConditions(preset.conditions),
    invalidFields: preset.invalidFields,
    createdAt: toJstIso(preset.created_at) ?? preset.created_at,
    updatedAt: toJstIso(preset.updated_at) ?? preset.updated_at,
  };
}

/** DB 関数の戻り値（jsonb）を API の応答にする。null は 404（存在しない・他人の行）。形が違えば 500 */
export function presetFunctionResponse(data: unknown, status = 200): Response {
  if (data === null) return jsonNoStore({ error: "not_found" }, { status: 404 });
  const parsed = presetRowSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[api/screening/presets] プリセットの形式が想定と異なります", parsed.error.message);
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
  return jsonNoStore({ data: toApiPreset(toPreset(parsed.data)) }, { status });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPresetId(id: string): boolean {
  return UUID.test(id);
}
