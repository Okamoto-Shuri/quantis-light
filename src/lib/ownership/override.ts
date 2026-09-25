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

/** DB の値（日時は UTC の ISO）を API の形（日本時間の ISO 8601）にする。形が違えば null */
export function toApiOverride(value: unknown): OwnerOverride | null {
  const parsed = ownerOverrideSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    created_at: toJstIso(parsed.data.created_at) ?? parsed.data.created_at,
    updated_at: toJstIso(parsed.data.updated_at) ?? parsed.data.updated_at,
  };
}

/** 応答の ownership（一覧の行・詳細）の override の日時を日本時間にする */
export function withApiOverride<T extends { override: OwnerOverride | null }>(ownership: T): T {
  return { ...ownership, override: ownership.override ? toApiOverride(ownership.override) : null };
}
