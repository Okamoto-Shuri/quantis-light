"use client";

import { Check, Star, TriangleAlert } from "lucide-react";

import { PRESET_MESSAGES, type Preset, type SummaryPart } from "@/lib/screening/presets";
import { cn } from "@/lib/utils";

/** 条件プリセットの部品（Sprint 13。Sprint 14 でダイアログごとのファイルに分けた）: API の呼び出し、文言、印、要約の一覧 */

export type ApiResult = { ok: true; status: number; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> };

export async function callApi(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, body: json };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

/** API のエラーを利用者向けの文言にする */
export function errorMessage(result: ApiResult): string {
  const code = result.body.error;
  if (code === "duplicate_name") return PRESET_MESSAGES.duplicate_name;
  if (code === "preset_limit") return PRESET_MESSAGES.preset_limit;
  if (code === "not_found") return "プリセットが見つかりません（削除された可能性があります）。再読み込みしてください";
  return PRESET_MESSAGES.save_failed;
}

export function DefaultBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-signal/30 bg-signal-muted px-1 py-px text-[0.7rem] leading-tight font-medium text-signal-strong"
      data-testid="preset-default-badge"
    >
      <Star aria-hidden="true" className="size-3" />
      既定
    </span>
  );
}

function presetProblem(preset: Preset): string | null {
  if (preset.status === "invalid") return "一部の条件が無効です";
  if (preset.status === "noncanonical") return "条件の書き方が標準の形ではありません";
  return null;
}

export function ProblemMark({ preset }: { preset: Preset }) {
  const problem = presetProblem(preset);
  if (!problem) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-caution-strong" data-testid="preset-invalid-mark">
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {problem}
    </span>
  );
}

export function CheckSlot({ checked }: { checked: boolean }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" data-testid={checked ? "preset-check" : undefined}>
      {checked && <Check aria-label="適用中" className="size-4 text-signal-strong" />}
    </span>
  );
}

export function SummaryList({ parts, highlight, testId }: { parts: SummaryPart[]; highlight?: Set<string>; testId?: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs" data-testid={testId}>
      {parts.map((part) => {
        const changed = highlight?.has(part.key) ?? false;
        return (
          <li
            key={part.key}
            className={cn(
              "rounded-sm border px-1.5 py-0.5",
              changed ? "border-caution/50 bg-caution-muted font-semibold text-caution-strong" : "bg-surface text-foreground",
            )}
            data-changed={changed ? "true" : undefined}
          >
            {changed && <span className="sr-only">変更: </span>}
            {part.text}
            {changed && (
              <span aria-hidden="true" className="ml-1 font-normal">
                ●
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
