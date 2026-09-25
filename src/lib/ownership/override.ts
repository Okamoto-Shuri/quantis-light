import { jsonNoStore } from "@/lib/http/no-store";
import { toJstIso } from "@/lib/stocks/annual-report";

import { OWNER_VERDICTS, ownerOverrideSchema, type OwnerOverride, type OwnerVerdict } from "./display";
import { trimMemo, validateMemo } from "./memo";

/**
 * 手動補正（Sprint 11）の API の本文の検証と、応答の形。書き込み・読み出しは DB 関数（owner_override_save・
 * owner_override_acknowledge・owner_override_delete・owner_override_summary。security invoker）をユーザーのセッションで呼ぶ。
 */

export type OverrideInput = { verdict: OwnerVerdict; memo: string };
export type OverrideField = "verdict" | "memo";

/** PUT の本文（{"verdict", "memo"}）の検証。メモは前後の空白を除いた値を返す（DB のトリガーも同じ規則で除く）。 */
export function parseOverrideInput(body: unknown): { ok: true; value: OverrideInput } | { ok: false; fields: OverrideField[] } {
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const fields: OverrideField[] = [];
  const verdict = record.verdict;
  if (typeof verdict !== "string" || !(OWNER_VERDICTS as readonly string[]).includes(verdict)) fields.push("verdict");
  const memo = record.memo;
  if (typeof memo !== "string" || validateMemo(memo) !== null) fields.push("memo");
  if (fields.length > 0) return { ok: false, fields };
  return { ok: true, value: { verdict: verdict as OwnerVerdict, memo: trimMemo(memo as string) } };
}

/** DB の値の形が想定と違う（不整合を「補正なし」に見せないため、黙って null にしない。Sprint 11 評価の m6） */
export class OverrideShapeError extends Error {
  constructor(detail: string) {
    super(`手動補正の値の形が想定と異なります: ${detail}`);
    this.name = "OverrideShapeError";
  }
}

/** DB の値（日時は UTC の ISO）を API の形（日本時間の ISO 8601）にする。形が違えば OverrideShapeError を投げる */
export function toApiOverride(value: unknown): OwnerOverride {
  const parsed = ownerOverrideSchema.safeParse(value);
  if (!parsed.success) throw new OverrideShapeError(parsed.error.message);
  return {
    ...parsed.data,
    created_at: toJstIso(parsed.data.created_at) ?? parsed.data.created_at,
    updated_at: toJstIso(parsed.data.updated_at) ?? parsed.data.updated_at,
  };
}

/**
 * 補正の API の応答（{ data }）。値が null なら data: null（補正なし）。形が違えば 500 internal_error にしてログを残す。
 */
export function apiOverrideResponse(value: unknown): Response {
  try {
    return jsonNoStore({ data: value === null ? null : toApiOverride(value) });
  } catch (error) {
    console.error("[api/ownership-override] 補正の値の形が想定と異なります", error instanceof Error ? error.message : "不明");
    return jsonNoStore({ error: "internal_error" }, { status: 500 });
  }
}

/** 応答の ownership（一覧の行・詳細）の override の日時を日本時間にする */
export function withApiOverride<T extends { override: OwnerOverride | null }>(ownership: T): T {
  return { ...ownership, override: ownership.override ? toApiOverride(ownership.override) : null };
}
